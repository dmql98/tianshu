import { Hono } from 'hono'
import { sessionStore } from '../db/sessionStore.js'
import { messageStore } from '../db/messageStore.js'
import { getDb } from '../db/schema.js'
import { withTransaction } from '../db/sqlite-db.js'
import { providerStore, resolveProviderApiStyle } from '../db/providerStore.js'
import { characterMetaStore } from '../db/characterStore.js'
import { characterContentStore } from '../character/store.js'
import { getDataDir } from '../config.js'
import { fallbackSessionTitle, generateSessionTitle } from '../agent/session-title.js'
import { characterPresenceProjector } from '../character/presence-projector.js'
import { runCoordinator } from '../agent/runtime/run-coordinator.js'
import { llmCallsForSession, rowToLLMCall, type LLMCallRecord } from '../agent/llm-call-store.js'
import { runStore } from '../agent/runtime/run-store.js'
import { planStore, goalStore } from '../agent/plan/plan-store.js'
import { runEventStore, flushAllPending } from '../agent/runtime/run-event-store.js'
import {
  resolveWorkspace,
  assembleStaticPrompt, buildInitialMessages,
} from '../agent/loop/context-builder.js'
import { selectAndSummarize } from '../agent/loop/context-compactor.js'
import { estimateTokens, DEFAULT_CONTEXT_WINDOW, resolveCompactPolicy, manualCompactThreshold, resolveKeepTokens } from '../agent/loop/loop-policy.js'
import { resolveCapability } from '../agent/attachments.js'
import { getCharacterToolDefinitions } from '../tools/definitions.js'
import { sessionSkillStore } from '../agent/session-skill-store.js'

const router = new Hono()

