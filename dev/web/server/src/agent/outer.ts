import { sessionStore } from '../db/sessionStore.js'
import { messageStore } from '../db/messageStore.js'
import { characterMetaStore, type CharacterRecord } from '../db/characterStore.js'
import { providerStore } from '../db/providerStore.js'
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
import type { Server, Socket } from 'socket.io'
import type { MCPClient } from '../tools/mcp-client.js'
import { runStore } from './runtime/run-store.js'
import { characterRevisionStore, type CharacterRevisionSnapshot } from '../character/revision-store.js'
import {
  DEFAULT_MAX_TURNS, DEFAULT_CONTEXT_WINDOW,
  SOFT_COMPACT_RATIO, COMPACT_THRESHOLD, COLD_RESUME_MS,
  estimateTokens, shouldSnip, systemMessageEnd, trimToolResults,
} from './loop/loop-policy.js'
import {
  resolveWorkspace, resolveWorkspaces, resolveDataspace,
  assembleStaticPrompt, buildInitialMessages,
} from './loop/context-builder.js'
import { selectAndSummarize } from './loop/context-compactor.js'
import { runLoopEngine } from './loop/loop-engine.js'
import { getControlToolDefinitions } from './loop/control-registry.js'
import { goalStore } from './plan/plan-store.js'

function persistComposeChanges(master: LLMMessage[], composed: LLMMessage[]): void {
  if (master.length !== composed.length) return
  for (let i = 0; i < master.length; i++) {
    if (master[i].role === 'user' && master[i].content !== composed[i].content) {
      master[i] = { ...master[i], content: composed[i].content }
    }
  }
}

export interface RunResult {
  status: 'stop' | 'max_turns' | 'cancelled' | 'task_complete'
  sessionId: string
  totalInputTokens: number
  totalOutputTokens: number
  totalCacheHitTokens: number
  totalCacheMissTokens: number
}

