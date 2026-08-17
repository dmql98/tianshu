import type { Server, Socket } from 'socket.io'
import { sessionStore } from '../../db/sessionStore.js'
import { disconnectMCPServer } from '../../tools/mcp-client.js'
import type { MCPClient } from '../../tools/mcp-client.js'
import type { LLMMessage, ProviderConfig } from '../../llm/client.js'
import type { ProviderCapability } from '../attachments.js'
import type { ComposeContext } from '../compose.js'
import { composeMessages } from '../compose.js'
import { innerLoop, detectDoomLoop, type ToolCallRecord } from '../inner.js'
import { capturePrefixShape, compareShapes, type PrefixShape } from '../system-cache.js'
import { estimateTokens, shouldSnipTokens, shouldCompactTokens, trimToolResults, MAX_OVERFLOW_COMPACTS, type CompactPolicy } from './loop-policy.js'
import { compactWithRetries, selectAndSummarize } from './context-compactor.js'
import { isContextOverflowError } from '../../llm/client.js'
import { handleSubAgentRequest, handleTaskComplete, handleAskUser, handleCreatePlan, handleUpdatePlanStep } from './control-router.js'
import { planStore } from '../plan/plan-store.js'
import { goalStore, type GoalRow } from '../plan/plan-store.js'
import type { RunPolicySnapshot } from './run-policy.js'
import { assessProgress, createRuntimeState, type RunLimitSummary, type RunLimitRuntimeState } from './loop-policy.js'

/**
 * Loop engine: the bounded model/tool turn loop. Migrated from the body of
 * agent/outer.ts sessionLoop.
 */

// Reasoning models (DeepSeek-style) always emit `reasoning_content` regardless
// of the client's `thinking` toggle. Once thinking is active upstream, every
// assistant message MUST carry the field — omitting it makes the API reject
// with "The reasoning_content in the thinking mode must be passed back".
function isReasoningModel(model: string): boolean {
  const id = model.toLowerCase()
  return id.includes('deepseek') || id.includes('reasoner') || id.includes('-r1') || id.includes('qwq') || id.includes('thinking')
}

export interface LoopEngineContext {
  sessionId: string
  runId: string
  socket?: Socket
  io?: Server
  signal?: AbortSignal
  provider: ProviderConfig
  model: string
  characterId: string
  workspace: string
  workspaces: string[]
  dataspace?: string
  cap: ProviderCapability
  tools: any[] | undefined
  mcpClients: Map<string, MCPClient>
  contextWindow: number
  /** 模型级压缩策略（P1-4）：阈值 / 保留比 / 摘要模型，未配置时回退全局默认。 */
  compactPolicy: CompactPolicy
  maxTurns: number
  policy: RunPolicySnapshot
  messages: LLMMessage[]
  composeCtx: ComposeContext
  opts: { thinking?: boolean; reasoning_effort?: string }
  executionMode: 'direct' | 'plan_first' | 'goal'
  goal?: GoalRow | null
  session: {
    id: string
    character_id: string
    provider_id?: string | null
    workspace?: string | null
    workspaces?: string | null
    active_group?: string | null
    current_strategy?: string | null
    approval_mode?: string | null
    compaction_until_id?: number | null
    compaction_summary?: string | null
    trimmed_until_id?: number | null
  }
}

export interface LoopEngineResult {
  sessionId: string
  status: 'stop' | 'max_turns' | 'cancelled' | 'task_complete'
  totalInputTokens: number
  totalOutputTokens: number
  totalCacheHitTokens: number
  totalCacheMissTokens: number
  toolCallHistory: ToolCallRecord[]
  prevPrefixShape: PrefixShape | undefined
  turn: number
  limitSummary?: RunLimitSummary
}

/** Snapshot of plan-step statuses used to detect real plan progress. */
function snapshotPlanSteps(sessionId: string): Map<string, string> {
  const out = new Map<string, string>()
  const active = planStore.getActive(sessionId)
  if (!active) return out
  for (const step of planStore.steps(active.id)) out.set(step.id, step.status)
  return out
}

function planStepChanged(before: Map<string, string>, sessionId: string): boolean {
  const active = planStore.getActive(sessionId)
  if (!active) return false
  for (const step of planStore.steps(active.id)) {
    const prev = before.get(step.id)
    if (prev !== undefined && prev !== step.status) return true
  }
  return false
}


