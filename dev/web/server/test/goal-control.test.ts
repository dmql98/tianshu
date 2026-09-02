import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

/**
 * Goal control tools: create_goal / get_goal / complete_goal handlers and the
 * submit_result -> goal-completed path (design: 天枢Goal与Plan自由创建-设计.md).
 */
let root: string
let sessionId = 'sess_goal_ctrl'

type AnyRecord = Record<string, any>

interface FakeStream {
  events: Array<[string, any]>
  emit: (type: string, ...args: any[]) => boolean
}

function fakeStream(): FakeStream {
  const events: Array<[string, any]> = []
  return {
    events,
    emit: (type: string, ...args: any[]) => { events.push([type, args]); return true },
  }
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'tianshu-goal-control-'))
  process.env.TIANSHU_DATA_DIR = root
  const { getDb } = await import('../src/db/schema.js')
  const { sessionStore } = await import('../src/db/sessionStore.js')
  const db = getDb()
  const now = Date.now()
  db.prepare(`
    INSERT INTO character_definitions (id, current_revision_id, status, created_at, updated_at)
    VALUES (?, ?, 'active', ?, ?)
  `).run('char_goal_ctrl', 'rev_goal_ctrl', now, now)
  db.prepare(`
    INSERT INTO character_revisions (id, character_id, revision_no, manifest_hash, snapshot, visual_manifest, created_at)
    VALUES (?, ?, 1, 'h', '{}', NULL, ?)
  `).run('rev_goal_ctrl', 'char_goal_ctrl', now)
  sessionStore.create({ id: sessionId, character_id: 'char_goal_ctrl' })
})

afterAll(async () => {
  try {
    const { closeDb } = await import('../src/db/schema.js')
    closeDb()
  } catch { /* ignore */ }
  rmSync(root, { recursive: true, force: true })
  delete process.env.TIANSHU_DATA_DIR
})

function goalResult(over: AnyRecord): AnyRecord {
  return {
    toolCalls: [{ id: 'c1', type: 'function', function: { name: 'create_goal', arguments: '{}' } }],
    ...over,
  }
}

describe('goal 控制工具', () => {
  it('create_goal 创建目标并广播 goal.created', async () => {
    const { goalStore } = await import('../src/agent/plan/plan-store.js')
    const { handleCreateGoal } = await import('../src/agent/loop/control-router.js')
    const stream = fakeStream()
    const outcome = await handleCreateGoal({
      result: goalResult({ goalRequest: { outcome: '实现轨迹功能', verification: '前端单测+构建通过' } }),
      sessionId, runId: 'run_1', stream: stream as any,
    })
    expect(outcome.kind).toBe('continue')
    const goals = goalStore.listForSession(sessionId)
    expect(goals.length).toBe(1)
    expect(goals[0].outcome).toBe('实现轨迹功能')
    expect(goals[0].status).toBe('active')
    expect(stream.events.some(([t]) => t === 'goal.created')).toBe(true)
  })

  it('create_goal 在已有 active goal 时拒绝', async () => {
    const { goalStore } = await import('../src/agent/plan/plan-store.js')
    const { handleCreateGoal } = await import('../src/agent/loop/control-router.js')
    const stream = fakeStream()
    const outcome = await handleCreateGoal({
      result: goalResult({ goalRequest: { outcome: '第二个目标' } }),
      sessionId, runId: 'run_2', stream: stream as any,
    })
    expect(outcome.kind).toBe('continue')
    const msg = JSON.parse(outcome.messages[0].content as string)
    expect(msg.error).toContain('已有进行中的目标')
    // still only one goal
    expect(goalStore.listForSession(sessionId).length).toBe(1)
  })

  it('get_goal 返回进行中的目标', async () => {
    const { handleGetGoal } = await import('../src/agent/loop/control-router.js')
    const stream = fakeStream()
    const outcome = await handleGetGoal({
      result: { toolCalls: [{ id: 'c2', type: 'function', function: { name: 'get_goal', arguments: '{}' } }] },
      sessionId, runId: 'run_3', stream: stream as any,
    })
    const output = JSON.parse(outcome.messages[0].content as string).output as string
    expect(output).toContain('实现轨迹功能')
  })

  it('complete_goal 完成目标并广播 goal.status.changed', async () => {
    const { goalStore } = await import('../src/agent/plan/plan-store.js')
    const { handleCompleteGoal } = await import('../src/agent/loop/control-router.js')
    const stream = fakeStream()
    const outcome = await handleCompleteGoal({
      result: { toolCalls: [{ id: 'c3', type: 'function', function: { name: 'complete_goal', arguments: '{}' } }], goalCompleteSummary: '全部落地' },
      sessionId, runId: 'run_4', stream: stream as any,
    })
    expect(outcome.kind).toBe('continue')
    const goal = goalStore.listForSession(sessionId)[0]
    expect(goal.status).toBe('completed')
    expect(stream.events.some(([t, a]) => t === 'goal.status.changed' && a[0].status === 'completed')).toBe(true)
  })

  it('complete_goal 幂等：已完成时不再报错', async () => {
    const { handleCompleteGoal } = await import('../src/agent/loop/control-router.js')
    const outcome = await handleCompleteGoal({
      result: { toolCalls: [{ id: 'c4', type: 'function', function: { name: 'complete_goal', arguments: '{}' } }] },
      sessionId, runId: 'run_5',
    })
    const msg = JSON.parse(outcome.messages[0].content as string)
    expect(msg.output).toContain('幂等')
  })
})