router.get('/', (c) => c.json(sessionStore.list()))
router.get('/recent', (c) => {
  const raw = c.req.query('limit')
  const limit = raw ? Number.parseInt(raw, 10) : 3
  return c.json(sessionStore.listRecent(limit))
})
router.get('/presences', (c) => c.json(characterPresenceProjector.listBySession()))
router.post('/', async (c) => {
  const body = await c.req.json()
  const charId = (body.character_id as string) || 'general'
  let targets = body.targets
  if (targets === undefined) {
    // 帮手白名单缺省策略：完全取消兜底——没配置就是没有（空列表，不默认 worker）。
    const charMeta = characterMetaStore.getById(charId)
    targets = charMeta?.helpers ?? []
  }
  const session = sessionStore.create({ id: body.id, ...body, targets })
  return c.json(session, 201)
})
router.post('/:id/generate-title', async (c) => {
  const id = c.req.param('id')
  const session = sessionStore.getById(id)
  if (!session) return c.json({ error: 'Not found' }, 404)
  const body = await c.req.json()
  const content = typeof body.content === 'string' ? body.content.trim() : ''
  if (!content) return c.json({ error: 'content is required' }, 400)

  const provider = session.provider_id ? providerStore.getById(session.provider_id) : null
  const model = session.model || provider?.models[0]?.id
  const title = provider && model
    ? await generateSessionTitle({
      content,
      provider,
      model,
      signal: AbortSignal.timeout(20_000),
    })
    : fallbackSessionTitle(content)

  // Do not overwrite a manual rename that happened while generation was running.
  const latest = sessionStore.getById(id)
  const applied = !!latest && !latest.title
  if (applied) sessionStore.update(id, { title })
  return c.json({ title, applied })
})
router.put('/:id', async (c) => {
  const body = await c.req.json()
  const id = c.req.param('id')
  const prev = sessionStore.getById(id)
  const updated = sessionStore.update(id, body)
  if (!updated) return c.json({ error: 'Not found' }, 404)
  // 切回 direct 时清理遗留的计划/目标工件，避免 direct 模式被旧的
  // 计划/目标约束“软强制”（见 loop-engine 的 [Policy Direct] 渲染）。
  const nextMode = (body.execution_mode ?? updated.execution_mode) as string
  if (prev && prev.execution_mode !== 'direct' && nextMode === 'direct') {
    planStore.supersedeActive(id)
    for (const g of goalStore.listForSession(id)) {
      if (g.status === 'active' || g.status === 'paused') {
        goalStore.update(g.id, { status: 'cancelled' })
      }
    }
  }
  return c.json(updated)
})
router.delete('/:id', (c) => {
  const id = c.req.param('id')
  const session = sessionStore.getById(id)
  if (!session) return c.json({ error: 'Not found' }, 404)
  sessionStore.delete(id)
  return c.json({ ok: true })
})
router.delete('/:id/messages', (c) => {
  const keep = c.req.query('keep')
  if (!keep) return c.json({ error: 'Missing keep param' }, 400)
  const count = parseInt(keep, 10)
  if (isNaN(count) || count < 0) return c.json({ error: 'Invalid keep param' }, 400)
  messageStore.keepFirst(c.req.param('id'), count)
  return c.json({ ok: true })
})
router.get('/:id/children', (c) => {
  const id = c.req.param('id')
  return c.json(sessionStore.getChildren(id))
})
router.post('/:id/fork', async (c) => {
  const sourceId = c.req.param('id')
  const source = sessionStore.getById(sourceId)
  if (!source) return c.json({ error: 'Not found' }, 404)

  const body = await c.req.json()
  const targetId = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : crypto.randomUUID()
  if (sessionStore.getById(targetId)) return c.json({ error: 'Session id already exists' }, 409)

  const messages = messageStore.getMessages(sourceId)
  let throughIndex = -1
  if (body.message_id != null && /^\d+$/.test(String(body.message_id))) {
    throughIndex = messages.findIndex(message => message.id === Number(body.message_id))
  }
  if (throughIndex < 0 && Number.isInteger(body.message_count)) {
    throughIndex = Math.min(messages.length, Math.max(0, body.message_count)) - 1
  }
  if (throughIndex < 0 || messages[throughIndex]?.role !== 'assistant') {
    return c.json({ error: 'A valid assistant message is required' }, 400)
  }

  const result = withTransaction(getDb(), () => {
    const title = sessionStore.nextForkTitle(source.title)
    const session = sessionStore.create({
      id: targetId,
      character_id: source.character_id,
      title,
      model: source.model,
      provider_id: source.provider_id,
      workspace: source.workspace,
      workspaces: source.workspaces,
      parent_id: null,
      character_binding_mode: source.character_binding_mode,
      pinned_character_revision_id: source.pinned_character_revision_id,
      forked_from_session_id: source.id,
      forked_from_message_id: messages[throughIndex].id,
      active_group: source.active_group, targets: source.targets || null,
      session_type: 'chat',
      event_id: null,
      current_strategy: source.current_strategy,
      approval_mode: source.approval_mode,
      execution_mode: source.execution_mode,
      reasoning_effort: source.reasoning_effort,
      context_window: source.context_window,
      context_usage: source.context_usage,
    })
    messageStore.copyFirst(sourceId, targetId, throughIndex + 1)
    return { session, messages: messageStore.getMessages(targetId) }
  })

  return c.json(result, 201)
})
router.get('/:id/messages', (c) => {
  const id = c.req.param('id')
  const session = sessionStore.getById(id)
  if (!session) return c.json({ error: 'Not found' }, 404)
  const messages = messageStore.getMessages(id, 100000)
  return c.json({ session, messages, total: messages.length })
})

/**
 * Manual context compaction for an idle session (POST /:id/compact).
 *
 * Rebuilds the model-facing messages exactly like a run start (outer.ts) so
 * the compaction summary is generated from the same conversation content,
 * then persists compaction_summary / compaction_until_id so every later run
 * resumes from the compacted context. Rejects while the session has an active
 * run to avoid racing the in-memory turn loop.
 */
