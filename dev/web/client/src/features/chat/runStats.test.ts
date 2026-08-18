import { describe, expect, it } from 'vitest'
import { buildStatsCards, formatDuration, formatTokens } from './runStats'

describe('formatDuration', () => {
  it('shows tenths of a second below a minute', () => {
    expect(formatDuration(1_600)).toBe('1.6s')
    expect(formatDuration(45_200)).toBe('45.2s')
  })

  it('shows mSs above a minute', () => {
    expect(formatDuration(21 * 60_000 + 13_000)).toBe('21m13s')
    expect(formatDuration(3 * 60_000 + 5_000)).toBe('3m5s')
  })
})

describe('formatTokens', () => {
  it('compacts token counts', () => {
    expect(formatTokens(517)).toBe('517')
    expect(formatTokens(12_200)).toBe('12.2K')
    expect(formatTokens(517_000)).toBe('517K')
    expect(formatTokens(1_200_000)).toBe('1.2M')
  })
})

describe('buildStatsCards', () => {
  const stats = {
    messageCount: 500,
    turns: 4,
    steps: 220,
    llmMs: 21 * 60_000 + 13_000,
    toolMs: 3 * 60_000 + 5_000,
    decodeMs: 100_000,
    ttftAvgMs: 1_600,
    cacheHitPercent: 100,
    inputTokens: 40_100_000,
    outputTokens: 13_900,
  }

  it('renders the 10 cards in the requested order', () => {
    expect(buildStatsCards(stats).map(c => c.key)).toEqual([
      '总消息数',
      '缓存命中',
      '模型调用数',
      '模型调用时间',
      '工具调用',
      '工具调用时间',
      '首 token 平均',
      '输出平均',
      '输入数',
      '输出数',
    ])
  })

  it('formats card values', () => {
    expect(buildStatsCards(stats).map(c => c.value)).toEqual([
      '500',
      '100%',
      '4',
      '21m13s',
      '220',
      '3m5s',
      '1.6s',
      '139.0 tok/s',
      '40.1M',
      '13.9K',
    ])
  })

  it('shows placeholders for missing timings', () => {
    const cards = buildStatsCards({
      messageCount: 0,
      turns: 0,
      steps: 0,
      llmMs: 0,
      toolMs: 0,
      decodeMs: 0,
      ttftAvgMs: null,
      cacheHitPercent: null,
      inputTokens: 0,
      outputTokens: 0,
    })
    expect(cards.map(c => c.value)).toEqual([
      '0', '--', '0', '--', '0', '--', '--', '--', '0', '0',
    ])
  })

  it('never renders undefined for a stale server response missing messageCount', () => {
    const stale = {
      turns: 4,
      steps: 220,
      llmMs: 0,
      toolMs: 0,
      decodeMs: 0,
      ttftAvgMs: null,
      cacheHitPercent: 100,
      inputTokens: 1000,
      outputTokens: 0,
    } as unknown as Parameters<typeof buildStatsCards>[0]
    const cards = buildStatsCards(stale)
    expect(cards[0].value).toBe('--')
    expect(cards.map(c => c.value)).not.toContain('undefined')
  })
})
