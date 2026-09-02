import { Hono } from 'hono'
import { goalStore, planStore } from '../agent/plan/plan-store.js'
import { sessionStore } from '../db/sessionStore.js'
import { turnStore } from '../db/turnStore.js'
import { messageStore } from '../db/messageStore.js'
import { runStore } from '../agent/runtime/run-store.js'
import { createDurableStream, publishRunEvent, createNoopBroadcastChannel } from '../agent/runtime/run-event-store.js'
import { fanOutToSinks } from '../transport/event-sinks.js'
import { enqueueRun } from '../agent/session-runner.js'
import { sessionLoop } from '../agent/loop.js'
import type { TransportBroadcaster } from '../transport/runtime.js'

const router = new Hono()

let broadcasterRef: TransportBroadcaster | null = null

export function setGoalRuntime(broadcaster: TransportBroadcaster) {
  broadcasterRef = broadcaster
}

router.get('/:sessionId', (c) => {
  return c.json(goalStore.listForSession(c.req.param('sessionId')))
})

router.get('/plan/:sessionId', (c) => {
  const plan = planStore.getDisplayPlan(c.req.param('sessionId'))
  if (!plan) return c.json(null)
  return c.json({ ...plan, steps: planStore.steps(plan.id) })
})

/**
 * Discard the active plan (user-driven exit): marks it 'cancelled' so the
 * agent loop stops injecting/gating it. Pair with cancel goal when the
 * session also carries an active goal.
 */
router.post('/plan/:sessionId/discard', (c) => {
  const sessionId = c.req.param('sessionId')
  const cancelled = planStore.cancelActive(sessionId)
  if (!cancelled) return c.json({ error: 'No active plan' }, 404)
  broadcasterRef?.emit('plan.cancelled', {
    session_id: sessionId, plan_id: cancelled.id, version: cancelled.version, status: cancelled.status,
  })
  fanOutToSinks('plan.cancelled', {
    session_id: sessionId, plan_id: cancelled.id, version: cancelled.version, status: cancelled.status,
  })
  return c.json(cancelled)
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
  broadcasterRef?.emit('goal.created', {
    session_id: sessionId, goal_id: goal.id, status: goal.status,
    outcome: goal.outcome, verification: goal.verification,
  })
  fanOutToSinks('goal.created', {
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
  broadcasterRef?.emit('goal.status.changed', {
    session_id: updated.session_id, goal_id: updated.id, status: 'paused',
  })
  fanOutToSinks('goal.status.changed', {
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
  const broadcaster = broadcasterRef
  if (!broadcaster) return c.json({ error: 'Goal runtime is not ready' }, 503)
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

  const rawStream = createNoopBroadcastChannel('goal-resume')
  publishRunEvent(rawStream, run.id, 'run.queued', {
    session_id: session.id,
    run_id: run.id,
    character_id: run.character_id,
    character_revision_id: run.character_revision_id,
    goal_id: goal.id,
    source: 'goal',
  })
  const durableStream = createDurableStream(rawStream, run.id)
  const runId = run.id
  enqueueRun(session.id, run.id, async signal => {
    try {
      await sessionLoop(broadcaster, durableStream, session.id, signal, { run_id: runId })
    } catch (error: any) {
      publishRunEvent(rawStream, runId, 'run.failed', {
        session_id: session.id,
        run_id: runId,
        error: error.message || String(error),
      })
    }
  })
  return c.json({ goal: goalStore.get(goal.id), run_id: runId }, 202)
})

/** Cancel an active/paused goal (user-driven exit): stops its injection & gating. */
router.post('/:id/cancel', (c) => {
  const goal = goalStore.get(c.req.param('id'))
  if (!goal) return c.json({ error: 'Not found' }, 404)
  if (goal.status === 'completed' || goal.status === 'cancelled' || goal.status === 'failed') {
    return c.json({ error: `Goal is ${goal.status}` }, 409)
  }
  const updated = goalStore.update(goal.id, { status: 'cancelled' })
  if (!updated) return c.json({ error: 'Not found' }, 404)
  broadcasterRef?.emit('goal.status.changed', {
    session_id: updated.session_id, goal_id: updated.id, status: 'cancelled',
  })
  fanOutToSinks('goal.status.changed', {
    session_id: updated.session_id, goal_id: updated.id, status: 'cancelled',
  })
  return c.json(updated)
})

export default router