router.post('/:id/compact', async (c) => {
  const id = c.req.param('id')
  const session = sessionStore.getById(id)
  if (!session) return c.json({ error: 'Not found' }, 404)

  const coord = runCoordinator.state(id)
  if (coord.state !== 'idle' || coord.queueLength > 0) {
    return c.json({ error: 'busy', message: '会话正在运行，无法压缩' }, 409)
  }

  const provider = session.provider_id ? providerStore.getById(session.provider_id) : null
  if (!provider) return c.json({ error: 'No provider configured' }, 400)
  const model = session.model || provider.models[0]?.id
  if (!model) return c.json({ error: 'No model configured' }, 400)

  const charMeta = characterMetaStore.getById(session.character_id)
  if (!charMeta) return c.json({ error: 'Character not found' }, 404)
  const charContent = characterContentStore.get(session.character_id)

  const effProvider = {
    ...provider,
    api_style: resolveProviderApiStyle(provider, model),
  }
  const modelConfig = provider.models.find(m => m.id === model)
  const contextWindow = modelConfig?.context_window || DEFAULT_CONTEXT_WINDOW
  const compactPolicy = resolveCompactPolicy(modelConfig)
  const cap = resolveCapability(model, modelConfig?.supports_vision)
  const toolDefs = getCharacterToolDefinitions(charMeta.tools)

  const systemPrompt = assembleStaticPrompt(
    charMeta,
    charContent,
    toolDefs,
    resolveWorkspace(session.workspace),
    getDataDir(),
  )
  const memoryEnabled = charMeta.memory?.enabled !== false
  const messages = await buildInitialMessages({
    characterId: session.id,
    systemPrompt,
    memory: memoryEnabled ? (charContent.memory || null) : null,
    memoryEnabled,
    compactionSummary: session.compaction_summary || null,
    rows: messageStore.getMessagesAfter(id, session.compaction_until_id || 0, 100000),
    compactionUntilId: session.compaction_until_id || 0,
    trimmedUntilId: session.trimmed_until_id || 0,
    providerBaseUrl: provider.base_url,
    cap,
    workspace: resolveWorkspace(session.workspace),
    activeSkills: sessionSkillStore.bodies(id),
  })

  // 手动压缩触发阈值：优先采用 provider 实测 input token（session.context_usage 每轮
  // 持久化，对中文更准），缺失时回退本地估算。与自动压缩（thresholdRatio≈0.75）区分，
  // 手动阈值更低，用户主动点击时更易触发；取 min(窗口×35%, 绝对下限 170k)，1M 窗口
  // 模型在 170k 即可压缩，200k 窗口在 70k 即可压缩。
  const estimatedTokens = estimateTokens(messages)
  const tokensBefore = (session.context_usage && session.context_usage > 0) ? session.context_usage : estimatedTokens
  if (tokensBefore <= manualCompactThreshold(contextWindow)) {
    return c.json({ ok: true, didCompact: false, reason: 'below_manual_threshold', tokensBefore })
  }

  const result = await selectAndSummarize(messages, effProvider, model, {
    tools: toolDefs.length > 0 ? toolDefs : undefined,
    contextWindow,
    policy: compactPolicy,
    // 手动压缩更激进：保留预算按自动重试第 1 档减半（resolveKeepTokens attempt=1），
    // 用户主动点击时压得更彻底，也更不容易卡在"没有可摘旧内容"（head 为空）。
    keepTokens: resolveKeepTokens(contextWindow, 1, compactPolicy),
    summarizationProviderId: compactPolicy.summarizationProvider,
    summarizationModel: compactPolicy.summarizationModel,
  })
  if (!result.didCompact) {
    return c.json({ ok: true, didCompact: false, reason: result.reason || 'nothing_to_compact', tokensBefore })
  }

  const tokensAfter = estimateTokens(result.messages)
  sessionStore.update(id, {
    compaction_summary: result.summary!,
    compaction_until_id: result.compactedUntilId || null,
    context_usage: tokensAfter,
  })
  return c.json({
    ok: true,
    didCompact: true,
    summary: result.summary,
    compactedUntilId: result.compactedUntilId || null,
    tokensBefore,
    tokensAfter,
    messageCount: result.messages.length,
  })
})

/**
 * Aggregated run statistics for the input-bar stats strip (mirrors the
 * deepseek-harness "N 轮 · M 步 | LLM … · 工具调用 … | 首 token … · … tok/s |
 * 缓存命中 …% | 输入 … tok · 输出 … tok" line).
 *
 * - turns: one durable `message.metrics` per assistant LLM call (a run's
 *   `turn_no` is never written, so the event log is the source of truth).
 * - steps: durable `tool.started` events.
 * - toolMs / llmMs / decodeMs / ttftAvgMs: summed from the durable event
 *   payloads (`tool.completed.duration_ms`, `message.metrics.llm_ms` /
 *   `ttft_ms` / `decode_ms`). Events from runs older than the timing fields
 *   simply contribute zero / are skipped.
 * - cacheHitPercent / inputTokens / outputTokens: session-cumulative billing.
 */
