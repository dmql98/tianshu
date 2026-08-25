import { describe, expect, it } from 'vitest'
import { registerPendingSub, completePendingSub, clearPendingSubs, pendingSubCount } from '../src/agent/sub-task-registry.js'

describe('P5 sub-task batch aggregation (全部完成才唤醒)', () => {
  it('同一父 run 多个子任务：最后一个完成才返回 true', () => {
    const runId = 'run_1'
    registerPendingSub(runId, 'sub_a')
    registerPendingSub(runId, 'sub_b')
    registerPendingSub(runId, 'sub_c')
    expect(pendingSubCount(runId)).toBe(3)

    expect(completePendingSub(runId, 'sub_a')).toBe(false)
    expect(completePendingSub(runId, 'sub_b')).toBe(false)
    expect(pendingSubCount(runId)).toBe(1)
    // 最后一个完成 → 批次结束
    expect(completePendingSub(runId, 'sub_c')).toBe(true)
    expect(pendingSubCount(runId)).toBe(0)
  })

  it('不同父 run 的批次互不影响', () => {
    registerPendingSub('run_a', 'sub_1')
    registerPendingSub('run_b', 'sub_2')
    expect(completePendingSub('run_a', 'sub_1')).toBe(true)
    // run_b 未完成，仍 pending
    expect(pendingSubCount('run_b')).toBe(1)
    clearPendingSubs('run_b')
    expect(pendingSubCount('run_b')).toBe(0)
  })

  it('未知 id / 已清空批次返回 false（不误触发）', () => {
    expect(completePendingSub('run_none', 'sub_x')).toBe(false)
    clearPendingSubs('run_none')
    expect(pendingSubCount('run_none')).toBe(0)
  })

  it('clearPendingSubs 清空整个批次（派发失败兜底，防止永不唤醒）', () => {
    registerPendingSub('run_fail', 'sub_a')
    registerPendingSub('run_fail', 'sub_b')
    clearPendingSubs('run_fail')
    expect(pendingSubCount('run_fail')).toBe(0)
    expect(completePendingSub('run_fail', 'sub_a')).toBe(false)
  })
})
