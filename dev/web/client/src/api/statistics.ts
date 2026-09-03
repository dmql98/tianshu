/**
 * api/statistics.ts — 用量统计 API 封装。
 * 后端：/api/statistics（routes/statistics.ts）。
 *
 * 币种语义（与后端一致）：
 * - total_cost_usd / total_cost_cny：真实账目，按价目表声明币种分桶累加，不混算。
 * - total_cost / total_cost_display / currency：按主币种（或 display_currency）换算的展示合计。
 */
import { apiGet } from './client'

export type Currency = 'USD' | 'CNY'

/** 金额展示视图（真实分桶 + 换算展示）。 */
export interface MoneyView {
  /** 真实 USD 账目（分）。 */
  total_cost_usd: number
  /** 真实 CNY 账目（分）。 */
  total_cost_cny: number
  /** 展示合计（分，按 currency 换算后四舍五入）。 */
  total_cost: number
  total_cost_display: string
  total_savings_usd: number
  total_savings_cny: number
  total_savings: number
  total_savings_display: string
  /** 展示主币种（cost 换算用）。 */
  currency: Currency
}

/** GET /api/statistics/overview */
export interface StatisticsOverview extends MoneyView {
  total_input_tokens: number
  total_output_tokens: number
  total_cache_hit_tokens: number
  total_cache_miss_tokens: number
  total_tokens: number
  cache_hit_rate: number | null
  exchange_rate_usd_cny: number
  total_calls: number
  free_calls: number
  paid_calls: number
}

/** by-model / by-character / by-provider / by-day 单行（聚合行：含真实分桶 + 展示合计）。 */
export interface StatRow extends MoneyView {
  /** by-model / by-provider 的服务商；by-character 的角色；by-day 为空。 */
  provider_id?: string | null
  model?: string | null
  character_id?: string | null
  date?: string
  total_input_tokens?: number
  total_output_tokens?: number
  total_cache_hit_tokens?: number
  total_cache_miss_tokens?: number
  total_tokens?: number
  call_count?: number
  is_free?: boolean
  /** 分项费用（分，行币种）：输入未命中 / 缓存命中 / 输出。 */
  cost_miss?: number
  cost_hit?: number
  cost_out?: number
  /** 分项参考价（分，行币种；免费模型绿色划线展示用）。 */
  ref_miss?: number
  ref_hit?: number
  ref_out?: number
  /** 聚合桶分项（分，分币种）。 */
  total_cost_miss_usd?: number
  total_cost_miss_cny?: number
  total_cost_hit_usd?: number
  total_cost_hit_cny?: number
  total_cost_out_usd?: number
  total_cost_out_cny?: number
}

export interface StatListResponse {
  items: StatRow[]
}

/** detail 单行（单次调用，原币种展示 + 分币种字段）。 */
export interface DetailRow {
  id: number
  session_id: string
  session_title: string | null
  character_id: string | null
  provider_id: string | null
  model: string | null
  usage_input: number
  usage_output: number
  usage_cache_hit: number
  usage_cache_miss: number
  cost: number
  cost_display: string
  cost_usd: number
  cost_cny: number
  savings: number
  savings_usd: number
  savings_cny: number
  currency: Currency
  is_free: boolean
  cost_miss: number
  cost_hit: number
  cost_out: number
  ref_miss: number
  ref_hit: number
  ref_out: number
  created_at: number
}

export interface DetailResponse {
  total: number
  items: DetailRow[]
}

export interface StatisticsFilters {
  /** 起止（epoch ms）。 */
  from?: number
  to?: number
  model?: string
  character_id?: string
  provider_id?: string
  /** 展示换算主币种（可选；缺省后端自动选）。 */
  display_currency?: Currency
}

function qs(f: StatisticsFilters): string {
  const q = new URLSearchParams()
  if (f.from !== undefined) q.set('from', String(f.from))
  if (f.to !== undefined) q.set('to', String(f.to))
  if (f.model) q.set('model', f.model)
  if (f.character_id) q.set('character_id', f.character_id)
  if (f.provider_id) q.set('provider_id', f.provider_id)
  if (f.display_currency) q.set('display_currency', f.display_currency)
  const s = q.toString()
  return s ? `?${s}` : ''
}

export const fetchOverview = (f: StatisticsFilters = {}) =>
  apiGet<StatisticsOverview>(`/api/statistics/overview${qs(f)}`)

export const fetchByModel = (f: StatisticsFilters = {}) =>
  apiGet<StatListResponse>(`/api/statistics/by-model${qs(f)}`)

export const fetchByCharacter = (f: StatisticsFilters = {}) =>
  apiGet<StatListResponse>(`/api/statistics/by-character${qs(f)}`)

export const fetchByProvider = (f: StatisticsFilters = {}) =>
  apiGet<StatListResponse>(`/api/statistics/by-provider${qs(f)}`)

export const fetchByDay = (f: StatisticsFilters = {}) =>
  apiGet<StatListResponse>(`/api/statistics/by-day${qs(f)}`)

export const fetchDetail = (f: StatisticsFilters = {}, limit = 20, offset = 0) =>
  apiGet<DetailResponse>(`/api/statistics/detail${qs(f)}&limit=${limit}&offset=${offset}`)

/** GET /api/statistics/filters — 下拉维度。 */
export interface StatisticsFilterOptions {
  models: string[]
  characters: string[]
  providers: string[]
}

export const fetchStatisticsFilters = () =>
  apiGet<StatisticsFilterOptions>('/api/statistics/filters')