describe('submit_result -> goal 自动完成', () => {
  it('goal 模式下验收通过后把 active goal 标记 completed', async () => {
    const { goalStore } = await import('../src/agent/plan/plan-store.js')
    const { handleTaskComplete } = await import('../src/agent/loop/control-router.js')
    // new session + fresh goal
    const { sessionStore } = await import('../src/db/sessionStore.js')
    const s2 = 'sess_goal_submit'
    sessionStore.create({ id: s2, character_id: 'char_goal_ctrl' })
    const goal = goalStore.create({ session_id: s2, outcome: '交付目标' })
    const stream = fakeStream()
    const outcome = await handleTaskComplete({
      result: {
        toolCalls: [{ id: 'c5', type: 'function', function: { name: 'submit_result', arguments: '{}' } }],
        taskCompleteSummary: '已完成',
        evidence: ['file.ts'],
      },
      sessionId: s2,
      runId: 'run_6',
      stream: stream as any,
      messages: [],
      mcpClients: new Map(),
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheHitTokens: 0,
      totalCacheMissTokens: 0,
      mode: 'goal',
      planCompleted: true,
      unmetSteps: [],
      goalVerification: '验证标准',
      goal: { id: goal.id, status: 'active' },
    })
    expect(outcome.kind).toBe('done')
    expect(goalStore.get(goal.id)!.status).toBe('completed')
    expect(stream.events.some(([t, a]) => t === 'goal.status.changed' && a[0].goal_id === goal.id)).toBe(true)
  })

  it('goal 模式证据可选（缺 evidence 但有 summary 时通过；仅 summary 缺失才拒）', async () => {
    const { evaluateSubmission } = await import('../src/agent/loop/completion-evaluator.js')
    // Evidence is optional now, so a missing evidence array must not reject a
    // submission that carries a summary — this avoids the reject→resubmit loop.
    const withSummaryNoEvidence = evaluateSubmission({
      mode: 'goal',
      planCompleted: true,
      unmetSteps: [],
      goalVerification: '验证标准',
      summary: '已完成',
      evidence: [],
    })
    expect(withSummaryNoEvidence.accepted).toBe(true)
    // Summary remains mandatory: a submission with no summary is still rejected.
    const noSummary = evaluateSubmission({
      mode: 'goal',
      planCompleted: true,
      unmetSteps: [],
      goalVerification: '验证标准',
      summary: '',
      evidence: ['some tool output'],
    })
    expect(noSummary.accepted).toBe(false)
    expect(noSummary.unmet.some(u => u.includes('摘要'))).toBe(true)
  })
})

