import { Hono } from 'hono'
import { sessionStore } from '../db/sessionStore.js'
import { messageStore } from '../db/messageStore.js'
import { getDb } from '../db/schema.js'
import { withTransaction } from '../db/sqlite-db.js'
import { providerStore, resolveProviderApiStyle } from '../db/providerStore.js'
import { characterMetaStore } from '../db/characterStore.js'
import { characterContentStore } from '../character/store.js'
import { fallbackSessionTitle, generateSessionTitle } from '../agent/session-title.js'
import { characterPresenceProjector } from '../character/presence-projector.js'
import { runCoordinator } from '../agent/runtime/run-coordinator.js'
import {
  resolveWorkspace, resolveDataspace,
  assembleStaticPrompt, buildInitialMessages,
} from '../agent/loop/context-builder.js'
import { selectAndSummarize } from '../agent/loop/context-compactor.js'
import { estimateTokens, DEFAULT_CONTEXT_WINDOW, resolveCompactPolicy } from '../agent/loop/loop-policy.js'
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
  const session = sessionStore.create({ id: body.id, ...body })
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
  const updated = sessionStore.update(c.req.param('id'), body)
  if (!updated) return c.json({ error: 'Not found' }, 404)
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
      dataspace: source.dataspace,
      parent_id: null,
      character_binding_mode: source.character_binding_mode,
      pinned_character_revision_id: source.pinned_character_revision_id,
      forked_from_session_id: source.id,
      forked_from_message_id: messages[throughIndex].id,
      active_group: source.active_group,
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
    resolveDataspace(session.dataspace),
    { includeToolsListing: process.env.TSS_SYSTEM_TOOLS_LIST === '1' },
  )
  const messages = await buildInitialMessages({
    characterId: session.id,
    systemPrompt,
    memory: charContent.memory || null,
    compactionSummary: session.compaction_summary || null,
    rows: messageStore.getMessagesAfter(id, session.compaction_until_id || 0, 100000),
    compactionUntilId: session.compaction_until_id || 0,
    trimmedUntilId: session.trimmed_until_id || 0,
    providerBaseUrl: provider.base_url,
    cap,
    workspace: resolveWorkspace(session.workspace),
    activeSkills: sessionSkillStore.bodies(id),
  })

  const tokensBefore = estimateTokens(messages)
  const result = await selectAndSummarize(messages, effProvider, model, {
    tools: toolDefs.length > 0 ? toolDefs : undefined,
    contextWindow,
    policy: compactPolicy,
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

export default router