router.get('/:id/stats', (c) => {
  const id = c.req.param('id')
  const session = sessionStore.getById(id)
  if (!session) return c.json({ error: 'Not found' }, 404)
  // R9 write-behind：统计直接查 run_events，读取前必须先把 pending 行落库，
  // 否则刚发生的 message.metrics / tool.completed 等还没进表，统计会少计。
  flushAllPending()

  const counts = getDb().prepare(`
    SELECT
      (SELECT COUNT(*) FROM messages WHERE session_id = ?) AS messageCount,
      (SELECT COUNT(*) FROM run_events WHERE session_id = ? AND type = 'message.metrics') AS turns,
      (SELECT COUNT(*) FROM run_events WHERE session_id = ? AND type = 'tool.started') AS steps
  `).get(id, id, id) as { messageCount: number; turns: number; steps: number }

  const sums = getDb().prepare(`
    SELECT
      COALESCE((SELECT SUM(CAST(json_extract(payload, '$.duration_ms') AS INTEGER))
                FROM run_events WHERE session_id = ? AND type = 'tool.completed'), 0) AS toolMs,
      COALESCE((SELECT SUM(CAST(json_extract(payload, '$.llm_ms') AS INTEGER))
                FROM run_events WHERE session_id = ? AND type = 'message.metrics'), 0) AS llmMs,
      COALESCE((SELECT SUM(CAST(json_extract(payload, '$.decode_ms') AS INTEGER))
                FROM run_events WHERE session_id = ? AND type = 'message.metrics'), 0) AS decodeMs,
      (SELECT AVG(CAST(json_extract(payload, '$.ttft_ms') AS INTEGER))
       FROM run_events WHERE session_id = ? AND type = 'message.metrics'
         AND json_extract(payload, '$.ttft_ms') IS NOT NULL) AS ttftAvgMs
  `).get(id, id, id, id) as { toolMs: number; llmMs: number; decodeMs: number; ttftAvgMs: number | null }

  // Live token billing: sum each LLM call's FINAL usage event so the sidebar
  // stats update in near-real-time during a run (the session row only receives
  // cumulative totals when the run ends). Fall back to the session row when no
  // final usage events exist yet (legacy data / provider without usage).
  const usageSums = getDb().prepare(`
    SELECT
      COALESCE((SELECT SUM(CAST(json_extract(payload, '$.input_tokens') AS INTEGER))
                FROM run_events WHERE session_id = ? AND type = 'usage'
                  AND json_extract(payload, '$.usage_type') = 'final'), 0) AS input,
      COALESCE((SELECT SUM(CAST(json_extract(payload, '$.output_tokens') AS INTEGER))
                FROM run_events WHERE session_id = ? AND type = 'usage'
                  AND json_extract(payload, '$.usage_type') = 'final'), 0) AS output,
      COALESCE((SELECT SUM(CAST(json_extract(payload, '$.cache_hit_tokens') AS INTEGER))
                FROM run_events WHERE session_id = ? AND type = 'usage'
                  AND json_extract(payload, '$.usage_type') = 'final'), 0) AS cacheHit,
      COALESCE((SELECT SUM(CAST(json_extract(payload, '$.cache_miss_tokens') AS INTEGER))
                FROM run_events WHERE session_id = ? AND type = 'usage'
                  AND json_extract(payload, '$.usage_type') = 'final'), 0) AS cacheMiss
  `).get(id, id, id, id) as { input: number; output: number; cacheHit: number; cacheMiss: number }

  const inputTokens = usageSums.input > 0 ? usageSums.input : session.input_tokens || 0
  const outputTokens = usageSums.output > 0 ? usageSums.output : session.output_tokens || 0
  const cacheHitTokens = usageSums.cacheHit > 0 ? usageSums.cacheHit : session.cache_hit_tokens || 0
  const cacheMissTokens = usageSums.cacheMiss > 0 ? usageSums.cacheMiss : session.cache_miss_tokens || 0
  const cacheTotal = cacheHitTokens + cacheMissTokens
  return c.json({
    messageCount: counts.messageCount,
    turns: counts.turns,
    steps: counts.steps,
    toolMs: sums.toolMs,
    llmMs: sums.llmMs,
    decodeMs: sums.decodeMs,
    ttftAvgMs: sums.ttftAvgMs,
    cacheHitPercent: cacheTotal > 0 ? Math.round(cacheHitTokens / cacheTotal * 100) : null,
    cacheHitTokens,
    cacheMissTokens,
    inputTokens,
    outputTokens,
  })
})

