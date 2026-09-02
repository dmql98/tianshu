import { sessionStore } from '../db/sessionStore.js'
import { messageStore } from '../db/messageStore.js'
import { fanOutToSinks } from '../transport/event-sinks.js'
import { characterMetaStore, resolveMemoryMode, type CharacterRecord } from '../db/characterStore.js'
import { providerStore, resolveProviderApiStyle } from '../db/providerStore.js'
import { characterContentStore } from '../character/store.js'
import { detectInsight } from '../evolution/index.js'
import { getCharacterToolDefinitions } from '../tools/definitions.js'
import { stableKey, getCached, setCached, normalizeTools, extractComponents, diagnoseMiss } from './system-cache.js'
import { type ComposeContext } from './compose.js'
import { connectMCPServer, disconnectMCPServer } from '../tools/mcp-client.js'
import { mcpServerStore } from '../db/toolStore.js'
import { setMCPStatus } from '../tools/mcp-status.js'
import { fireOnceEvent } from '../event/event-run-adapter.js'
import { evolutionConfig } from '../evolution/evolutionConfig.js'
import * as path from 'path'
import type { LLMMessage } from '../llm/client.js'
import { resolveCapability, type ProviderCapability } from './attachments.js'
import type { TransportBroadcaster } from '../transport/runtime.js'
import type { MCPClient } from '../tools/mcp-client.js'
import { runStore } from './runtime/run-store.js'
import { characterRevisionStore, type CharacterRevisionSnapshot } from '../character/revision-store.js'
import {
  DEFAULT_CONTEXT_WINDOW,
  SOFT_COMPACT_RATIO, COLD_RESUME_MS,
  estimateTokens, shouldSnip, systemMessageEnd, trimToolResults,
  resolveCompactPolicy, shouldCompact, type CompactPolicy,
} from './loop/loop-policy.js'
import {
  resolveWorkspace, resolveWorkspaces,
  assembleStaticPrompt, buildInitialMessages,
} from './loop/context-builder.js'
import { compactWithRetries } from './loop/context-compactor.js'
import { runLoopEngine } from './loop/loop-engine.js'
import { selectControlToolDefinitions } from './loop/control-registry.js'
import { goalStore } from './plan/plan-store.js'
import { sessionSkillStore } from './session-skill-store.js'
import { resolveRunPolicy } from './loop/run-policy-resolver.js'
import { getSystemRunPolicy, getDataDir } from '../config.js'
import { evaluateAutoContinuation, createResumedRun } from './runtime/run-resume-service.js'
import { publishRunEvent, createDurableStream, unwrapDurableStream } from './runtime/run-event-store.js'
import { enqueueRun } from './session-runner.js'

export interface RunResult {
  status: 'stop' | 'max_turns' | 'cancelled' | 'task_complete'
  sessionId: string
  totalInputTokens: number
  totalOutputTokens: number
  totalCacheHitTokens: number
  totalCacheMissTokens: number
}