export async function sessionLoop(io: Server, socket: Socket, sessionId: string, signal?: AbortSignal, opts: { thinking?: boolean; reasoning_effort?: string; run_id?: string } = {}): Promise<RunResult> {
  const runId = opts.run_id || `run_${sessionId}_${Date.now()}`
  opts.run_id = runId
  const session = sessionStore.getById(sessionId)
  if (!session) { socket.emit('run.failed', { session_id: sessionId, run_id: runId, error: 'Session not found' }); return { status: 'stop', sessionId, totalInputTokens: 0, totalOutputTokens: 0, totalCacheHitTokens: 0, totalCacheMissTokens: 0 } }

  const persistedRun = runStore.get(runId)
  let pinnedSnapshot: CharacterRevisionSnapshot | null = null
  if (persistedRun) {
    const revision = characterRevisionStore.getRevision(persistedRun.character_revision_id)
    if (revision) {
      try { pinnedSnapshot = JSON.parse(revision.snapshot) as CharacterRevisionSnapshot } catch { /* structured failure below */ }
    }
  }
  const charMeta = pinnedSnapshot?.meta || characterMetaStore.getById(session.character_id)
  if (!charMeta) { socket.emit('run.failed', { session_id: sessionId, run_id: runId, error: 'Character not found' }); return { status: 'stop', sessionId, totalInputTokens: 0, totalOutputTokens: 0, totalCacheHitTokens: 0, totalCacheMissTokens: 0 } }

  const charContent = pinnedSnapshot?.content || characterContentStore.get(session.character_id)

  const providerId = session.provider_id
  if (!providerId) { socket.emit('run.failed', { session_id: sessionId, run_id: runId, error: 'No provider configured' }); return { status: 'stop', sessionId, totalInputTokens: 0, totalOutputTokens: 0, totalCacheHitTokens: 0, totalCacheMissTokens: 0 } }

  const provider = providerStore.getById(providerId)
  if (!provider) { socket.emit('run.failed', { session_id: sessionId, run_id: runId, error: 'Provider not found' }); return { status: 'stop', sessionId, totalInputTokens: 0, totalOutputTokens: 0, totalCacheHitTokens: 0, totalCacheMissTokens: 0 } }

  const model = session.model || provider.models[0]?.id
  if (!model) { socket.emit('run.failed', { session_id: sessionId, run_id: runId, error: 'No model configured' }); return { status: 'stop', sessionId, totalInputTokens: 0, totalOutputTokens: 0, totalCacheHitTokens: 0, totalCacheMissTokens: 0 } }

  const modelConfig = provider.models.find(m => m.id === model)
  const contextWindow = modelConfig?.context_window || DEFAULT_CONTEXT_WINDOW
  sessionStore.update(sessionId, { context_window: contextWindow })

  const cap: ProviderCapability = resolveCapability(model, modelConfig?.supports_vision)

  const workspaces = resolveWorkspaces(session)
  const workspace = resolveWorkspace(session.workspace)
  const dataspace = resolveDataspace(session.dataspace)

  const maxTurns = charMeta.maxSteps || DEFAULT_MAX_TURNS

  const toolDefs = getCharacterToolDefinitions(charMeta.tools)

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
  const activeGroup = session.active_group
  const delegateTargets = allChars.filter(c => {
    if (c.role !== 'sub' && c.role !== 'both') return false
    if (c.id === session.character_id) return true
    if (!activeGroup) return false
    if (!c.groups || c.groups.length === 0) return false
    return c.groups.includes(activeGroup)
  })
  // Control actions (delegate_to_agent / submit_result / ask_user) are always
  // visible to the model, separate from the ordinary tool registry.
  toolDefs.push(...getControlToolDefinitions() as any[])
  if (delegateTargets.length > 0) {
    for (const t of toolDefs) {
      if (t.function.name === 'delegate_to_agent') {
        const targetStr = delegateTargets.map(c => `${c.id}(${c.name})`).join(', ')
        t.function.description += ` | targets: ${targetStr}`
      }
    }
  }

  const tools = toolDefs.length > 0 ? toolDefs : undefined

  // Build system prompt — cached by fingerprint
  const key = stableKey(
    charMeta.id,
    normalizeTools(toolDefs),
    charMeta.skills,
    charContent.soul,
    charContent.user,
  )
  let systemPrompt = getCached(key)
  if (!systemPrompt) {
    const comp = extractComponents(charMeta.id, normalizeTools(toolDefs), charMeta.skills, charContent.soul, charContent.user)
    const reasons = diagnoseMiss(charMeta.id, comp)
    console.log(`[system-cache] miss ${key}: ${reasons.join(', ')} (${toolDefs.length} tools, ${(charMeta.skills || []).length} skills)`)
    systemPrompt = assembleStaticPrompt(charMeta, charContent, toolDefs, resolveWorkspace(session.workspace), resolveDataspace(session.dataspace))
    setCached(key, systemPrompt)
  }

  // Memory + compaction summary at fixed positions so prefix cache stays stable
  const messages: LLMMessage[] = await buildInitialMessages({
    characterId: sessionId,
    systemPrompt,
    memory: charContent.memory || null,
    compactionSummary: session.compaction_summary || null,
    rows: messageStore.getMessages(sessionId, 2000),
    compactionUntilId: session.compaction_until_id || 0,
    providerBaseUrl: provider.base_url,
    cap,
    workspace: resolveWorkspace(session.workspace),
  })

  // ── #4 Cold resume: session untouched > 24h → compact ──
  const isColdResume = Date.now() - (session.updated_at || 0) > COLD_RESUME_MS
  if (isColdResume && messages.length > systemMessageEnd(messages) + 1) {
    const result = await selectAndSummarize(messages, provider, model)
    if (result.didCompact) {
      messages.length = 0
      messages.push(...result.messages)
      sessionStore.update(sessionId, {
        compaction_summary: result.summary!,
        compaction_until_id: result.compactedUntilId || null,
      })
      console.log(`[session] ${sessionId} cold resume (>24h): compacted to ${result.messages.length} msgs`)
    }
  }

  // ── #4 Snip stale tool results at 60% before considering compaction ──
  const estTokens = estimateTokens(messages)
  if (estTokens > contextWindow * SOFT_COMPACT_RATIO && estTokens < contextWindow * COMPACT_THRESHOLD) {
    const pct = ((estTokens / contextWindow) * 100).toFixed(0)
    console.log(`[session] ${sessionId} context at ${pct}% (soft threshold 50%)`)
  }
  if (shouldSnip(messages, contextWindow)) {
    const snipTokensBefore = estimateTokens(messages)
    const didSnip = trimToolResults(messages)
    if (didSnip) {
      const after = estimateTokens(messages)
      console.log(`[session] ${sessionId} snip: trimmed old tool results (${snipTokensBefore}→${after} tok)`)
    }
  }

  const composeCtx: ComposeContext = { systemAlerts: [] }

  const executionMode = (session.execution_mode || 'direct') as 'direct' | 'plan_first' | 'goal'
  const activeGoal = executionMode === 'goal'
    ? goalStore.listForSession(sessionId).find(g => g.status === 'active') || null
    : null

  const loopResult = await runLoopEngine({
    sessionId,
    runId,
    socket,
    io,
    signal,
    provider,
    model,
    characterId: session.character_id,
    workspace,
    workspaces,
    dataspace,
    cap,
    tools,
    mcpClients,
    contextWindow,
    maxTurns,
    messages,
    composeCtx,
    opts,
    session,
    executionMode,
    goal: activeGoal,
  })
  const { totalInputTokens, totalOutputTokens, totalCacheHitTokens, totalCacheMissTokens, toolCallHistory, prevPrefixShape, turn } = loopResult
  const completedStatus = loopResult.status

  // ── #1 Cache diagnostics ──
  const detail = toolCallHistory.length === 0 ? 'stop (no tools used)' : completedStatus
  const totalTokens = totalCacheHitTokens + totalCacheMissTokens
  const hitRatio = totalTokens > 0 ? ((totalCacheHitTokens / totalTokens) * 100).toFixed(1) : 'N/A'
  const finalShape = prevPrefixShape
  console.log(`[session] ${sessionId} completed: ${detail} (${turn} turns, ${toolCallHistory.length} tool calls)`)
  console.log(`[cache] ${sessionId}: hit=${totalCacheHitTokens} miss=${totalCacheMissTokens} ratio=${hitRatio}% system=${finalShape?.systemHash?.slice(0,8)||'?'} tools=${finalShape?.toolsHash?.slice(0,8)||'?'}`)
  socket.emit('run.completed', {
    session_id: sessionId,
    run_id: runId,
    status: completedStatus,
    usage: { input_tokens: totalInputTokens, output_tokens: totalOutputTokens },
    cache: { hitTokens: totalCacheHitTokens, missTokens: totalCacheMissTokens, hitRatio },
  })

  if (totalInputTokens > 0 || totalOutputTokens > 0) {
    sessionStore.update(sessionId, {
      input_tokens: (session.input_tokens || 0) + totalInputTokens,
      output_tokens: (session.output_tokens || 0) + totalOutputTokens,
      cache_hit_tokens: totalCacheHitTokens,
      cache_miss_tokens: totalCacheMissTokens,
      cache_hit_ratio: hitRatio,
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
        socket?.emit('evolution:insight_created', {
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


