import { describe, it, expect } from 'vitest'
import {
  isSessionUnread,
  markSessionSeen,
  forgetSessionSeen,
  pinnedFirst,
  orderSessionRows,
  commitOrder,
  removeSessionFromOrder,
  toggleGroupPin,
  parsePrefs,
  type SessionListPrefs,
} from './sessionListPrefs'

const base = (): SessionListPrefs => ({ seededAt: 0, seen: {}, pinnedGroups: [], order: {} })

describe('未读标记（isSessionUnread / markSessionSeen）', () => {
  it('未启用时（seededAt=0 无记录）以基线 0 判定，任何活动都未读', () => {
    expect(isSessionUnread(base(), 'a', 100)).toBe(true)
  })

  it('seededAt 之前的会话视为已读，之后的未读', () => {
    const p: SessionListPrefs = { ...base(), seededAt: 1000 }
    expect(isSessionUnread(p, 'a', 500)).toBe(false)
    expect(isSessionUnread(p, 'b', 1500)).toBe(true)
  })

  it('打开过的会话按 seen 时间判定；活动晚于 seen 视为未读', () => {
    const p: SessionListPrefs = { ...base(), seededAt: 100, seen: { a: 900, b: 2000 } }
    expect(isSessionUnread(p, 'a', 800)).toBe(false) // 最后一次查看之前结束
    expect(isSessionUnread(p, 'a', 1000)).toBe(true) // 查看之后又有新活动
    expect(isSessionUnread(p, 'b', 2500)).toBe(true) // 2000 看过之后在 2500 又有新活动 → 未读
    expect(isSessionUnread(p, 'b', 1500)).toBe(false) // 活动早于 seen 且晚于 seededAt → 已读
  })

  it('markSessionSeen 记录查看时间，且 marker 取 max(now, updatedAt) 防时钟回拨', () => {
    const p = markSessionSeen(base(), 'a', 5000, 3000)
    expect(p.seen.a).toBe(5000)
    expect(p.seededAt).toBe(3000)
    const again = markSessionSeen(p, 'a', 5000, 3000)
    expect(again).toBe(p) // 相同状态返回原引用，跳过重渲染
  })

  it('forgetSessionSeen 清理后回到基线判定', () => {
    const p: SessionListPrefs = { ...base(), seededAt: 1000, seen: { a: 2000 } }
    const next = forgetSessionSeen(p, 'a')
    expect(next.seen.a).toBeUndefined()
    expect(isSessionUnread(next, 'a', 500)).toBe(false)
  })
})

describe('手动排序（orderSessionRows / applyManualOrder / commitOrder / removeSessionFromOrder）', () => {
  const rows = [
    { id: 'old', updated_at: 100 },
    { id: 'mid', updated_at: 200 },
    { id: 'new', updated_at: 300 },
  ]
  const keyOf = (r: { id: string }) => r.id
  const recencyOf = (r: { id: string; updated_at: number }) => r.updated_at

  it('默认按 recency 降序（updated_at）', () => {
    const ordered = orderSessionRows(rows, keyOf, { pinned: new Set(), order: [], recencyOf })
    expect(ordered.map(r => r.id)).toEqual(['new', 'mid', 'old'])
  })

  it('置顶会话簇优先，簇内保持 recency', () => {
    const ordered = orderSessionRows(rows, keyOf, {
      pinned: new Set(['old']),
      order: [],
      recencyOf,
    })
    expect(ordered.map(r => r.id)).toEqual(['old', 'new', 'mid'])
  })

  it('手动顺序只对已排序的 id 生效；新会话（未入序）浮动到分区最前', () => {
    const p: SessionListPrefs = { ...base(), order: { g: ['old', 'mid'] } }
    const ordered = orderSessionRows(rows, keyOf, {
      pinned: new Set(),
      order: p.order.g,
      recencyOf,
    })
    expect(ordered.map(r => r.id)).toEqual(['new', 'old', 'mid'])
  })

  it('commitOrder 后 applyManualOrder 还原同一顺序', () => {
    const moved = ['new', 'mid', 'old']
    const next = commitOrder(base(), 'g', [...moved])
    expect(next.order.g).toEqual(moved)
    const reOrdered = orderSessionRows(rows, keyOf, {
      pinned: new Set(),
      order: next.order.g,
      recencyOf,
    })
    expect(reOrdered.map(r => r.id)).toEqual(moved)
  })

  it('removeSessionFromOrder 清理被删会话的 id，无匹配时不产生新引用', () => {
    const p: SessionListPrefs = { ...base(), order: { g: ['a', 'b', 'c'] } }
    const next = removeSessionFromOrder(p, 'b')
    expect(next.order.g).toEqual(['a', 'c'])
    expect(removeSessionFromOrder(next, 'zzz')).toBe(next)
  })

  it('pinnedFirst 保持输入顺序分组', () => {
    const items = ['a', 'b', 'c', 'd']
    expect(pinnedFirst(items, x => x, new Set(['c', 'a']))).toEqual(['a', 'c', 'b', 'd'])
  })
})

describe('组置顶（toggleGroupPin）与解析容错（parsePrefs）', () => {
  it('切换置顶组，保持顺序', () => {
    const p = toggleGroupPin(base(), 'w1')
    expect(p.pinnedGroups).toEqual(['w1'])
    const back = toggleGroupPin(p, 'w1')
    expect(back.pinnedGroups).toEqual([])
  })

  it('parsePrefs 容忍损坏数据，正常数据完整还原', () => {
    expect(parsePrefs(null)).toEqual(base())
    expect(parsePrefs('{oops')).toEqual(base())
    const raw = { seededAt: 42, seen: { a: 1, bad: 'x' }, pinnedGroups: ['w1', 7], order: { g: ['a', 9] } }
    const p = parsePrefs(JSON.stringify(raw))
    expect(p.seededAt).toBe(42)
    expect(p.seen).toEqual({ a: 1 })
    expect(p.pinnedGroups).toEqual(['w1'])
    expect(p.order).toEqual({ g: ['a'] })
  })
})