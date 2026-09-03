/**
 * pricing/types.ts — 价目表类型定义（独立于 providerStore）。
 *
 * 数据落盘：<dataDir>/providers/<id>/pricing.json（与 provider.json / icon.svg 平级），
 * 以及只读内置层 content/builtin/providers/<id>/pricing.json。
 *
 * 单位约定：所有价格字段为「分/1M tokens」整数（避免浮点误差）：
 *   $2.50/1M  → 250；¥1.00/1M → 100
 */

/** 单小时价格（分/1M tokens）。 */
export interface HourlyPrice {
  hour: number        // 0-23
  input: number       // 分/1M tokens
  output: number      // 分/1M tokens
  cache_hit: number   // 分/1M tokens
  cache_miss: number  // 分/1M tokens
}

/** 模型级计费配置。 */
export interface ModelPricing {
  is_free?: boolean
  currency?: 'USD' | 'CNY'
  hourly_prices?: HourlyPrice[]
  /** 免费模型的等效参考价（用于计算"节省了多少"）。 */
  ref_hourly_prices?: HourlyPrice[]
}

/** 服务商级默认计费配置（model 级未配置时回退）。 */
export interface ProviderPricing {
  is_free?: boolean
  currency?: 'USD' | 'CNY'
  hourly_prices?: HourlyPrice[]
  /** 免费模型的等效参考价（用于计算"节省了多少"）。 */
  ref_hourly_prices?: HourlyPrice[]
}

/** pricing.json 文件顶层结构。 */
export interface ProviderPricingFile {
  schemaVersion?: number
  /** 默认币种（未配置时 model 级回退）。 */
  currency?: 'USD' | 'CNY'
  /** provider 级默认价目表（model 级缺省时回退）。 */
  default_pricing?: ProviderPricing
  /** modelId → 模型级价目表。 */
  models?: Record<string, ModelPricing>
}
