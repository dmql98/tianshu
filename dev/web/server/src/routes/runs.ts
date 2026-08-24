import { Hono } from 'hono'
import { getDb } from '../db/schema.js'
import { runStore } from '../agent/runtime/run-store.js'
import { runEventStore } from '../agent/runtime/run-event-store.js'
import { checkpointStore } from '../agent/runtime/checkpoint-store.js'
import { abortSession, enqueueRun } from '../agent/session-runner.js'
import { sessionStore } from '../db/sessionStore.js'
import { turnStore } from '../db/turnStore.js'
import { messageStore } from '../db/messageStore.js'
import { createDurableStream, publishRunEvent, forceCancelRun, flushAllPending, createNoopBroadcastChannel } from '../agent/runtime/run-event-store.js'
import { createResumedRun } from '../agent/runtime/run-resume-service.js'
import { llmCallsForRun, rowToLLMCall } from '../agent/llm-call-store.js'
import { sessionLoop } from '../agent/loop.js'
import type { TransportBroadcaster } from '../transport/runtime.js'

const router = new Hono()

let broadcasterRef: TransportBroadcaster | null = null

const TERMINAL_RUN_STATUS = new Set([
  'completed', 'failed', 'cancelled', 'max_turns', 'budget_exhausted', 'interrupted',
])

function isNonTerminal(run: { status: string }): boolean {
  return !TERMINAL_RUN_STATUS.has(run.status)
}

export function setRunsRuntime(broadcaster: TransportBroadcaster) {
  broadcasterRef = broadcaster
}

router.get('/', (c) => {
  const sessionId = c.req.query('session_id')
  if (!sessionId) return c.json({ error: 'session_id is required' }, 400)
  const limit = Math.min(50, Math.max(1, Number(c.req.query('limit')) || 10))
  return c.json(runStore.listForSession(sessionId, limit))
})

router.get('/:id', (c) => {
  const run = runStore.get(c.req.param('id'))
  return run ? c.json(run) : c.json({ error: 'Not found' }, 404)
})

router.get('/:id/events', (c) => {
  const run = runStore.get(c.req.param('id'))
  if (!run) return c.json({ error: 'Not found' }, 404)
  const afterSeq = Math.max(0, Number(c.req.query('after_seq')) || 0)
  const events = runEventStore.list(run.id, afterSeq).map(event => ({
    event_id: event.event_id,
    session_id: event.session_id,
    run_id: event.run_id,
    seq: event.seq,
    type: event.type,
    occurred_at: event.created_at,
    ...JSON.parse(event.payload),
  }))
  return c.json(events)
})

/**
 * GET /:id/trajectory — everything the trajectory page needs in one call:
 * the run row, the run's final content messages (user / assistant / tool), and
 * the non-streaming event log (timing metrics, usage, lifecycle, approvals).
 * The high-volume stream types (`message.delta`, `tool.output`) are excluded —
 * the final text lives in `messages`, so no delta reconstruction is needed.
 */
router.get('/:id/trajectory', (c) => {
  const run = runStore.get(c.req.param('id'))
  if (!run) return c.json({ error: 'Not found' }, 404)
  // R9 write-behind：轨迹直查 run_events，读取前先落 pending 行。
  flushAllPending()
  const messages = getDb().prepare(
    'SELECT * FROM messages WHERE run_id = ? ORDER BY id ASC',
  ).all(run.id)
  const eventRows = getDb().prepare(`
    SELECT event_id, session_id, run_id, seq, type, payload, created_at
    FROM run_events
    WHERE run_id = ? AND type NOT IN ('message.delta', 'tool.output')
    ORDER BY seq ASC
  `).all(run.id) as Array<{
    event_id: string
    session_id: string
    run_id: string
    seq: number
    type: string
    payload: string
    created_at: number
  }>
  const events = eventRows.map(event => ({
    event_id: event.event_id,
    session_id: event.session_id,
    run_id: event.run_id,
    seq: event.seq,
    type: event.type,
    occurred_at: event.created_at,
    ...JSON.parse(event.payload),
  }))
  // Per-LLM-call trace for this run (complete request snapshot + response).
  const llmCalls = llmCallsForRun(run.id).map(row => rowToLLMCall(row))
  return c.json({ run, messages, events, llmCalls })
})

router.get('/:id/checkpoints', (c) => {
  const run = runStore.get(c.req.param('id'))
  if (!run) return c.json({ error: 'Not found' }, 404)
  return c.json(checkpointStore.listForRun(run.id))
})