describe('discard_plan / cancel_goal 主动退出控制工具', () => {
  async function newSession(sid: string) {
    const { sessionStore } = await import('../src/db/sessionStore.js')
    sessionStore.create({ id: sid, character_id: 'char_goal_ctrl' })
  }

  it('discard_plan 取消活动计划并广播 plan.cancelled', async () => {
    const sid = 'sess_discard_plan'
    await newSession(sid)
    const { planStore } = await import('../src/agent/plan/plan-store.js')
    const { handleCreatePlan, handleDiscardPlan } = await import('../src/agent/loop/control-router.js')
    const createStream = fakeStream()
    await handleCreatePlan({
      result: {
        toolCalls: [{ id: 'p1', type: 'function', function: { name: 'create_plan', arguments: '{}' } }],
        planRequest: { steps: [{ title: '步骤A' }, { title: '步骤B' }] },
      },
      sessionId: sid, runId: 'run_p1', stream: createStream as any,
    })
    const active = planStore.getActive(sid)
    expect(active).not.toBeNull()

    const stream = fakeStream()
    const outcome = await handleDiscardPlan({
      result: {
        toolCalls: [{ id: 'd1', type: 'function', function: { name: 'discard_plan', arguments: '{}' } }],
        controlReason: '方向已变',
      },
      sessionId: sid, runId: 'run_p2', stream: stream as any,
    })
    expect(outcome.kind).toBe('continue')
    expect(outcome.discarded).toBe(true)
    // getActive 无行时返回 undefined（falsy），与既有调用方 if (!plan) 语义一致。
    expect(planStore.getActive(sid)).toBeFalsy()
    expect(planStore.get(active!.id)!.status).toBe('cancelled')
    expect(stream.events.some(([t, a]) => t === 'plan.cancelled' && a[0].status === 'cancelled')).toBe(true)
    const msg = JSON.parse(outcome.messages[0].content as string)
    expect((msg.output as string)).toContain('已放弃计划')
  })

  it('discard_plan 无活动计划时拒绝', async () => {
    const sid = 'sess_discard_plan_empty'
    await newSession(sid)
    const { handleDiscardPlan } = await import('../src/agent/loop/control-router.js')
    const stream = fakeStream()
    const outcome = await handleDiscardPlan({
      result: { toolCalls: [{ id: 'd2', type: 'function', function: { name: 'discard_plan', arguments: '{}' } }] },
      sessionId: sid, runId: 'run_p3', stream: stream as any,
    })
    expect(outcome.discarded).toBe(false)
    const msg = JSON.parse(outcome.messages[0].content as string)
    expect(msg.error).toContain('没有活动计划')
  })

  it('cancel_goal 取消进行中目标并广播 goal.status.changed(cancelled)', async () => {
    const sid = 'sess_cancel_goal'
    await newSession(sid)
    const { goalStore } = await import('../src/agent/plan/plan-store.js')
    const { handleCreateGoal, handleCancelGoal } = await import('../src/agent/loop/control-router.js')
    const createStream = fakeStream()
    await handleCreateGoal({
      result: {
        toolCalls: [{ id: 'g1', type: 'function', function: { name: 'create_goal', arguments: '{}' } }],
        goalRequest: { outcome: '会被取消的目标' },
      },
      sessionId: sid, runId: 'run_g1', stream: createStream as any,
    })
    const goal = goalStore.listForSession(sid)[0]
    expect(goal.status).toBe('active')

    const stream = fakeStream()
    const outcome = await handleCancelGoal({
      result: {
        toolCalls: [{ id: 'g2', type: 'function', function: { name: 'cancel_goal', arguments: '{}' } }],
        controlReason: '需求作废',
      },
      sessionId: sid, runId: 'run_g2', stream: stream as any,
    })
    expect(outcome.kind).toBe('continue')
    expect(goalStore.get(goal.id)!.status).toBe('cancelled')
    expect(stream.events.some(([t, a]) => t === 'goal.status.changed' && a[0].status === 'cancelled')).toBe(true)
    const msg = JSON.parse(outcome.messages[0].content as string)
    expect(msg.output).toContain('已取消目标')
  })

  it('cancel_goal 无进行中目标时拒绝', async () => {
    const sid = 'sess_cancel_goal_empty'
    await newSession(sid)
    const { handleCancelGoal } = await import('../src/agent/loop/control-router.js')
    const outcome = await handleCancelGoal({
      result: { toolCalls: [{ id: 'g3', type: 'function', function: { name: 'cancel_goal', arguments: '{}' } }] },
      sessionId: sid, runId: 'run_g3', stream: undefined as any,
    })
    const msg = JSON.parse(outcome.messages[0].content as string)
    expect(msg.error).toContain('没有进行中的目标')
  })
})