export async function sessionLoop(broadcaster: TransportBroadcaster, stream: TransportBroadcaster, sessionId: string, signal?: AbortSignal, opts: { thinking?: boolean; reasoning_effort?: string; run_id?: string; systemAlerts?: string[] } = {}): Promise<RunResult> {
  const runId = opts.run_id || `run_${sessionId}_${Date.now()}`
  opts.run_id = runId
  const session = sessionStore.getById(sessionId)
  if (!session) { stream.emit('run.failed', { session_id: sessionId, run_id: runId, error: 'Session not found' }); return { status: 'stop', sessionId, totalInputTokens: 0, totalOutputTokens: 0, totalCacheHitTokens: 0, totalCacheMissTokens: 0 } }

  const persistedRun = runStore.get(runId)
  let pinnedSnapshot: CharacterRevisionSnapshot | null = null
  if (persistedRun) {
    const revision = characterRevisionStore.getRevision(persistedRun.character_revision_id)
    if (revision) {
      try { pinnedSnapshot = JSON.parse(revision.snapshot) as CharacterRevisionSnapshot } catch { /* structured failure below */ }
    }
  }
  const charMeta = pinnedSnapshot?.meta || characterMetaStore.getById(session.character_id)
  if (!charMeta) { stream.emit('run.failed', { session_id: sessionId, run_id: runId, error: 'Character not found' }); return { status: 'stop', sessionId, totalInputTokens: 0, totalOutputTokens: 0, totalCacheHitTokens: 0, totalCacheMissTokens: 0 } }

  const charContent = pinnedSnapshot?.content || characterContentStore.get(session.character_id)

  const providerId = session.provider_id
  if (!providerId) { stream.emit('run.failed', { session_id: sessionId, run_id: runId, error: 'No provider configured' }); return { status: 'stop', sessionId, totalInputTokens: 0, totalOutputTokens: 0, totalCacheHitTokens: 0, totalCacheMissTokens: 0 } }

  const provider = providerStore.getById(providerId)
  if (!provider) { stream.emit('run.failed', { session_id: sessionId, run_id: runId, error: 'Provider not found' }); return { status: 'stop', sessionId, totalInputTokens: 0, totalOutputTokens: 0, totalCacheHitTokens: 0, totalCacheMissTokens: 0 } }

  const model = session.model || provider.models[0]?.id
  if (!model) { stream.emit('run.failed', { session_id: sessionId, run_id: runId, error: 'No model configured' }); return { status: 'stop', sessionId, totalInputTokens: 0, totalOutputTokens: 0, totalCacheHitTokens: 0, totalCacheMissTokens: 0 } }

  // Effective protocol for this run's model: model-level override > provider
  // level > auto-detect (resolved in the LLM client at request time).
  const effProvider = {
    ...provider,
    api_style: resolveProviderApiStyle(provider, model),
  }

  const modelConfig = provider.models.find(m => m.id === model)
  const contextWindow = modelConfig?.context_window || DEFAULT_CONTEXT_WINDOW
  sessionStore.update(sessionId, { context_window: contextWindow })

  // P1-4: 按模型解析压缩策略（阈值/保留比/摘要模型），未配置回退全局默认。
  const compactPolicy: CompactPolicy = resolveCompactPolicy(modelConfig)

  const cap: ProviderCapability = resolveCapability(model, modelConfig?.supports_vision)

  const workspaces = resolveWorkspaces(session)
  const workspace = resolveWorkspace(session.workspace)

  // Run policy is frozen at Run creation (RUN_LIMIT_POLICY_PLAN §5.2). The
  // persisted snapshot is the source of truth; fall back to a fresh resolution
  // only for runs created before the policy feature landed.
  let runPolicy = persistedRun ? runStore.policySnapshot(runId) : null
  if (!runPolicy) {
    runPolicy = resolveRunPolicy(getSystemRunPolicy(), pinnedSnapshot?.meta?.runPolicy as never)
  }
  const maxTurns = runPolicy.effective.absoluteTurns

  // 普通工具：记忆工具由 memoryMode、skill_manager 由技能列表，统一在
  // definitions.ts 内按状态门控（均不纳入「工具管理」开关）。
  const toolDefs = getCharacterToolDefinitions(charMeta.tools, resolveMemoryMode(charMeta.memory), charMeta.skills)

  const mcpClients = new Map<string, MCPClient>()
  const mcpFailedServers: string[] = []
  if (charMeta.tools) {
    const mcpEntries = charMeta.tools.filter((t: { name: string }) => t.name.startsWith('mcp:'))
    for (const entry of mcpEntries) {
      const serverName = entry.name.slice(4)
      const config = mcpServerStore.getAll().find((s: { name: string }) => s.name === serverName)
      if (!config) {
        console.warn(`[mcp] Server "${serverName}" referenced but not configured`)
        setMCPStatus(serverName, { status: 'disabled' })
        mcpFailedServers.push(serverName)
        continue
      }
      setMCPStatus(serverName, { status: 'connecting' })
      let lastError = ''
      const MAX_RETRIES = 3
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          const client = await connectMCPServer(config, resolveWorkspace(session.workspace))
          mcpClients.set(serverName, client)
          for (const tool of client.tools) {
            const fullName = `mcp__${serverName}__${tool.name}`
            toolDefs.push({
              type: 'function' as const,
              function: {
                name: fullName,
                description: tool.description,
                parameters: tool.inputSchema as any,
              },
            })
          }
          setMCPStatus(serverName, { status: 'connected', toolsCount: client.tools.length })
          console.log(`[mcp] Connected "${serverName}" (${client.tools.length} tools)`)
          lastError = ''
          break
        } catch (err: any) {
          lastError = err.message
          if (attempt < MAX_RETRIES) {
            const delay = Math.min(1000 * Math.pow(2, attempt - 1), 4000)
            console.warn(`[mcp] Retry ${attempt}/${MAX_RETRIES} for "${serverName}" in ${delay}ms: ${err.message}`)
            await new Promise(r => setTimeout(r, delay))
          }
        }
      }
      if (lastError) {
        setMCPStatus(serverName, { status: 'failed', error: lastError })
        console.error(`[mcp] Server "${serverName}" failed after ${MAX_RETRIES} retries: ${lastError}`)
        mcpFailedServers.push(serverName)
      }
    }
  }

  // ── #2 delegate_targets → inject into tool schema (not system text) ──
  const allChars = characterMetaStore.getAll()
  const targets = (() => {
    if (!session.targets) return []
    try { const p = JSON.parse(session.targets); return Array.isArray(p) ? p : [] } catch { return [] }
  })()
  const delegateTargets = allChars.filter(c => {
    if (c.role !== 'sub' && c.role !== 'both') return false
    return targets.includes(c.id)
  })
  // Control actions (delegate_to_agent / submit_result / ask_user) are always
  // visible to the model, separate from the ordinary tool registry. 其中依赖
  // 运行时能力的两项按状态门控（selectControlToolDefinitions，不纳入「工具管理」开关）：
  //   - delegate_to_agent / send_message_to_subagent：可委托列表为空 → 不注入
  //     （没有可委托角色时，模型不应看到委派工具）。
  toolDefs.push(...selectControlToolDefinitions({ hasDelegateTargets: delegateTargets.length > 0 }) as any[])
  if (delegateTargets.length > 0) {
    for (const t of toolDefs) {
      if (t.function.name === 'delegate_to_agent') {
        // 注入可委托角色目录：id(名称: 角色简介)。简介为空时省略，避免出现空冒号。
        const targetStr = delegateTargets
          .map(c => {
            const bio = c.description?.trim()
            return bio ? `${c.id}(${c.name}: ${bio})` : `${c.id}(${c.name})`
          })
          .join(', ')
        t.function.description += ` | targets: ${targetStr}`
      }
    }
  }

  const tools = toolDefs.length > 0 ? toolDefs : undefined

  // Build system prompt — cached by fingerprint. P2-1: 工具清单不进 system 文本，
  // 工具已通过 API `tools` 参数下发；system-cache 的 stableKey 已覆盖
  // tools/skills/soul/user/workspace/dataDir，工具变化会使 key 变化 → 缓存正确失效。
  const key = stableKey(
    charMeta.id,
    normalizeTools(toolDefs),
    charMeta.skills,
    charContent.soul,
    charContent.user,
      resolveWorkspace(session.workspace),
    )
  let systemPrompt = getCached(key)
  if (!systemPrompt) {
    const comp = extractComponents(charMeta.id, normalizeTools(toolDefs), charMeta.skills, charContent.soul, charContent.user)
    const reasons = diagnoseMiss(charMeta.id, comp)
    console.log(`[system-cache] miss ${key}: ${reasons.join(', ')} (${toolDefs.length} tools, ${(charMeta.skills || []).length} skills)`)
      systemPrompt = assembleStaticPrompt(charMeta, charContent, toolDefs, resolveWorkspace(session.workspace), getDataDir())
    setCached(key, systemPrompt)
  }

  // Memory + compaction summary at fixed positions so prefix cache stays stable
  // P2-8: 按 compaction_until_id 水位读取，取消 2000 行硬上限（未被压缩的旧消息
  // 超过 2000 条时不得被静默丢弃）。
  const memoryMode = resolveMemoryMode(charMeta.memory)
  const memoryEnabled = memoryMode !== 'off'
  const messages: LLMMessage[] = await buildInitialMessages({
    characterId: sessionId,
    systemPrompt,
    memory: memoryEnabled ? (charContent.memory || null) : null,
    memoryEnabled,
    memoryMode,
    compactionSummary: session.compaction_summary || null,
    rows: messageStore.getMessagesAfter(sessionId, session.compaction_until_id || 0, 100000),
    compactionUntilId: session.compaction_until_id || 0,
    trimmedUntilId: session.trimmed_until_id || 0,
    providerBaseUrl: provider.base_url,
    cap,
    workspace: resolveWorkspace(session.workspace),
    activeSkills: sessionSkillStore.bodies(sessionId),
  })

  // ── #4 Cold resume: session untouched > 24h → 仅在超阈值时压缩 ──
  // P2-8: 不再"一刀切只留 KEEP_TOKENS"，而是仅在确实超过阈值时压缩，且保留
  // 预算按窗口缩放（P1-3）。system 前缀永不压缩。
  const isColdResume = Date.now() - (session.updated_at || 0) > COLD_RESUME_MS
  if (isColdResume && messages.length > systemMessageEnd(messages) + 1 && shouldCompact(messages, contextWindow, compactPolicy)) {
    const result = await compactWithRetries(messages, effProvider, model, {
      tools, contextWindow, policy: compactPolicy,
      summarizationProviderId: compactPolicy.summarizationProvider,
      summarizationModel: compactPolicy.summarizationModel,
    })
    if (result.didCompact) {
      sessionStore.update(sessionId, {
        compaction_summary: result.summary!,
        compaction_until_id: result.compactedUntilId || null,
      })
      console.log(`[session] ${sessionId} cold resume (>24h): compacted to ${messages.length} msgs`)
    }
  }

  // ── #4 Snip stale tool results at 60% before considering compaction ──
  const estTokens = estimateTokens(messages)
  if (estTokens > contextWindow * SOFT_COMPACT_RATIO && estTokens < contextWindow * compactPolicy.thresholdRatio) {
    const pct = ((estTokens / contextWindow) * 100).toFixed(0)
    console.log(`[session] ${sessionId} context at ${pct}% (soft threshold 50%)`)
  }
  if (shouldSnip(messages, contextWindow, compactPolicy)) {
    const snipTokensBefore = estimateTokens(messages)
    const { pruned: didSnip, trimmedUntilId } = trimToolResults(messages)
    if (didSnip) {
      const after = estimateTokens(messages)
      console.log(`[session] ${sessionId} snip: trimmed old tool results (${snipTokensBefore}→${after} tok)`)
      // P0-4: 持久化剪枝水印，重载时按同一剪枝恢复内存态。
      if (trimmedUntilId > (session.trimmed_until_id || 0)) {
        sessionStore.update(sessionId, { trimmed_until_id: trimmedUntilId })
      }
    }
  }

  const composeCtx: ComposeContext = { systemAlerts: [...(opts.systemAlerts || [])] }

  const rawMode = (session.execution_mode || 'direct') as 'direct' | 'plan_first' | 'goal'
  // Execution modes: direct (plan/goal 均可选) / plan_first (必须建计划) /
  // goal (必须建计划+目标)。由用户在 UI 下拉选择，新会话默认 direct。
  const executionMode = rawMode === 'plan_first' ? 'plan_first' : rawMode === 'goal' ? 'goal' : 'direct'
  const activeGoal = executionMode === 'goal'
    ? goalStore.listForSession(sessionId).find(g => g.status === 'active' || g.status === 'paused') || null
    : null

  const loopResult = await runLoopEngine({
    sessionId,
    runId,
    stream,
    broadcaster,
    signal,
    provider: effProvider,
    model,
    characterId: session.character_id,
    workspace,
    workspaces,
    cap,
    tools,
    mcpClients,
    contextWindow,
    compactPolicy,
    maxTurns,
    policy: runPolicy,
    messages,
    composeCtx,
    opts,
    session,
    executionMode,
    goal: activeGoal,
    hasDelegateTargets: delegateTargets.length > 0,
  })
  const { totalInputTokens, totalOutputTokens, totalCacheHitTokens, totalCacheMissTokens, toolCallHistory, prevPrefixShape, turn } = loopResult
  let limitSummary = loopResult.limitSummary
  const completedStatus = loopResult.status

  // ── #5 Auto continuation (§10) ──
  // When the loop hits its limit in a continuable mode, schedule a successor
  // before publishing the terminal event so the client never observes a gap.
  let continuationScheduled = false
  let nextRunId: string | undefined
  if (completedStatus === 'max_turns' && persistedRun) {
    try {
      const eligibility = evaluateAutoContinuation(persistedRun)
      if (eligibility.eligible) {
        const resumed = createResumedRun({
          previousRunId: persistedRun.id,
          trigger: 'auto_limit',
          instruction: `[System] 上一轮运行达到软上限。继续完成剩余计划步骤（第 ${(persistedRun.continuation_index || 0) + 1} 次自动续跑）。`,
          createUserTurn: false,
        })
        continuationScheduled = true
        nextRunId = resumed.run.id

        // Publish the successor's queued event and enqueue it.
        const rawStream = unwrapDurableStream(stream) || stream
        publishRunEvent(rawStream, resumed.run.id, 'run.queued', {
          session_id: sessionId,
          run_id: resumed.run.id,
          character_id: resumed.run.character_id,
          character_revision_id: resumed.run.character_revision_id,
          resumed_from_run_id: persistedRun.id,
          trigger: 'auto_limit',
        })
        stream.emit('run.continuation_queued', {
          session_id: sessionId,
          run_id: runId,
          next_run_id: resumed.run.id,
          continuation_index: resumed.run.continuation_index,
        })
        const nextRunIdLocal = resumed.run.id
        const nextDurableStream = createDurableStream(rawStream, nextRunIdLocal)
        enqueueRun(sessionId, nextRunIdLocal, async signal => {
          try {
            await sessionLoop(broadcaster, nextDurableStream, sessionId, signal, { run_id: nextRunIdLocal })
          } catch (error: any) {
            publishRunEvent(rawStream, nextRunIdLocal, 'run.failed', {
              session_id: sessionId,
              run_id: nextRunIdLocal,
              error: error.message || String(error),
            })
          }
        }, () => {
          publishRunEvent(rawStream, nextRunIdLocal, 'run.cancelled', {
            session_id: sessionId,
            run_id: nextRunIdLocal,
            status: 'cancelled',
            reason: 'queue_cleared',
          })
        })
      }
    } catch (error: any) {
      // Continuation creation failure must NOT break the finished run.
      console.warn(`[session] ${sessionId} auto-continuation failed: ${error.message || error}`)
    }
  }

  if (limitSummary && continuationScheduled) {
    limitSummary = { ...limitSummary, continuationScheduled, nextRunId }
  }

  // ── #1 Cache diagnostics ──
  const detail = toolCallHistory.length === 0 ? 'stop (no tools used)' : completedStatus
  const totalTokens = totalCacheHitTokens + totalCacheMissTokens
  const hitRatio = totalTokens > 0 ? ((totalCacheHitTokens / totalTokens) * 100).toFixed(1) : 'N/A'
  const finalShape = prevPrefixShape
  console.log(`[session] ${sessionId} completed: ${detail} (${turn} turns, ${toolCallHistory.length} tool calls)`)
  console.log(`[cache] ${sessionId}: hit=${totalCacheHitTokens} miss=${totalCacheMissTokens} ratio=${hitRatio}% system=${finalShape?.systemHash?.slice(0,8)||'?'} tools=${finalShape?.toolsHash?.slice(0,8)||'?'}`)
  const terminalEvent = completedStatus === 'cancelled'
    ? 'run.cancelled'
    : limitSummary
      ? 'run.max_turns'
      : 'run.completed'
  // Cache stats are emitted as SESSION CUMULATIVE totals (baseline from prior
  // runs + this run), matching what is persisted to sessions below, so the UI
  // cache hit number stays consistent with the DB and updates per run.
  const hitTotal = (session.cache_hit_tokens || 0) + totalCacheHitTokens
  const missTotal = (session.cache_miss_tokens || 0) + totalCacheMissTokens
  const cumulativeRatio = hitTotal + missTotal > 0
    ? ((hitTotal / (hitTotal + missTotal)) * 100).toFixed(1)
    : 'N/A'
  stream.emit(terminalEvent, {
    session_id: sessionId,
    run_id: runId,
    status: completedStatus,
    ...(completedStatus === 'cancelled' ? { reason: 'user_requested' } : {}),
    ...(limitSummary ? {
      limit_summary: limitSummary,
      result: {
        limitSummary,
        ...(continuationScheduled ? { continuationScheduled, nextRunId } : {}),
      },
    } : {}),
    usage: { input_tokens: totalInputTokens, output_tokens: totalOutputTokens },
    cache: { hitTokens: hitTotal, missTokens: missTotal, hitRatio: cumulativeRatio },
  })

  if (totalInputTokens > 0 || totalOutputTokens > 0) {
    sessionStore.update(sessionId, {
      input_tokens: (session.input_tokens || 0) + totalInputTokens,
      output_tokens: (session.output_tokens || 0) + totalOutputTokens,
      cache_hit_tokens: hitTotal,
      cache_miss_tokens: missTotal,
      cache_hit_ratio: cumulativeRatio,
    })
  }

  // Check evolution at session end, not during the loop
  if (toolCallHistory.length > 0 && charMeta.memory?.selfEvolution) {
    const cfg = evolutionConfig.get()
    if (cfg.character_id) {
      const insight = detectInsight(toolCallHistory, sessionId, session.character_id, {
        window: cfg.detect_window,
        errorRateThreshold: cfg.error_rate_threshold,
        repetitionCount: cfg.repetition_count,
        highFreqMinCalls: cfg.high_freq_min_calls,
        highFreqMaxUnique: cfg.high_freq_max_unique,
      })
      if (insight) {
        // Include user's original intent to guide skill creation toward domain tasks
        const firstUserMsg = messages.find(m => m.role === 'user')?.content || ''
        const userGoal = firstUserMsg.length > 200 ? firstUserMsg.slice(0, 200) + '…' : firstUserMsg
        const instruction = `Session: ${session.id}\nDetected: ${insight.description}\n\nUser's original request:\n${userGoal}\n\n${cfg.content || 'Analyze this session and create a skill for the task the user was trying to accomplish.'}`
        fireOnceEvent({
          name: `Insight: ${insight.type}`,
          instruction,
          characterId: cfg.character_id,
          assignedGroup: cfg.group_id || null,
          providerId: cfg.provider_id || null,
          model: cfg.model || null,
          workspace: cfg.workspace || null,
          approvalMode: 'Auto Approve',
        })
        stream?.emit('evolution:insight_created', {
          session_id: session.id,
          insight_type: insight.type,
          description: insight.description,
          notify_enabled: cfg.notify_enabled,
          notify_timeout: cfg.notify_timeout,
        })
        fanOutToSinks('evolution:insight_created', {
          session_id: session.id,
          insight_type: insight.type,
          description: insight.description,
          notify_enabled: cfg.notify_enabled,
          notify_timeout: cfg.notify_timeout,
        })
      }
    }
  }

  for (const [, client] of mcpClients) {
    await disconnectMCPServer(client).catch(() => {})
  }

  return { status: completedStatus, sessionId, totalInputTokens, totalOutputTokens, totalCacheHitTokens, totalCacheMissTokens }
}