router.post('/:id/cancel', (c) => {
  const run = runStore.get(c.req.param('id'))
  if (!run) return c.json({ error: 'Not found' }, 404)
  const chain = c.req.query('chain') === 'true'
  const accepted = abortSession(run.session_id)
  // Fallback for orphaned/stuck runs (awaiting_approval with no in-memory
  // coordinator entry, e.g. after a restart): force the DB to terminal and
  // broadcast so connected clients leave the streaming state.
  let forceEvent: ReturnType<typeof forceCancelRun> = null
  if (!accepted || !isNonTerminal(run)) {
    forceEvent = forceCancelRun(run.id)
  }
  if (!accepted && !forceEvent) return c.json({ error: 'Run is not active' }, 409)
  if (forceEvent) {
    publishRunEvent(createNoopBroadcastChannel('run-inputs'), run.id, 'run.cancelled', {
      ...JSON.parse(forceEvent.payload),
    })
  }
  // Whole-chain cancel: also terminal any queued/preparing auto successors so
  // they never fire after the user cancelled the chain (§11.1).
  if (chain) {
    const rootId = runStore.chainRootId(run.id)
    for (const member of runStore.listChain(rootId)) {
      if (member.status === 'queued' || member.status === 'preparing') {
        if (member.id !== run.id) {
          const ev = runEventStore.append(member.id, 'run.cancelled', { status: 'cancelled', reason: 'chain_cancelled' })
          if (ev) publishRunEvent(createNoopBroadcastChannel('run-inputs'), member.id, 'run.cancelled', { ...JSON.parse(ev.payload) })
        }
      }
    }
    // Mark the root result as cancelled so no recovery resurrects the chain.
    const root = runStore.get(rootId)
    if (root?.result) {
      try {
        const parsed = JSON.parse(root.result)
        parsed.cancelled = true
        runStore.finish(root.id, root.status as any, { result: parsed })
      } catch { /* ignore */ }
    } else if (root) {
      runStore.finish(root.id, root.status as any, { result: { cancelled: true } })
    }
  }
  return c.json({ ok: true })
})

/**
 * POST /:id/inputs — resume a run parked at an ask_user checkpoint with the
 * user's answer. A fresh Run (resumed_from_run_id) carries the answer into the
 * session so the model can continue. Uses the shared resume service so trigger
 * semantics stay identical to auto continuation (§10.1).
 */
router.post('/:id/inputs', async (c) => {
  const broadcaster = broadcasterRef
  if (!broadcaster) return c.json({ error: 'Run runtime is not ready' }, 503)
  const run = runStore.get(c.req.param('id'))
  if (!run) return c.json({ error: 'Not found' }, 404)
  const body = await c.req.json().catch(() => ({}))
  const answer = typeof body.answer === 'string' ? body.answer.trim() : ''
  if (!answer) return c.json({ error: 'answer is required' }, 400)

  const pending = checkpointStore.listForRun(run.id)
    .filter(chk => chk.reason === 'ask_user')
    .sort((a, b) => b.created_at - a.created_at)[0]
  if (!pending) return c.json({ error: 'Run has no pending ask_user checkpoint' }, 409)

  let question = ''
  try {
    const raw = JSON.parse(pending.pending_request || '{}') as { question?: string }
    question = raw.question || ''
  } catch { /* keep empty */ }

  // The answer must be processed immediately: cancel the currently running
  // run (and any queued runs) so the resumed run starts right away instead
  // of waiting behind an unbounded loop.
  abortSession(run.session_id)

  const instruction = `用户回答了之前的问题${question ? `（问题：${question}）` : ''}：\n${answer}`
  const resumed = createResumedRun({
    previousRunId: run.id,
    trigger: 'user_input',
    instruction,
    createUserTurn: true,
  })
  checkpointStore.clearForRun(run.id, 'ask_user')

  const resumedRun = resumed.run
  const rawStream = createNoopBroadcastChannel('run-inputs')
  publishRunEvent(rawStream, resumedRun.id, 'run.queued', {
    session_id: resumed.session.id,
    run_id: resumedRun.id,
    character_id: resumedRun.character_id,
    character_revision_id: resumedRun.character_revision_id,
    resumed_from_run_id: run.id,
    trigger: 'user_input',
  })
  // Surface the user's answer as a durable message event so the conversation
  // view updates in real time (and survives reconnect replay) instead of
  // requiring a page refresh to read it back from the DB. Fixes the
  // "ask_user answer only appears after refresh" bug.
  if (resumed.userMessageId != null) {
    publishRunEvent(rawStream, resumedRun.id, 'message.created', {
      session_id: resumed.session.id,
      message_id: resumed.userMessageId,
      role: 'user',
      content: instruction,
    })
  }
  const durableStream = createDurableStream(rawStream, resumedRun.id)
  const runId = resumedRun.id
  enqueueRun(resumed.session.id, resumedRun.id, async signal => {
    try {
      await sessionLoop(broadcaster, durableStream, resumed.session.id, signal, { run_id: runId })
    } catch (error: any) {
      publishRunEvent(rawStream, runId, 'run.failed', {
        session_id: resumed.session.id,
        run_id: runId,
        error: error.message || String(error),
      })
    }
  }, () => {
    publishRunEvent(rawStream, runId, 'run.cancelled', {
      session_id: resumed.session.id,
      run_id: runId,
      status: 'cancelled',
      reason: 'queue_cleared',
    })
  })
  return c.json({ run_id: resumedRun.id, status: 'resumed' }, 202)
})

export default router