function buildLimitSummary(
  reason: 'no_progress_after_soft_limit' | 'absolute_limit' | 'repeated_tool_loop' | 'continuation_limit',
  policy: RunPolicySnapshot,
  turn: number,
  runtime: RunLimitRuntimeState,
  softTurns: number,
  absoluteTurns: number,
): RunLimitSummary {
  return {
    reason,
    policyVersion: policy.policyVersion,
    softTurns,
    absoluteTurns,
    turnsUsed: turn,
    graceTurnsUsed: runtime.graceStarted ? Math.max(0, turn - softTurns) : 0,
    noProgressStreak: runtime.consecutiveNoProgress,
    continuationScheduled: false,
  }
}

export async function runLoopEngine(ctx: LoopEngineContext): Promise<LoopEngineResult> {
  const {
    sessionId, runId, socket, io, signal, provider, model, characterId,
    workspace, workspaces, dataspace, cap, tools, mcpClients,
    contextWindow, compactPolicy, maxTurns, policy, messages, composeCtx, opts, session,
    executionMode, goal,
  } = ctx

  let turn = 0
  let totalInputTokens = 0
  let totalOutputTokens = 0
  let totalCacheHitTokens = 0
  let totalCacheMissTokens = 0
  let consecutiveErrors = 0
  let overflowCompacts = 0
  const toolCallHistory: ToolCallRecord[] = []
  let prevPrefixShape: PrefixShape | undefined
  let limitSummary: RunLimitSummary | undefined

  const runtime: RunLimitRuntimeState = createRuntimeState()
  const limit = policy.effective
  const dynamic = policy.system.dynamicLimitEnabled
  const { softTurns, absoluteTurns } = limit

  const policyLabel = executionMode === 'direct' ? 'Direct' : executionMode === 'plan_first' ? 'Plan-first' : 'Goal'
  // Pin the plan to this Run. Once its last step completes its DB status is no
  // longer "active", but submit_result must still validate that same plan.
  let currentPlanId = planStore.getActive(sessionId)?.id || null
  const currentPlan = () => currentPlanId ? planStore.get(currentPlanId) : null
  const currentGoal = () => goal ? goalStore.get(goal.id) : null
  if (goal) goalStore.update(goal.id, { current_run_id: runId })

  socket?.emit('run.started', { session_id: sessionId, run_id: runId, context_window: contextWindow, execution_mode: executionMode })

  let prevFingerprint: string | undefined
  let planSnapshot = snapshotPlanSteps(sessionId)
  // Last rendered `[Policy ...]` plan alert for this run. The plan render is
  // only re-injected when it actually changed, so the trailing context message
  // stays byte-stable on steady-state turns (cache-friendly, fewer tokens).
  let lastPlanAlert = ''

  while (turn < absoluteTurns && !signal?.aborted) {
    turn++

    // Per-turn guard: pre-request compaction must not fire twice in one turn.
    let turnCompacted = false

    // Soft limit reached for the first time: warn + inject a single convergence
    // prompt (RUN_LIMIT_POLICY_PLAN §9.2). Only when dynamic limits are on.
    if (dynamic && !runtime.warningEmitted && turn >= softTurns) {
      runtime.warningEmitted = true
      runtime.graceStarted = true
      socket?.emit('run.limit_warning', {
        session_id: sessionId,
        run_id: runId,
        soft_turns: softTurns,
        absolute_turns: absoluteTurns,
        turn,
      })
      composeCtx.systemAlerts!.push(
        `[System Alert] 已接近本轮软上限（${softTurns} 轮）。请优先完成当前步骤、保存验证证据、提交结果或说明阻塞；不要重复相同的工具调用。`,
      )
    }

    // Log memory every 5 turns
    if (turn % 5 === 0) {
      const mem = process.memoryUsage()
      const heapMB = (mem.heapUsed / 1024 / 1024).toFixed(0)
      const totalMB = (mem.heapTotal / 1024 / 1024).toFixed(0)
      const ctxPct = ((estimateTokens(messages) / contextWindow) * 100).toFixed(0)
      console.log(`[session] ${sessionId} turn ${turn}: heap ${heapMB}/${totalMB}MB, ${messages.length} msgs, ctx ${ctxPct}%`)
    }

    // Compose dynamic context (plan / goal / alerts) as a trailing message
    // so the history prefix stays byte-stable for provider prefix caching.
    // Execution-policy guardrails: Plan-first / Goal must operate against a
    // persisted plan; Goal mode re-anchors the model to the outcome.
    const plan = currentPlan()
    if (!plan) {
      if (policyLabel !== 'Direct') {
        const noPlanAlert = `[Policy ${policyLabel}] 当前没有有效计划。先调用 create_plan 把任务拆成有序步骤并注明验证方式，再执行步骤。`
        if (noPlanAlert !== lastPlanAlert) {
          composeCtx.systemAlerts!.push(noPlanAlert)
          lastPlanAlert = noPlanAlert
        }
      }
    } else {
      const steps = planStore.steps(plan.id)
      const planRule = policyLabel === 'Direct'
        ? '\n这是可选计划：可以继续按计划推进，也可以直接完成任务；若推进计划，请用 update_plan_step 同步状态。'
        : '\n开始步骤前调用 update_plan_step 标记 in_progress；验证完成后调用 update_plan_step 标记 completed 并附 evidence。'
      const planAlert =
        `[Policy ${policyLabel}] 当前计划 v${plan.version}：\n` +
        steps.map(step => `${step.ordinal}. [${step.status}] ${step.title}${step.verification ? `（验证：${step.verification}）` : ''}`).join('\n') +
        planRule
      if (planAlert !== lastPlanAlert) {
        composeCtx.systemAlerts!.push(planAlert)
        lastPlanAlert = planAlert
      }
    }
    if (executionMode === 'goal') {
      const g = currentGoal()
      if (g) {
        composeCtx.systemAlerts!.push(
          `[Goal] 目标: ${g.outcome}` +
          (g.constraints ? `\n约束: ${g.constraints}` : '') +
          (g.verification ? `\n验证标准: ${g.verification}` : ''),
        )
      }
    }
    const turnAlerts = composeCtx.systemAlerts
    let composedMsgs = composeMessages(messages, {
      ...composeCtx,
      preserveReasoning: opts.thinking === true || isReasoningModel(model) || messages.some(m => m.role === 'assistant' && !!m.reasoning_content),
    })
    // The alerts were composed into the trailing context message; clear them so
    // nothing carries into the next turn (prevents accumulation). Alerts pushed
    // AFTER this point are deliberate carry-overs for the next turn (retry /
    // doom-loop / convergence notes).
    composeCtx.systemAlerts = []

    // ── 回合内预请求压力检查（P0-2）──
    // 单回合内一次超大工具输出可能让本次请求直接击穿窗口；发送前用真实的
    // composedMsgs 重测一次，超过阈值则先压缩历史（压缩绝不触碰 system）再发。
    if (!turnCompacted && shouldCompactTokens(estimateTokens(composedMsgs), contextWindow, compactPolicy)) {
      const compact = await compactWithRetries(messages, provider, model, {
        tools, contextWindow, policy: compactPolicy,
        summarizationProviderId: compactPolicy.summarizationProvider,
        summarizationModel: compactPolicy.summarizationModel,
      })
      if (compact.didCompact) {
        turnCompacted = true
        // Compaction may have summarized away the create_plan details; force
        // the next turn to re-inject the current plan render.
        lastPlanAlert = ''
        sessionStore.update(sessionId, {
          compaction_summary: compact.summary!,
          compaction_until_id: compact.compactedUntilId || null,
        })
        socket?.emit('run.compacted', { session_id: sessionId, run_id: runId, message: 'Context compacted before request to avoid overflow' })
        // 前缀已变：用与首帧一致的动态上下文重算本轮要发送的消息，并让下一次
        // 前缀形状对比按冷启动处理（形状确实变了，避免误报缓存差异）。
        composedMsgs = composeMessages(messages, {
          ...composeCtx,
          systemAlerts: turnAlerts,
          preserveReasoning: opts.thinking === true || isReasoningModel(model) || messages.some(m => m.role === 'assistant' && !!m.reasoning_content),
        })
        prevPrefixShape = undefined
      }
    }

    // Prefix-shape diagnostics: detect what changed versus last request
    const curShape = capturePrefixShape(composedMsgs, tools)
    if (prevPrefixShape) {
      const reasons = compareShapes(prevPrefixShape, curShape)
      if (reasons.length > 0) {
        console.log(`[cache-shape] ${sessionId} turn ${turn}: ${reasons.join(', ')}`)
      }
    } else {
      console.log(`[cache-shape] ${sessionId} turn ${turn}: cold start`)
    }
    prevPrefixShape = curShape

    const result = await innerLoop(composedMsgs,
      tools, provider, model, characterId,
      workspace, io, socket, sessionId, signal, opts, turn,
      mcpClients, workspaces, cap, dataspace,
    )

    totalInputTokens += result.totalInputTokens
    totalOutputTokens += result.totalOutputTokens
    if (result.totalCacheHitTokens) totalCacheHitTokens += result.totalCacheHitTokens
    if (result.totalCacheMissTokens) totalCacheMissTokens += result.totalCacheMissTokens

    if (result.type === 'error') {
      // Cancellation is not a retryable error: exit immediately instead of
      // emitting run.retrying (belt-and-suspenders; innerLoop now returns
      // 'aborted' on cancellation, so this mostly guards races at the boundary).
      if (signal?.aborted) break
      const errMsg = result.error || ''

      // P1-6: 溢出识别走归一化判定（含 finish_reason 强信号），每次重试都从
      // "压缩后的新上下文"再次发请求（最多 MAX_OVERFLOW_COMPACTS 次）。
      if (isContextOverflowError(errMsg)) {
        if (overflowCompacts < MAX_OVERFLOW_COMPACTS) {
          console.log(`[session] ${sessionId} overflow, force compacting and retrying...`)
          const compact = await compactWithRetries(messages, provider, model, {
            tools, contextWindow, policy: compactPolicy,
            summarizationProviderId: compactPolicy.summarizationProvider,
            summarizationModel: compactPolicy.summarizationModel,
          })
          if (compact.didCompact) {
            overflowCompacts++
            // Compaction may have summarized away the create_plan details; force
            // the next turn to re-inject the current plan render.
            lastPlanAlert = ''
            sessionStore.update(sessionId, {
              compaction_summary: compact.summary!,
              compaction_until_id: compact.compactedUntilId || null,
            })
            socket?.emit('run.compacted', { session_id: sessionId, run_id: runId, message: 'Context overflow recovered via compaction' })
            continue
          }
        }
        console.log(`[session] ${sessionId} failed: context overflow (${turn} turns)`)
        socket?.emit('run.failed', { session_id: sessionId, run_id: runId, error: `Context overflow: ${result.error}` })
        for (const [, client] of mcpClients) {
          await disconnectMCPServer(client).catch(() => {})
        }
        return { status: 'stop', sessionId, totalInputTokens, totalOutputTokens, totalCacheHitTokens, totalCacheMissTokens, toolCallHistory, prevPrefixShape, turn }
      }

      consecutiveErrors++
      if (consecutiveErrors >= 2) {
        console.log(`[session] ${sessionId} failed: 2 consecutive errors (${turn} turns)`)
        socket?.emit('run.failed', { session_id: sessionId, run_id: runId, error: result.error })
        for (const [, client] of mcpClients) {
          await disconnectMCPServer(client).catch(() => {})
        }
        return { status: 'stop', sessionId, totalInputTokens, totalOutputTokens, totalCacheHitTokens, totalCacheMissTokens, toolCallHistory, prevPrefixShape, turn }
      }
      socket?.emit('run.retrying', {
        session_id: sessionId,
        run_id: runId,
        scope: 'run',
        attempt: 2,
        max_attempts: 2,
        error: result.error,
        delay_ms: 0,
      })
      // Keep the retry context at the turn tail without misclassifying an API
      // transport failure as a tool failure.
      composeCtx.systemAlerts!.push(`[System Note] The model API request failed transiently (${result.error}). Continue from the existing conversation and tool results; do not repeat completed work.`)
      continue
    }
    consecutiveErrors = 0

    if (result.toolCallRecords) {
      toolCallHistory.push(...result.toolCallRecords)
    }

    messages.push(...result.messages)

    if (result.type === 'sub_agent_request' && result.subAgentRequest) {
      const outcome = await handleSubAgentRequest({
        req: result.subAgentRequest,
        result,
        session,
        provider,
        model,
        signal,
        io,
        socket,
        runId,
        workspace,
      })
      messages.push(...outcome.messages)
      continue
    }

    if (result.type === 'submit_result') {
      const plan = currentPlan()
      const planCompleted = plan ? planStore.allCompleted(plan.id) : false
      const unmetSteps = plan
        ? planStore.unmetSteps(plan.id).map(s => ({ ordinal: s.ordinal, title: s.title }))
        : []
      const outcome = await handleTaskComplete({
        result,
        sessionId,
        runId,
        socket,
        messages,
        mcpClients,
        totalInputTokens,
        totalOutputTokens,
        totalCacheHitTokens,
        totalCacheMissTokens,
        mode: executionMode,
        planCompleted,
        unmetSteps,
        goalVerification: executionMode === 'goal' ? goal?.verification || null : null,
      })
      messages.push(...outcome.messages)
      if (outcome.kind === 'done') {
        return {
          status: outcome.status || 'task_complete',
          sessionId, totalInputTokens, totalOutputTokens, totalCacheHitTokens, totalCacheMissTokens,
          toolCallHistory, prevPrefixShape, turn,
        }
      }
      continue
    }

    if (result.type === 'ask_user') {
      const outcome = await handleAskUser({
        question: result.question || '',
        result,
        sessionId,
        runId,
        socket,
        messages,
      })
      messages.push(...outcome.messages)
      // Stop this Run once the question is asked: the answer arrives through
      // POST /runs/:id/inputs, which starts a fresh resumed Run. Continuing
      // here would let the model loop on without the answer (re-asking /
      // working blindly) while the user's reply sits queued behind this Run.
      break
    }

    if (result.type === 'create_plan') {
      const outcome = await handleCreatePlan({
        result,
        sessionId,
        runId,
        socket,
        goalId: executionMode === 'goal' ? goal?.id || null : null,
      })
      if (outcome.planId) currentPlanId = outcome.planId
      messages.push(...outcome.messages)
      // Plan creation is strong progress: reset convergence counters.
      if (dynamic) {
        runtime.consecutiveNoProgress = 0
        runtime.consecutiveWeakOnly = 0
        runtime.lastStrongProgressTurn = turn
        prevFingerprint = undefined
      }
      planSnapshot = snapshotPlanSteps(sessionId)
      continue
    }

    if (result.type === 'update_plan_step') {
      const outcome = await handleUpdatePlanStep({ result, sessionId, runId, socket })
      messages.push(...outcome.messages)
      // A real step status change is strong progress; reset the streak.
      if (dynamic && outcome.updated) {
        runtime.consecutiveNoProgress = 0
        runtime.consecutiveWeakOnly = 0
        runtime.lastStrongProgressTurn = turn
        prevFingerprint = undefined
      }
      planSnapshot = snapshotPlanSteps(sessionId)
      continue
    }

    if (result.toolCallRecords?.length && detectDoomLoop(toolCallHistory)) {
      const recent = toolCallHistory.slice(-6)
      const lastTool = recent[recent.length - 1]?.toolName || 'unknown'
      composeCtx.systemAlerts!.push(`[System Alert] Repeated failures detected (last: ${lastTool}). Two strikes with the same tool type — do NOT retry with minor changes. Switch to a completely different tool category.`)
    }

    // Snip stale tool results first (cache-friendly), then compact if still over limit.
    // Use the provider-reported input token count (accurate) with a local
    // estimate fallback when usage isn't available (e.g. first turn / no usage).
    // CRITICAL: `lastInputTokens` reflects the request that JUST completed,
    // which does NOT include the messages appended to `messages` this turn
    // (`result.messages`). Project the NEXT request's size by adding this
    // turn's messages, otherwise a large tool output lets the next request
    // blow past the window before compaction has a chance to fire.
    const lastMeasured = result.lastInputTokens
    const projectedTokens = lastMeasured !== undefined
      ? lastMeasured + estimateTokens(result.messages)
      : estimateTokens(messages)
    if (shouldSnipTokens(projectedTokens, contextWindow)) {
      const snipTokensBefore = estimateTokens(messages)
      const { pruned: didSnip, trimmedUntilId } = trimToolResults(messages)
      if (didSnip) {
        const after = estimateTokens(messages)
        console.log(`[session] ${sessionId} turn ${turn}: snip trimmed (${snipTokensBefore}→${after} tok, used ${projectedTokens})`)
        // P0-4: 持久化剪枝水印，重载时恢复同一内存态。
        if (trimmedUntilId > (session.trimmed_until_id || 0)) {
          sessionStore.update(sessionId, { trimmed_until_id: trimmedUntilId })
        }
      }
    }
    if (shouldCompactTokens(projectedTokens, contextWindow, compactPolicy)) {
      const compact = await compactWithRetries(messages, provider, model, {
        tools, contextWindow, policy: compactPolicy,
        summarizationProviderId: compactPolicy.summarizationProvider,
        summarizationModel: compactPolicy.summarizationModel,
      })
      if (compact.didCompact) {
        // Compaction may have summarized away the create_plan details; force
        // the next turn to re-inject the current plan render.
        lastPlanAlert = ''
        sessionStore.update(sessionId, {
          compaction_summary: compact.summary!,
          compaction_until_id: compact.compactedUntilId || null,
        })
        socket?.emit('run.compacted', { session_id: sessionId, run_id: runId, message: 'Context compacted to manage token usage' })
      }
    }

    // ── Dynamic convergence: assess this turn's progress (§8–§9) ──
    if (dynamic) {
      const planChanged = planStepChanged(planSnapshot, sessionId)
      planSnapshot = snapshotPlanSteps(sessionId)
      const assessment = assessProgress({
        toolCalls: result.toolCallRecords || [],
        planStepChanged: planChanged,
        verificationEvidenceAdded: planChanged,
        databaseObjectChanged: planChanged,
        fileChanged: (result.toolCallRecords || []).some(r => r.changed === true),
        testFailuresReduced: false,
        firstEvidence: false,
        submitSucceeded: false,
        firstNewRead: false,
        newErrorCategory: false,
        toolCategorySwitched: false,
        compactionSucceeded: false,
        textGrowthOnly: result.type === 'final_answer' && !!result.fullText && (!result.toolCalls || result.toolCalls.length === 0),
      }, prevFingerprint)
      prevFingerprint = assessment.fingerprint

      if (assessment.level === 'strong') {
        runtime.consecutiveNoProgress = 0
        runtime.consecutiveWeakOnly = 0
        runtime.lastStrongProgressTurn = turn
      } else if (assessment.level === 'weak') {
        runtime.consecutiveWeakOnly++
        runtime.consecutiveNoProgress = 0
      } else {
        runtime.consecutiveNoProgress++
        runtime.consecutiveWeakOnly = 0
      }

      // Doom-loop merge: repeated fingerprint is a hard `none` signal and can
      // stop the Run before the absolute limit (§9.3).
      const doomRepeated = assessment.repeatedFingerprint
        && runtime.consecutiveNoProgress >= limit.repeatedToolLoopThreshold
      const weakExceeded = runtime.consecutiveWeakOnly >= limit.weakProgressThreshold
      const noProgressExceeded = runtime.consecutiveNoProgress >= limit.noProgressThreshold
      if (turn >= softTurns && (doomRepeated || weakExceeded || noProgressExceeded)) {
        limitSummary = buildLimitSummary(
          doomRepeated ? 'repeated_tool_loop' : 'no_progress_after_soft_limit',
          policy, turn, runtime, softTurns, absoluteTurns,
        )
        break
      }
    }

    if (result.type === 'aborted') break
    if (result.type === 'final_answer') {
      if (executionMode === 'plan_first' || executionMode === 'goal') {
        const plan = currentPlan()
        const planDone = plan ? planStore.allCompleted(plan.id) : false
        if (!planDone) {
          composeCtx.systemAlerts!.push(`[Policy ${policyLabel}] 计划尚未完成，最终回答不能结束任务。检查未完成步骤；需要交付时调用 submit_result 提交结果。`)
          continue
        }
      }
      if (toolCallHistory.length > 0 && !result.fullText) {
        composeCtx.systemAlerts!.push('[System Note] The task is not complete. Review what you have so far and continue working. Use tools as needed.')
        continue
      }
      break
    }
  }

  // Goal-mode budget accounting: charge this run and pause the goal when the
  // cross-run budget is exhausted (resume creates a fresh Run).
  if (executionMode === 'goal' && goal) {
    goalStore.addUsage(goal.id, totalInputTokens, totalOutputTokens)
    const g = goalStore.get(goal.id)
    if (g && g.status === 'active' && g.budget_tokens && goalStore.usedTokens(g) > g.budget_tokens) {
      goalStore.update(goal.id, { status: 'paused' })
      socket?.emit('goal.paused', {
        session_id: sessionId, run_id: runId, goal_id: goal.id, reason: 'budget_exhausted',
      })
    }
  }

  const status: 'cancelled' | 'max_turns' | 'stop' = signal?.aborted
    ? 'cancelled'
    : turn >= absoluteTurns
      ? 'max_turns'
      : limitSummary
        ? 'max_turns'
        : 'stop'

  // Absolute limit reached without a more specific reason.
  if (status === 'max_turns' && !limitSummary) {
    limitSummary = buildLimitSummary('absolute_limit', policy, turn, runtime, softTurns, absoluteTurns)
  }

  return {
    status, sessionId,
    totalInputTokens, totalOutputTokens, totalCacheHitTokens, totalCacheMissTokens,
    toolCallHistory, prevPrefixShape, turn,
    limitSummary,
  }
}
