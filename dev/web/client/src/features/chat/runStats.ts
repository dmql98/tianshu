import type { SessionStats } from '@/types'

/** Compact duration: 45.2s under a minute, 2m42s from there on. */
export function formatDuration(ms: number): string {
  const s = ms / 1000
  if (s < 60) return `${Math.round(s * 10) / 10}s`
  const whole = Math.round(s)
  return `${Math.floor(whole / 60)}m${whole % 60}s`
}

/** Compact token count: 517 / 12.2K / 517K / 1.2M. */
export function formatTokens(n: number): string {
  const scaled = (v: number): string =>
    v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10)
  if (n < 1_000) return String(n)
  if (n < 1_000_000) return `${scaled(n / 1_000)}K`
  return `${scaled(n / 1_000_000)}M`
}

/** One stat card in the sidebar "会话统计" grid. `key` is the i18n dict key. */
export interface StatsCard {
  key: string
  value: string
}

/**
 * Build the sidebar "会话统计" cards in display order (2-column grid):
 * ```
 * 总消息数 · 缓存命中
 * 模型调用数 · 模型调用时间
 * 工具调用 · 工具调用时间
 * 首 token 平均 · 输出平均
 * 输入数 · 输出数
 * ```
 */
export function buildStatsCards(stats: SessionStats): StatsCard[] {
  const cards: StatsCard[] = [
    // Defensive: a stale server endpoint may omit messageCount (added later);
    // never render "undefined".
    { key: '总消息数', value: stats.messageCount != null ? String(stats.messageCount) : '--' },
    { key: '缓存命中', value: stats.cacheHitPercent !== null ? `${stats.cacheHitPercent}%` : '--' },
    { key: '模型调用数', value: String(stats.turns) },
    { key: '模型调用时间', value: stats.llmMs > 0 ? formatDuration(stats.llmMs) : '--' },
    { key: '工具调用', value: String(stats.steps) },
    { key: '工具调用时间', value: stats.toolMs > 0 ? formatDuration(stats.toolMs) : '--' },
    { key: '首 token 平均', value: stats.ttftAvgMs !== null && stats.ttftAvgMs > 0 ? formatDuration(stats.ttftAvgMs) : '--' },
    {
      key: '输出平均',
      value: stats.decodeMs > 0 && stats.outputTokens > 0
        ? `${(stats.outputTokens / (stats.decodeMs / 1000)).toFixed(1)} tok/s`
        : '--',
    },
    { key: '输入数', value: formatTokens(stats.inputTokens) },
    { key: '输出数', value: formatTokens(stats.outputTokens) },
  ]
  return cards
}
