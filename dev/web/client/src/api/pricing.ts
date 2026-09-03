/**
 * api/pricing.ts — 价格与汇率配置 API 封装。
 * 后端：/api/pricing（routes/pricing.ts）。
 */
import { apiGet, apiPut } from './client'
import type { Currency } from './statistics'

export interface HourlyPrice {
  hour: number
  input: number
  output: number
  cache_hit: number
  cache_miss: number
}

export interface Pricing {
  is_free?: boolean
  currency?: Currency
  hourly_prices?: HourlyPrice[]
  ref_hourly_prices?: HourlyPrice[]
}

export interface ProviderPricingView {
  provider_id: string
  default_pricing: {
    is_free?: boolean
    currency?: Currency
    hourly_prices?: HourlyPrice[]
    ref_hourly_prices?: HourlyPrice[]
  } | null
  models: Array<{
    model_id: string
    is_free: boolean
    pricing: Pricing | null
  }>
}

export const fetchPricing = () => apiGet<{ providers: ProviderPricingView[] }>('/api/pricing')

export const savePricing = (providers: Array<Pick<ProviderPricingView, 'provider_id' | 'default_pricing' | 'models'>>) =>
  apiPut<{ ok: boolean; updated: number }>('/api/pricing', { providers })

/** 汇率（USD→CNY 参考换算）。 */
export interface ExchangeRateView {
  usd_to_cny: number
  updated_at: number | null
  note: string | null
  source: 'default' | 'file'
}

export const fetchExchangeRate = () =>
  apiGet<ExchangeRateView>('/api/pricing/exchange-rate')

export const saveExchangeRate = (usdToCny: number, note?: string) =>
  apiPut<{ ok: boolean; usd_to_cny: number; updated_at: number | null; note: string | null }>(
    '/api/pricing/exchange-rate', { usd_to_cny: usdToCny, note },
  )
