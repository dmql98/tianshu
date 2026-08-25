import { describe, expect, it } from 'vitest'
import { clampInstances, buildSubSessionId, MAX_INSTANCES } from '../src/agent/sub-agent.js'

describe('P5 fan-out helpers', () => {
  it('clampInstances 归一化 1-5，非法回退 1', () => {
    expect(clampInstances(undefined)).toBe(1)
    expect(clampInstances(0)).toBe(1)
    expect(clampInstances(-3)).toBe(1)
    expect(clampInstances(1)).toBe(1)
    expect(clampInstances(3)).toBe(3)
    expect(clampInstances(MAX_INSTANCES)).toBe(MAX_INSTANCES)
    expect(clampInstances(99)).toBe(MAX_INSTANCES)
    expect(clampInstances('2' as unknown)).toBe(2)
    expect(clampInstances('abc' as unknown)).toBe(1)
    expect(clampInstances(2.9)).toBe(2)
    expect(clampInstances(NaN)).toBe(1)
    expect(clampInstances(Infinity)).toBe(1)
  })

  it('buildSubSessionId 带实例序号，同毫秒多实例 ID 唯一', () => {
    const ts = Date.now()
    const base = buildSubSessionId('parent_1', 'worker', ts)
    expect(base).toBe(`sub_parent_1_worker_${ts}`)
    const ids = Array.from({ length: MAX_INSTANCES }, (_, i) => buildSubSessionId('parent_1', 'worker', ts, i))
    expect(new Set(ids).size).toBe(MAX_INSTANCES)
    expect(ids[0]).toBe(`sub_parent_1_worker_${ts}_0`)
    expect(ids[MAX_INSTANCES - 1]).toBe(`sub_parent_1_worker_${ts}_${MAX_INSTANCES - 1}`)
    // 无序号（单实例）与有序号（多实例 0 号）不同名，避免碰撞
    expect(base).not.toBe(ids[0])
  })
})
