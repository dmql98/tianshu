import { Hono } from 'hono'
import { runStore } from '../agent/runtime/run-store.js'
import { runEventStore } from '../agent/runtime/run-event-store.js'
import { checkpointStore } from '../agent/runtime/checkpoint-store.js'
import { abortSession, enqueueRun } from '../agent/session-runner.js'
import { sessionStore } from '../db/sessionStore.js'
import { turnStore } from '../db/turnStore.js'
import { messageStore } from '../db/messageStore.js'
import { createDurableSocket, publishRunEvent } from '../agent/runtime/run-event-store.js'
import { sessionLoop } from '../agent/loop.js'
import type { Server } from 'socket.io'

const router = new Hono()

let ioRef: Server | null = null

export function setRunsRuntime(io: Server) {
  ioRef = io
}

function broadcastSocket(io: Server) {
  return {
    emit: (type: string, ...args: any[]) => { io.emit(type, ...args); return true },
    on: () => undefined,
    off: () => undefined,
    id: 'run-inputs',
  } as any
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

router.get('/:id/checkpoints', (c) => {
  const run = runStore.get(c.req.param('id'))
  if (!run) return c.json({ error: 'Not found' }, 404)
  return c.json(checkpointStore.listForRun(run.id))
})

router.post('/:id/cancel', (c) => {
  const run = runStore.get(c.req.param('id'))
  if (!run) return c.json({ error: 'Not found' }, 404)
  const accepted = abortSession(run.session_id)
  return accepted ? c.json({ ok: true }) : c.json({ error: 'Run is not active' }, 409)
})

/**
 * POST /:id/inputs — resume a run parked at an ask_user checkpoint with the
 * user's answer. A fresh Run (resumed_from_run_id) carries the answer into the
 * session so the model can continue.
 */
router.post('/:id/inputs', async (c) => {
  const io = ioRef
  if (!io) return c.json({ error: 'Run runtime is not ready' }, 503)
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

  const session = sessionStore.getById(run.session_id)
  if (!session) return c.json({ error: 'Session not found' }, 404)

  // The answer must be processed immediately: cancel the currently running
  // run (and any queued runs) so the resumed run starts right away instead
  // of waiting behind an unbounded loop.
  abortSession(run.session_id)

  const turn = turnStore.create(session.id, 'user')
  const resumedRun = runStore.create(session, {
    turnId: turn.id,
    resumedFromRunId: run.id,
    source: 'chat',
  })
  const instruction = `用户回答了之前的问题${question ? `（问题：${question}）` : ''}：\n${answer}`
  const userMessage = messageStore.addMessage(session.id, {
    role: 'user',
    content: instruction,
    turn_id: turn.id,
    run_id: resumedRun.id,
  })
  turnStore.attachUserMessage(turn.id, userMessage.id)
  checkpointStore.clearForRun(run.id, 'ask_user')

  const rawSocket = broadcastSocket(io)
  publishRunEvent(rawSocket, resumedRun.id, 'run.queued', {
    session_id: session.id,
    run_id: resumedRun.id,
    character_id: resumedRun.character_id,
    character_revision_id: resumedRun.character_revision_id,
    resumed_from_run_id: run.id,
  })
  const durableSocket = createDurableSocket(rawSocket, resumedRun.id)
  const runId = resumedRun.id
  enqueueRun(session.id, resumedRun.id, async signal => {
    try {
      await sessionLoop(io, durableSocket, session.id, signal, { run_id: runId })
    } catch (error: any) {
      publishRunEvent(rawSocket, runId, 'run.failed', {
        session_id: session.id,
        run_id: runId,
        error: error.message || String(error),
      })
    }
  }, () => {
    publishRunEvent(rawSocket, runId, 'run.cancelled', {
      session_id: session.id,
      run_id: runId,
      status: 'cancelled',
      reason: 'queue_cleared',
    })
  })
  return c.json({ run_id: resumedRun.id, status: 'resumed' }, 202)
})

export default router

