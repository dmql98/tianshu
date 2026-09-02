import type { TransportBroadcaster } from '../../transport/runtime.js'
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
import { handleSubAgentBatchRequest, handleSubAgentMessageRequest, handleTaskComplete, handleAskUser, handleCreatePlan, handleUpdatePlanStep, handleDiscardPlan, handleCreateGoal, handleGetGoal, handleCompleteGoal, handleCancelGoal } from './control-router.js'
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
  stream: TransportBroadcaster
  broadcaster: TransportBroadcaster
  signal?: AbortSignal
  provider: ProviderConfig
  model: string
  characterId: string
  workspace: string
  workspaces: string[]
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
  /** 可委托子 agent 列表是否非空（outer.ts 按角色过滤后传入，驱动委派提示注入）。 */
  hasDelegateTargets: boolean
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
    sessionId, runId, stream, broadcaster, signal, provider, model, characterId,
    workspace, workspaces, cap, tools, mcpClients,
    contextWindow, compactPolicy, maxTurns, policy, messages, composeCtx, opts, session,
    executionMode, goal, hasDelegateTargets,
  } = ctx

  let turn = 0
  let totalInputTokens = 0
  let totalOutputTokens = 0
  let totalCacheHitTokens = 0
  let totalCacheMissTokens = 0
  let overflowCompacts = 0
  const toolCallHistory: ToolCallRecord[] = []
  let prevPrefixShape: PrefixShape | undefined
  let limitSummary: RunLimitSummary | undefined

  const runtime: RunLimitRuntimeState = createRuntimeState()
  const limit = policy.effective
  const dynamic = policy.system.dynamicLimitEnabled
  const { softTurns, absoluteTurns } = limit

  const policyLabel = executionMode === 'direct' ? 'Direct' : executionMode === 'plan_first' ? 'Plan-first' : 'Goal'
  // 直接对话模式提示（P0-2）：切换进 direct 时注入一次——模型自判是否创建计划/目标。
  // 仿 lastPlanAlert「变化才注入」：只在该轮未注入 plan alert 且内容变化时 push，
  // 稳态轮次不重复 → 尾部动态上下文保持字节稳定（provider 前缀缓存不受影响）。
  const directModeAlert = '[Policy Direct] 当前为直接对话模式：是否创建计划/目标由你自行判断。'
  // 委派策略提示（对齐 directModeAlert 的注入样式）：角色配了可委托 targets 时提示模型主动
  // 委派。具体"能拉起谁 / 能做什么"已由 outer.ts 在 delegate_to_agent 工具描述末尾注入
  // ` | targets: ...`，此处不重复列名。targets 在会话创建时确定、不会中途变，故每 Run 预计算一次。
  const delegationPolicyAlert =
    '[Policy Delegation] 你已配置可委托角色（详见 delegate_to_agent 工具的 targets 列表，含各角色简介）。' +
    '遇到可自包含、可并行的子任务时，主动用 delegate_to_agent 把子任务委派给子 agent 并行处理——这是处理大任务最快的方式；是否委派、委派给谁由你判断。'
  const sessRow0 = sessionStore.getById(sessionId)
  const isTopLevelSession = !sessRow0?.parent_id
  // Pin the plan to this Run. Once its last step completes its DB status is no
  // longer "active", but submit_result must still validate that same plan.
  let currentPlanId = planStore.getActive(sessionId)?.id || null
  const currentPlan = () => currentPlanId ? planStore.get(currentPlanId) : null
  // Live goal lookup: the Run pins the goal present at start, but the model may
  // create_goal mid-run — fall back to the session's active/paused goal so the
  // [Goal] injection, final-answer guard and submit_result completion all see it.
  const currentGoal = () => {
    if (goal) {
      const g = goalStore.get(goal.id)
      if (g) return g
    }
    return goalStore.listForSession(sessionId).find(g => g.status === 'active' || g.status === 'paused') || null
  }
  if (goal) goalStore.update(goal.id, { current_run_id: runId })

  stream?.emit('run.started', { session_id: sessionId, run_id: runId, context_window: contextWindow, execution_mode: executionMode })

  let prevFingerprint: string | undefined
  let planSnapshot = snapshotPlanSteps(sessionId)
  // Last rendered `[Policy ...]` plan alert for this run. The plan render is
  // only re-injected when it actually changed, so the trailing context message
  // stays byte-stable on steady-state turns (cache-friendly, fewer tokens).
  let lastPlanAlert = ''
  let lastGoalAlert = ''
  let lastModeAlert = ''
  let lastDelegationAlert = ''

  while (turn < absoluteTurns && !signal?.aborted) {
    turn++

    // Per-turn guard: pre-request compaction must not fire twice in one turn.
    let turnCompacted = false

    // Soft limit reached for the first time: warn + inject a single convergence
    // prompt (RUN_LIMIT_POLICY_PLAN §9.2). Only when dynamic limits are on.
    if (dynamic && !runtime.warningEmitted && turn >= softTurns) {
      runtime.warningEmitted = true
      runtime.graceStarted = true
      stream?.emit('run.limit_warning', {
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
    let planAlertPushed = false
    if (!plan) {
      if (policyLabel !== 'Direct') {
        const noPlanAlert = `[Policy ${policyLabel}] 当前没有有效计划。先调用 create_plan 把任务拆成有序步骤并注明验证方式，再执行步骤。`
        if (noPlanAlert !== lastPlanAlert) {
          composeCtx.systemAlerts!.push(noPlanAlert)
          lastPlanAlert = noPlanAlert
          planAlertPushed = true
        }
      }
    } else {
      const steps = planStore.steps(plan.id)
      const planRule = policyLabel === 'Direct'
        ? '\n这是可选计划：可以继续按计划推进，也可以直接完成任务；若推进计划请用 update_plan_step 同步状态。若任务方向已变、不再需要该计划，可用 discard_plan 放弃（挂起中的目标用 cancel_goal 取消），不必为完成而完成。'
        : '\n开始步骤前调用 update_plan_step 标记 in_progress；验证完成后调用 update_plan_step 标记 completed 并附 evidence。若该计划已不适用，可用 discard_plan 放弃后重建新计划。'
      const planAlert =
        `[Policy ${policyLabel}] 当前计划 v${plan.version}：\n` +
        steps.map(step => `${step.ordinal}. [${step.status}] ${step.title}${step.verification ? `（验证：${step.verification}）` : ''}`).join('\n') +
        planRule
      if (planAlert !== lastPlanAlert) {
        composeCtx.systemAlerts!.push(planAlert)
        lastPlanAlert = planAlert
        planAlertPushed = true
      }
    }
    // 直接对话模式：该轮未注入 plan alert 时，注入一次模式提示（每次切换/run 首轮）。
    if (policyLabel === 'Direct' && !planAlertPushed && directModeAlert !== lastModeAlert) {
      composeCtx.systemAlerts!.push(directModeAlert)
      lastModeAlert = directModeAlert
    }
    // 委派策略提示：仅顶层会话 + 存在可委托 targets（与 delegate 工具注入一致）时，任何执行模式都注入（变化才注入）。
    if (hasDelegateTargets && isTopLevelSession && delegationPolicyAlert !== lastDelegationAlert) {
      composeCtx.systemAlerts!.push(delegationPolicyAlert)
      lastDelegationAlert = delegationPolicyAlert
    }
    if (executionMode === 'goal') {
      const g = currentGoal()
      if (g) {
        composeCtx.systemAlerts!.push(
          `[Goal] 目标: ${g.outcome}` +
          (g.constraints ? `\n约束: ${g.constraints}` : '') +
          (g.verification ? `\n验证标准: ${g.verification}` : ''),
        )
      } else {
        // Goal mode no longer forces a separate create_goal: the goal is
        // declared via create_plan's goal/verification fields (which auto-link
        // a goal object in control-router), or via create_goal when a cross-run
        // budget/pause is needed. Soft hint only, re-injected on state change.
        const noGoalAlert = '[Policy Goal] 目标尚未声明。可在 create_plan 时填写 goal 与 verification 字段来声明目标（将自动关联目标对象）；如需跨 Run 预算/暂停再调用 create_goal。计划仍必须先建。'
        if (noGoalAlert !== lastGoalAlert) {
          composeCtx.systemAlerts!.push(noGoalAlert)
          lastGoalAlert = noGoalAlert
        }
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
        stream?.emit('run.compacted', { session_id: sessionId, run_id: runId, message: 'Context compacted before request to avoid overflow', compaction_summary: compact.summary!, compaction_until_id: compact.compactedUntilId || null })
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
      workspace, broadcaster, stream, sessionId, signal, opts, turn,
      mcpClients, workspaces, cap,
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
            stream?.emit('run.compacted', { session_id: sessionId, run_id: runId, message: 'Context overflow recovered via compaction', compaction_summary: compact.summary!, compaction_until_id: compact.compactedUntilId || null })
            continue
          }
        }
        console.log(`[session] ${sessionId} failed: context overflow (${turn} turns)`)
        stream?.emit('run.failed', { session_id: sessionId, run_id: runId, error: `Context overflow: ${result.error}` })
        for (const [, client] of mcpClients) {
          await disconnectMCPServer(client).catch(() => {})
        }
        return { status: 'stop', sessionId, totalInputTokens, totalOutputTokens, totalCacheHitTokens, totalCacheMissTokens, toolCallHistory, prevPrefixShape, turn }
      }

      // P0-3: a non-overflow LLM error here is a committed failure — transient
      // errors were already retried (with backoff) inside streamWithRetry.
      // Retrying once more at run level just consumes another turn with no
      // backoff, so fail the Run instead of adding an extra turn.
      console.log(`[session] ${sessionId} failed: ${result.error || 'LLM error'} (${turn} turns)`)
      stream?.emit('run.failed', { session_id: sessionId, run_id: runId, error: result.error })
      for (const [, client] of mcpClients) {
        await disconnectMCPServer(client).catch(() => {})
      }
      return { status: 'stop', sessionId, totalInputTokens, totalOutputTokens, totalCacheHitTokens, totalCacheMissTokens, toolCallHistory, prevPrefixShape, turn }
    }

    if (result.toolCallRecords) {
      toolCallHistory.push(...result.toolCallRecords)
    }

    messages.push(...result.messages)

    if (result.type === 'sub_agent_request' && result.subAgentBatch) {
      // P5 同步 barrier：同轮所有 delegate 并行拉起，全部完成（成功/失败）后
      // 父 run 才继续下一轮 LLM（父 LLM 此时看到全部工具结果，输出合并/重试/询问）。
      const outcome = await handleSubAgentBatchRequest({
        batch: result.subAgentBatch,
        result,
        session,
        provider,
        model,
        broadcaster,
        stream,
        runId,
      })
      messages.push(...outcome.messages)
      continue
    }

    if (result.type === 'sub_agent_message_request' && result.subAgentMessageRequest) {
      const outcome = await handleSubAgentMessageRequest({
        req: result.subAgentMessageRequest,
        result,
        session,
        provider,
        model,
        broadcaster,
        stream,
        runId,
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
        stream,
        messages,
        mcpClients,
        totalInputTokens,
        totalOutputTokens,
        totalCacheHitTokens,
        totalCacheMissTokens,
        mode: executionMode,
        planCompleted,
        unmetSteps,
        goalVerification: executionMode === 'goal' ? currentGoal()?.verification || null : null,
        goal: executionMode === 'goal' ? (() => { const g = currentGoal(); return g ? { id: g.id, status: g.status } : null })() : null,
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
        stream,
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
        stream,
        goalId: executionMode === 'goal' ? goal?.id || null : null,
        mode: executionMode,
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

    if (result.type === 'discard_plan') {
      const outcome = await handleDiscardPlan({ result, sessionId, runId, stream })
      messages.push(...outcome.messages)
      if (outcome.discarded) {
        // Drop the pinned plan so the cancelled plan stops being re-injected
        // this run; the next run pins nothing (getActive → null).
        currentPlanId = null
        lastPlanAlert = ''
        planSnapshot = new Map()
        // A deliberate exit from the plan is progress, not a stall.
        if (dynamic) {
          runtime.consecutiveNoProgress = 0
          runtime.consecutiveWeakOnly = 0
          runtime.lastStrongProgressTurn = turn
          prevFingerprint = undefined
        }
      }
      continue
    }

    if (result.type === 'update_plan_step') {
      const outcome = await handleUpdatePlanStep({ result, sessionId, runId, stream })
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

    if (result.type === 'create_goal') {
      const outcome = await handleCreateGoal({ result, sessionId, runId, stream })
      messages.push(...outcome.messages)
      if (dynamic) {
        runtime.consecutiveNoProgress = 0
        runtime.consecutiveWeakOnly = 0
        runtime.lastStrongProgressTurn = turn
        prevFingerprint = undefined
      }
      continue
    }

    if (result.type === 'get_goal') {
      const outcome = await handleGetGoal({ result, sessionId, runId, stream })
      messages.push(...outcome.messages)
      continue
    }

    if (result.type === 'complete_goal') {
      const outcome = await handleCompleteGoal({ result, sessionId, runId, stream })
      messages.push(...outcome.messages)
      if (dynamic) {
        runtime.consecutiveNoProgress = 0
        runtime.consecutiveWeakOnly = 0
        runtime.lastStrongProgressTurn = turn
        prevFingerprint = undefined
      }
      continue
    }

    if (result.type === 'cancel_goal') {
      const outcome = await handleCancelGoal({ result, sessionId, runId, stream })
      messages.push(...outcome.messages)
      if (dynamic) {
        runtime.consecutiveNoProgress = 0
        runtime.consecutiveWeakOnly = 0
        runtime.lastStrongProgressTurn = turn
        prevFingerprint = undefined
      }
      continue
    }

    if (result.toolCallRecords?.length) {
      const doom = detectDoomLoop(toolCallHistory)
      if (doom.doomed) {
        composeCtx.systemAlerts!.push(
          doom.kind === 'all_failed'
            ? `[System Alert] The last 6 ${doom.lastTool} calls all failed. Do NOT retry with minor changes. Switch to a different approach or tool category, or report the blocker via ask_user.`
            : `[System Alert] ${doom.lastTool} was called repeatedly with identical arguments and produced an identical result each time (no progress). Last args: ${doom.argsPreview}. Stop repeating this exact call; adjust the approach instead.`,
        )
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
        // Goal mode: an active (unfinished) goal must be delivered via
        // submit_result (which marks it completed) or complete_goal.
        const g = currentGoal()
        if (executionMode === 'goal' && g && g.status === 'active') {
          composeCtx.systemAlerts!.push(`[Goal] 目标「${g.outcome}」尚未标记完成。调用 submit_result 提交结果（自动完成目标）或 complete_goal 显式完成，不能以最终回答直接结束。`)
          continue
        }
      }
      if (toolCallHistory.length > 0 && !result.fullText) {
        composeCtx.systemAlerts!.push('[System Note] The task is not complete. Review what you have so far and continue working. Use tools as needed.')
        continue
      }
      break
    }
    // P1-1: post-turn snip + compact moved to the loop tail: turns that end
    // (final_answer released, aborted, or soft-limit/convergence break) never
    // pay for a whole compaction summarization call.
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
    if (shouldSnipTokens(projectedTokens, contextWindow, compactPolicy)) {
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
        maxAttempts: 1,  // P1-1: post-turn management compact, retry once only
      })
      if (compact.didCompact) {
        // Compaction may have summarized away the create_plan details; force
        // the next turn to re-inject the current plan render.
        lastPlanAlert = ''
        sessionStore.update(sessionId, {
          compaction_summary: compact.summary!,
          compaction_until_id: compact.compactedUntilId || null,
        })
        stream?.emit('run.compacted', { session_id: sessionId, run_id: runId, message: 'Context compacted to manage token usage', compaction_summary: compact.summary!, compaction_until_id: compact.compactedUntilId || null })
      }
    }
  }

  // Goal-mode budget accounting: charge this run and pause the goal when the
  // cross-run budget is exhausted (resume creates a fresh Run).
  if (executionMode === 'goal' && goal) {
    goalStore.addUsage(goal.id, totalInputTokens, totalOutputTokens)
    const g = goalStore.get(goal.id)
    if (g && g.status === 'active' && g.budget_tokens && goalStore.usedTokens(g) > g.budget_tokens) {
      goalStore.update(goal.id, { status: 'paused' })
      stream?.emit('goal.paused', {
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