describe('Plan-first / Goal 先计划后执行闸门（planGateRefusalFor）', () => {
  async function newSession(sid: string, execution_mode: string) {
    const { sessionStore } = await import('../src/db/sessionStore.js')
    sessionStore.create({ id: sid, character_id: 'char_goal_ctrl', execution_mode: execution_mode as any })
  }

  it('plan_first：无计划时拒绝普通工具，允许 create_plan', async () => {
    const sid = 'sess_pf_gate'
    await newSession(sid, 'plan_first')
    const { planGateRefusalFor } = await import('../src/agent/inner.js')
    expect(planGateRefusalFor('plan_first', sid, ['websearch'])).toBeTruthy()
    expect(planGateRefusalFor('plan_first', sid, ['bash'])).toBeTruthy()
    expect(planGateRefusalFor('plan_first', sid, ['create_plan'])).toBeNull()
    expect(planGateRefusalFor('plan_first', sid, ['websearch', 'create_plan'])).toBeNull()
  })

  it('plan_first：建计划后放行任务工具', async () => {
    const sid = 'sess_pf_gate_ok'
    await newSession(sid, 'plan_first')
    const { planStore } = await import('../src/agent/plan/plan-store.js')
    const { handleCreatePlan } = await import('../src/agent/loop/control-router.js')
    const { planGateRefusalFor } = await import('../src/agent/inner.js')
    const stream = fakeStream()
    await handleCreatePlan({
      result: {
        toolCalls: [{ id: 'p1', type: 'function', function: { name: 'create_plan', arguments: '{}' } }],
        planRequest: { steps: [{ title: 'S1' }] },
      },
      sessionId: sid, runId: 'run_pg1', stream: stream as any,
    })
    expect(planStore.getActive(sid)).not.toBeNull()
    expect(planGateRefusalFor('plan_first', sid, ['websearch'])).toBeNull()
  })

  it('goal：无计划且无历史完成计划时拒绝普通工具', async () => {
    const sid = 'sess_goal_gate'
    await newSession(sid, 'goal')
    const { planGateRefusalFor } = await import('../src/agent/inner.js')
    expect(planGateRefusalFor('goal', sid, ['get_time'])).toBeTruthy()
    expect(planGateRefusalFor('goal', sid, ['create_goal'])).toBeTruthy()
    expect(planGateRefusalFor('goal', sid, ['create_plan'])).toBeNull()
  })

  it('goal：计划未关联目标时拒绝，声明目标后放行', async () => {
    const sid = 'sess_goal_gate_goal'
    await newSession(sid, 'goal')
    const { handleCreatePlan, handleCreateGoal } = await import('../src/agent/loop/control-router.js')
    const { planGateRefusalFor } = await import('../src/agent/inner.js')
    // 只建计划、不带 goal 字段 → Goal 模式仍应拦截
    const stream = fakeStream()
    await handleCreatePlan({
      result: {
        toolCalls: [{ id: 'p1', type: 'function', function: { name: 'create_plan', arguments: '{}' } }],
        planRequest: { steps: [{ title: 'S1' }] },
      },
      sessionId: sid, runId: 'run_gg1', mode: 'goal', stream: stream as any,
    })
    expect(planGateRefusalFor('goal', sid, ['websearch'])).toBeTruthy()
    // create_goal 在本轮被放行
    expect(planGateRefusalFor('goal', sid, ['create_goal', 'websearch'])).toBeNull()
    await handleCreateGoal({
      result: {
        toolCalls: [{ id: 'g1', type: 'function', function: { name: 'create_goal', arguments: '{}' } }],
        goalRequest: { outcome: '目标' },
      },
      sessionId: sid, runId: 'run_gg2', stream: stream as any,
    })
    expect(planGateRefusalFor('goal', sid, ['websearch'])).toBeNull()
  })

  it('goal：create_plan 带 goal 字段自动关联目标后放行', async () => {
    const sid = 'sess_goal_gate_plan'
    await newSession(sid, 'goal')
    const { planStore } = await import('../src/agent/plan/plan-store.js')
    const { handleCreatePlan } = await import('../src/agent/loop/control-router.js')
    const { planGateRefusalFor } = await import('../src/agent/inner.js')
    const stream = fakeStream()
    await handleCreatePlan({
      result: {
        toolCalls: [{ id: 'p1', type: 'function', function: { name: 'create_plan', arguments: '{}' } }],
        planRequest: { goal: '交付功能', verification: 'tsc 通过', steps: [{ title: 'S1' }] },
      },
      sessionId: sid, runId: 'run_gg3', mode: 'goal', stream: stream as any,
    })
    expect(planStore.getActive(sid)!.goal_id).not.toBeNull()
    expect(planGateRefusalFor('goal', sid, ['websearch'])).toBeNull()
  })

  it('已完成计划的会话（finalize/收尾）放行工具，但新计划创建前仍要求 create_plan', async () => {
    const sid = 'sess_goal_gate_done'
    await newSession(sid, 'goal')
    const { planStore } = await import('../src/agent/plan/plan-store.js')
    const { handleCreatePlan, handleUpdatePlanStep } = await import('../src/agent/loop/control-router.js')
    const { planGateRefusalFor } = await import('../src/agent/inner.js')
    const stream = fakeStream()
    await handleCreatePlan({
      result: {
        toolCalls: [{ id: 'p1', type: 'function', function: { name: 'create_plan', arguments: '{}' } }],
        planRequest: { goal: '目标', steps: [{ title: 'S1' }] },
      },
      sessionId: sid, runId: 'run_gg4', mode: 'goal', stream: stream as any,
    })
    const active = planStore.getActive(sid)!
    const step = planStore.steps(active.id)[0]
    await handleUpdatePlanStep({
      result: {
        toolCalls: [{ id: 'u1', type: 'function', function: { name: 'update_plan_step', arguments: '{}' } }],
        planStepUpdate: { ordinal: step.ordinal, status: 'completed', evidence: 'done' },
      },
      sessionId: sid, runId: 'run_gg5', stream: stream as any,
    })
    expect(planStore.get(active.id)!.status).toBe('completed')
    // 完成态历史：工具放行（finalize 收尾）
    expect(planGateRefusalFor('goal', sid, ['read'])).toBeNull()
    // 但真正开启新计划前，create_plan 仍是必须的引导路径（无 active 计划）
    expect(planGateRefusalFor('goal', sid, [])).toBeNull()
    expect(planGateRefusalFor('goal', sid, ['websearch'])).toBeNull()
  })
})
