import { describe, expect, it } from 'vitest'
import { formatRelativeTime } from '../../pages/HomePage'

const NOW = new Date('2026-08-13T12:00:00').getTime()

describe('formatRelativeTime', () => {
  it('1 分钟内 → 刚刚', () => {
    expect(formatRelativeTime(NOW - 30_000, NOW)).toBe('刚刚')
  })

  it('几分钟前', () => {
    expect(formatRelativeTime(NOW - 10 * 60_000, NOW)).toBe('10 分钟前')
  })

  it('几小时前（同一天内）', () => {
    expect(formatRelativeTime(NOW - 3 * 3_600_000, NOW)).toBe('3 小时前')
  })

  it('昨天（日历日）', () => {
    expect(formatRelativeTime(NOW - 24 * 3_600_000 - 5 * 60_000, NOW)).toBe('昨天')
  })

  it('更早返回本地日期', () => {
    expect(formatRelativeTime(NOW - 3 * 86_400_000, NOW)).toBe('2026/08/10')
  })

  it('非法时间戳返回空串', () => {
    expect(formatRelativeTime(Number.NaN, NOW)).toBe('')
  })
})
