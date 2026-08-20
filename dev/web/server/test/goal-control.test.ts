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

  it('goal 模式缺 evidence 时拒绝提交（completion-evaluator 原有语义）', async () => {
    const { evaluateSubmission } = await import('../src/agent/loop/completion-evaluator.js')
    const check = evaluateSubmission({
      mode: 'goal',
      planCompleted: true,
      unmetSteps: [],
      goalVerification: '验证标准',
      summary: '已完成',
      evidence: [],
    })
    expect(check.accepted).toBe(false)
    expect(check.unmet.some(u => u.includes('证据'))).toBe(true)
  })
})
