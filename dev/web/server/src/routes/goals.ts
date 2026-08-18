import { Hono } from 'hono'
import { goalStore, planStore } from '../agent/plan/plan-store.js'
import { sessionStore } from '../db/sessionStore.js'
import { turnStore } from '../db/turnStore.js'
import { messageStore } from '../db/messageStore.js'
import { runStore } from '../agent/runtime/run-store.js'
import { createDurableSocket, publishRunEvent } from '../agent/runtime/run-event-store.js'
import { enqueueRun } from '../agent/session-runner.js'
import { sessionLoop } from '../agent/loop.js'
import type { Server } from 'socket.io'

const router = new Hono()

let ioRef: Server | null = null

export function setGoalRuntime(io: Server) {
  ioRef = io
}

function broadcastSocket(io: Server) {
  return {
    emit: (type: string, ...args: any[]) => { io.emit(type, ...args); return true },
    on: () => undefined,
    off: () => undefined,
    id: 'goal-resume',
  } as any
}

router.get('/:sessionId', (c) => {
  return c.json(goalStore.listForSession(c.req.param('sessionId')))
})

router.get('/plan/:sessionId', (c) => {
  const plan = planStore.getDisplayPlan(c.req.param('sessionId'))
  if (!plan) return c.json(null)
  return c.json({ ...plan, steps: planStore.steps(plan.id) })
})

router.post('/', async (c) => {
  const body = await c.req.json()
  const sessionId = body.session_id
  if (!sessionId) return c.json({ error: 'session_id is required' }, 400)
  if (!sessionStore.getById(sessionId)) return c.json({ error: 'Session not found' }, 404)
  const outcome = typeof body.outcome === 'string' ? body.outcome.trim() : ''
  if (!outcome) return c.json({ error: 'outcome is required' }, 400)
  const goal = goalStore.create({
    session_id: sessionId,
    outcome,
    constraints: typeof body.constraints === 'string' ? body.constraints : null,
    verification: typeof body.verification === 'string' ? body.verification : null,
    budget_tokens: typeof body.budget_tokens === 'number' ? body.budget_tokens : null,
    wake_condition: typeof body.wake_condition === 'string' ? body.wake_condition : null,
  })
  ioRef?.emit('goal.created', {
    session_id: sessionId, goal_id: goal.id, status: goal.status,
    outcome: goal.outcome, verification: goal.verification,
  })
  return c.json(goal, 201)
})

router.patch('/:id', async (c) => {
  const body = await c.req.json()
  const patch: Record<string, unknown> = {}
  if (typeof body.outcome === 'string') patch.outcome = body.outcome
  if (typeof body.constraints === 'string') patch.constraints = body.constraints
  if (typeof body.verification === 'string') patch.verification = body.verification
  if (typeof body.budget_tokens === 'number') patch.budget_tokens = body.budget_tokens
  if (typeof body.wake_condition === 'string') patch.wake_condition = body.wake_condition
  const updated = goalStore.update(c.req.param('id'), patch)
  if (!updated) return c.json({ error: 'Not found' }, 404)
  return c.json(updated)
})

router.post('/:id/pause', (c) => {
  const updated = goalStore.update(c.req.param('id'), { status: 'paused' })
  if (!updated) return c.json({ error: 'Not found' }, 404)
  ioRef?.emit('goal.status.changed', {
    session_id: updated.session_id, goal_id: updated.id, status: 'paused',
  })
  return c.json(updated)
})

/**
 * Resume a paused/active goal with a fresh Run (source=goal). The run prompt
 * re-anchors the model to the outcome, constraints, verification and the
 * last assistant summary.
 */
router.post('/:id/resume', async (c) => {
  const io = ioRef
  if (!io) return c.json({ error: 'Goal runtime is not ready' }, 503)
  const goal = goalStore.get(c.req.param('id'))
  if (!goal) return c.json({ error: 'Not found' }, 404)
  if (goal.status === 'completed' || goal.status === 'cancelled' || goal.status === 'failed') {
    return c.json({ error: `Goal is ${goal.status}` }, 409)
  }
  const session = sessionStore.getById(goal.session_id)
  if (!session) return c.json({ error: 'Session not found' }, 404)

  goalStore.update(goal.id, { status: 'active' })
  const turn = turnStore.create(session.id, 'goal')
  const run = runStore.create(session, { turnId: turn.id, source: 'goal' })
  const history = messageStore.getMessages(session.id, 100000)
  const lastAssistant = [...history].reverse().find(m => m.role === 'assistant')
  const progress = lastAssistant?.content
    ? `\n\n当前进度：\n${lastAssistant.content.slice(0, 2000)}`
    : ''
  const instruction = `继续完成目标：${goal.outcome}${goal.constraints ? `\n约束：${goal.constraints}` : ''}${goal.verification ? `\n验证标准：${goal.verification}` : ''}${progress}`
  const userMessage = messageStore.addMessage(session.id, {
    role: 'user',
    content: instruction,
    turn_id: turn.id,
    run_id: run.id,
  })
  turnStore.attachUserMessage(turn.id, userMessage.id)
  goalStore.update(goal.id, { current_run_id: run.id })

  const rawSocket = broadcastSocket(io)
  publishRunEvent(rawSocket, run.id, 'run.queued', {
    session_id: session.id,
    run_id: run.id,
    character_id: run.character_id,
    character_revision_id: run.character_revision_id,
    goal_id: goal.id,
    source: 'goal',
  })
  const durableSocket = createDurableSocket(rawSocket, run.id)
  const runId = run.id
  enqueueRun(session.id, run.id, async signal => {
    try {
      await sessionLoop(io, durableSocket, session.id, signal, { run_id: runId })
    } catch (error: any) {
      publishRunEvent(rawSocket, runId, 'run.failed', {
        session_id: session.id,
        run_id: runId,
        error: error.message || String(error),
      })
    }
  })
  return c.json({ goal: goalStore.get(goal.id), run_id: runId }, 202)
})

export default router