/**
 * GET /:id/export?scope=basic|full — rich session export.
 * - basic: session metadata + full message history (what the old client-side
 *   session dump produced).
 * - full (default): additionally includes every LLM call trace (llm_calls):
 *   the complete request snapshot (model / messages / tools), response,
 *   reasoning, tool calls, usage, fp and error — the DSH-style full trace.
 */
router.get('/:id/export', (c) => {
  const id = c.req.param('id')
  const session = sessionStore.getById(id)
  if (!session) return c.json({ error: 'Not found' }, 404)
  const scope = c.req.query('scope') === 'basic' ? 'basic' : 'full'
  const messages = messageStore.getMessages(id, 100000)
  const payload: Record<string, unknown> = {
    exportedAt: Date.now(),
    schemaVersion: 1,
    scope,
    session,
    messages,
  }
  if (scope === 'full') {
    payload.llmCalls = llmCallsForSession(id).map(row => rowToLLMCall(row))
  }
  return c.json(payload)
})

/**
 * GET /:id/trajectory — the session-level trajectory, in the spirit of the
 * deepseek-harness trajectory view: one complete, run-aware timeline for THIS
 * session (no run picker on the client).
 *
 * - runs: every run of the session, oldest first (chronological session flow).
 * - messages: every content message of the session, ordered by id — the
 *   conversation backbone of the timeline (user / assistant / tool rows).
 * - events: every non-streaming durable run event of the session (timing
 *   metrics, usage, lifecycle, approvals…), ordered by seq across runs. A
 *   session can contain a continuation chain (resumed_from_run_id) or several
 *   independent user turns; this endpoint merges them into one stream so the
 *   trajectory page can render the whole session, with run boundaries
 *   preserved in each event's run_id.
 * - llmCalls: every LLM call of the session (llm_calls), the complete request
 *   snapshot + response, so per-call inspection survives restarts.
 */
router.get('/:id/trajectory', (c) => {
  const id = c.req.param('id')
  const includeChildren = c.req.query('includeChildren') === '1'
  const session = sessionStore.getById(id)
  if (!session) return c.json({ error: 'Not found' }, 404)

  // P2b-1: includeChildren=1 时把该会话的直接子会话（sub_ 会话）的
  // runs/messages/events/llmCalls 一并聚合，数据自带 session_id，前端可按归属分组。
  const sessionIds = [id]
  if (includeChildren) {
    for (const child of sessionStore.getChildren(id)) sessionIds.push(child.id)
  }

  const runs: ReturnType<typeof runStore.listForSession>[number][] = []
  const messages: ReturnType<typeof messageStore.getMessages>[number][] = []
  const events: Array<{
    event_id: string
    session_id: string
    run_id: string
    seq: number
    type: string
    occurred_at: number
    [key: string]: unknown
  }> = []
  const llmCalls: LLMCallRecord[] = []

  for (const sid of sessionIds) {
    runs.push(...runStore.listForSession(sid, 1000).reverse())
    messages.push(...messageStore.getMessages(sid, 100000))
    llmCalls.push(...llmCallsForSession(sid).map(row => rowToLLMCall(row)))
    const eventRows = getDb().prepare(`
      SELECT event_id, session_id, run_id, seq, type, payload, created_at
      FROM run_events
      WHERE session_id = ? AND type NOT IN ('message.delta', 'tool.output')
      ORDER BY created_at ASC, seq ASC
    `).all(sid) as Array<{
      event_id: string
      session_id: string
      run_id: string
      seq: number
      type: string
      payload: string
      created_at: number
    }>
    for (const event of eventRows) {
      events.push({
        event_id: event.event_id,
        session_id: event.session_id,
        run_id: event.run_id,
        seq: event.seq,
        type: event.type,
        occurred_at: event.created_at,
        ...JSON.parse(event.payload),
      })
    }
  }

  // 跨会话合并后按真实时间归并：内容行按 created_at（id 兜底），事件按时间+seq。
  messages.sort((a, b) => a.created_at - b.created_at || a.id - b.id)
  events.sort((a, b) => a.occurred_at - b.occurred_at || a.seq - b.seq)

  return c.json({
    session: {
      id: session.id,
      title: session.title,
      character_id: session.character_id,
    },
    runs,
    messages,
    events,
    llmCalls,
  })
})

export default router