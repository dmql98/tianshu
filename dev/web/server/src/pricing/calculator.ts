/**
 * pricing/calculator.ts — 价格匹配与费用计算核心。
 *
 * 数据源：pricingStore（各 provider 目录下的 pricing.json，<dataDir>/providers/<id>/pricing.json）。
 * 每份 pricing.json 可带：
 * - provider 级 default_pricing（该服务商所有模型的默认价目表）
 * - model 级 pricing（单模型覆盖）
 *
 * 单位约定：所有价格字段为「分/1M tokens」整数（避免浮点误差）：
 *   $2.50/1M  → 250；¥1.00/1M → 100
 *
 * 匹配优先级（对每次 LLM 调用）：
 *   1. 本服务商 model 级 pricing
 *   2. 本服务商 provider 级 default_pricing
 *   3. 其他服务商 model 级 pricing（按模型 id 跨服务商查找，先到先得）
 *   4. 都没有 → 免费（费用=0；无参考价则节省=0）
 *
 * 时段价格：取调用 created_at 的「业务小时」(0-23)，在 hourly_prices 中查找
 * 对应 hour 的 { input, output, cache_hit, cache_miss }。
 * 业务小时固定按北京时间（Asia/Shanghai，UTC+8，无夏令时）判定，不依赖部署机时区
 * （GitHub Actions 等 CI 运行在 UTC，直接用本地小时会把高峰时段算错）。
 * 可通过环境变量 TIANSHU_BIZ_TZ_OFFSET_HOURS（相对 UTC 的小时数）覆盖，默认 8。
 * hourly_prices 缺该小时条目时，用该小时之前最近的一条（hour 环回 0）。
 */
import type { HourlyPrice, ModelPricing, ProviderPricing } from './types.js'
import { pricingStore, type ProviderPricingRules } from './pricingStore.js'
import { getExchangeRate, type Currency } from './exchangeRate.js'

// ── 常量 ──
export const PER_1M = 1_000_000

// ── 多币种金额（按结算币种分桶，均为「分」，不混加） ──

/** 按币种分桶的金额（分）。单次调用只落一个桶；聚合后可能两桶都有值。 */
export interface MoneyCents {
  usd: number
  cny: number
}

export function moneyCents(usd = 0, cny = 0): MoneyCents {
  return { usd, cny }
}

/** 把单币种金额写进桶（调用方保证只写一种）。 */
export function addToBucket(bucket: MoneyCents, cents: number, currency: Currency): void {
  if (!(cents > 0)) return
  if (currency === 'CNY') bucket.cny += cents
  else bucket.usd += cents
}

// ── 类型 ──

export interface UsageCounts {
  input: number
  output: number
  cacheHit: number
  cacheMiss: number
}

/** 一次 LLM 调用的费用结算结果。 */
export interface CostResult {
  /** 实际费用（分）。免费=0。 */
  cost: number
  /** 节省金额（分）。仅免费模型 >0。 */
  savings: number
  /** 是否命中免费规则（is_free=true 或未匹配任何价格规则）。 */
  isFree: boolean
  /** 实际费用 / 节省用的币种。 */
  currency: Currency
  /** 分项实际费用（分，同 currency）：输入未命中 / 缓存命中 / 输出（cost = 三者之和）。 */
  costMiss?: number
  costHit?: number
  costOut?: number
  /** 分项参考费用（分，同 currency）：免费模型的等效应付。 */
  refMiss?: number
  refHit?: number
  refOut?: number
  /** 匹配到的 model 级 pricing（可能 undefined）。 */
  matchedModelPricing?: ModelPricing
  /** 匹配到的 provider 级 pricing（可能 undefined）。 */
  matchedProviderPricing?: ProviderPricing
}

export interface ResolvedPrice {
  currency: Currency
  hourly: HourlyPrice[]
  isFree: boolean
  /** 命中的服务商 id（跨服务商匹配时为实际提供价目表的服务商；兜底为 undefined）。 */
  providerId: string | null | undefined
  /** 命中的 model id（provider 级默认定价时为原始 modelId；兜底为 undefined）。 */
  modelId: string | null | undefined
}

// ── 缓存 ──

/** 缓存 provider 索引（providerId → 解析后的 pricing 规则）。 */
let rulesCache: { providers: Map<string, ProviderRules>; builtAt: number } | null = null
const CACHE_TTL_MS = 5000

interface ProviderRules extends ProviderPricingRules {}

// ── 加载与缓存 ──

/** 从 pricingStore 读取所有 provider 价目表，构建内存索引。 */
function buildRules(): Map<string, ProviderRules> {
  const providers = pricingStore.loadAll()
  const map = new Map<string, ProviderRules>()
  for (const p of providers) {
    map.set(p.providerId, p as ProviderRules)
  }
  return map
}

/** 获取（可能缓存）的价格规则索引。 */
function getRules(): Map<string, ProviderRules> {
  const now = Date.now()
  if (!rulesCache || now - rulesCache.builtAt > CACHE_TTL_MS) {
    rulesCache = { providers: buildRules(), builtAt: now }
  }
  return rulesCache.providers
}

/** 测试/热更新用：清空规则缓存。 */
export function invalidatePricingCache(): void {
  rulesCache = null
}

// ── 匹配 ──

/**
 * 解析某个 provider+model 的价格规则（不含时间）。
 * 优先级（需求确认）：
 *   1. 本服务商 model 级 pricing
 *   2. 本服务商 provider 级 default_pricing
 *   3. 其他服务商 model 级 pricing（按模型 id 跨服务商查找，先到先得）
 *   4. 免费兜底（费用=0）
 */
export function resolvePrice(
  providerId: string | null | undefined,
  modelId: string | null | undefined,
): ResolvedPrice {
  const rules = getRules()
  const provider = providerId ? rules.get(providerId) : undefined

  // 1. 本服务商 model 级 pricing
  if (provider && modelId) {
    const model = provider.modelPricing.get(modelId)
    if (model) {
      return {
        currency: model.currency || provider.defaultPricing?.currency || 'USD',
        hourly: model.hourly_prices || [],
        isFree: model.is_free === true,
        providerId,
        modelId,
      }
    }
  }

  // 2. 本服务商 provider 级 default_pricing
  if (provider?.defaultPricing) {
    const dp = provider.defaultPricing
    return {
      currency: dp.currency || 'USD',
      hourly: dp.hourly_prices || [],
      isFree: dp.is_free === true,
      providerId,
      modelId,
    }
  }

  // 3. 其他服务商 model 级 pricing（本服务商无规则时跨服务商取）
  //    按 provider 出现顺序先到先得；取第一个带 hourly_prices 或 is_free 标记的。
  if (modelId) {
    for (const [pid, p] of rules) {
      if (pid === providerId) continue
      const model = p.modelPricing.get(modelId)
      if (model) {
        return {
          currency: model.currency || p.defaultPricing?.currency || 'USD',
          hourly: model.hourly_prices || [],
          isFree: model.is_free === true,
          providerId: pid,
          modelId,
        }
      }
    }
  }

  // 4. 兜底：免费
  return { currency: 'USD', hourly: [], isFree: true, providerId: undefined, modelId: undefined }
}

/**
 * 取某小时的价格。hourly_prices 缺该小时条目时回退到最近一条（hour 环回 0）。
 * 返回 null 表示没有任何价格（该小时无价目 → 调用方按 0 计费）。
 */
export function priceForHour(hourly: HourlyPrice[], hour: number): HourlyPrice | null {
  if (!hourly || hourly.length === 0) return null
  const exact = hourly.find(h => h.hour === hour)
  if (exact) return exact
  // 按 hour 降序，取 ≤ hour 的最近一条；没有则取全局最大 hour（环回）
  const sorted = [...hourly].sort((a, b) => b.hour - a.hour)
  const below = sorted.find(h => h.hour <= hour)
  return below || sorted[0] || null
}

// ── 时段小时（业务时区） ──

/** 业务时区相对 UTC 的固定偏移（小时）。默认北京时间 UTC+8（无夏令时）。 */
export function bizTzOffsetHours(): number {
  const raw = process.env.TIANSHU_BIZ_TZ_OFFSET_HOURS
  if (raw !== undefined && raw !== '') {
    const n = Number(raw)
    if (Number.isFinite(n) && Math.abs(n) <= 14) return n
  }
  return 8
}

/**
 * 把 UTC epoch ms 折算成业务时区的小时 (0-23)。
 * 用「+ 固定偏移后取 UTC 小时」实现，等价于目标时区本地小时且与部署机时区无关。
 */
export function bizHourOf(createdAt: number): number {
  const d = new Date(createdAt + bizTzOffsetHours() * 3600_000)
  return d.getUTCHours()
}

// ── 计算 ──

/**
 * 计算单次 LLM 调用的费用与节省。
 *
 * @param providerId 会话关联的服务商 id（可能缺失）
 * @param modelId    模型 id（request_model）
 * @param usage      token 用量（input/output/cacheHit/cacheMiss）
 * @param createdAt  调用时间（epoch ms），用于取小时时段价格
 */
export function calculateCost(
  providerId: string | null | undefined,
  modelId: string | null | undefined,
  usage: UsageCounts,
  createdAt: number,
): CostResult {
  const resolved = resolvePrice(providerId, modelId)
  const hour = createdAt ? bizHourOf(createdAt) : 0
  const price = priceForHour(resolved.hourly, hour)

  // 计价函数：无价格条目 → 0
  const costFor = (tokens: number, perM: number | undefined): number =>
    tokens > 0 && typeof perM === 'number' && perM > 0
      ? (tokens * perM) / PER_1M
      : 0

  if (resolved.isFree) {
    // 免费：实际费用 0，节省按 ref_hourly_prices（model 级）或 provider 级兜底估算。
    // usage.input 已含缓存命中部分 —— 未命中按输入全价、命中按命中价、输出按输出价拆分。
    const refs = resolveReferencePrice(resolved)
    if (refs) {
      const refPrice = priceForHour(refs.hourly, hour)
      if (refPrice) {
        const hasCache = usage.cacheHit > 0 || usage.cacheMiss > 0
        const refMiss = hasCache ? costFor(usage.cacheMiss, refPrice.input) : costFor(usage.input, refPrice.input)
        const refHit = hasCache ? costFor(usage.cacheHit, refPrice.cache_hit) : 0
        const refOut = costFor(usage.output, refPrice.output)
        return {
          cost: 0,
          savings: refMiss + refHit + refOut,
          isFree: true,
          currency: resolved.currency,
          costMiss: 0, costHit: 0, costOut: 0,
          refMiss, refHit, refOut,
        }
      }
    }
    return {
      cost: 0,
      savings: 0,
      isFree: true,
      currency: resolved.currency,
      costMiss: 0, costHit: 0, costOut: 0,
      refMiss: 0, refHit: 0, refOut: 0,
    }
  }

  // 付费：usage.input 已含缓存命中部分 —— cacheMiss 按输入全价、cacheHit 按命中价、
  // output 按输出价分别计价；provider 没给缓存拆分（hit=miss=0）时 input 整体按全价。
  const hasCache = usage.cacheHit > 0 || usage.cacheMiss > 0
  const costMiss = hasCache ? costFor(usage.cacheMiss, price?.input) : costFor(usage.input, price?.input)
  const costHit = hasCache ? costFor(usage.cacheHit, price?.cache_hit) : 0
  const costOut = costFor(usage.output, price?.output)

  return {
    cost: costMiss + costHit + costOut,
    savings: 0,
    isFree: false,
    currency: resolved.currency,
    costMiss, costHit, costOut,
    refMiss: 0, refHit: 0, refOut: 0,
  }
}

/** 免费模型计算节省用的参考价：model 级 ref_hourly_prices → provider 级 ref_hourly_prices → 无。
  * 用 resolvePrice 命中的服务商/模型（含跨服务商命中），避免调用方 provider 无价目表时拿不到参考价。 */
function resolveReferencePrice(
  resolved: ResolvedPrice,
): { hourly: HourlyPrice[]; currency: 'USD' | 'CNY' } | null {
  const rules = getRules()
  const provider = resolved.providerId ? rules.get(resolved.providerId) : undefined
  const model = provider && resolved.modelId ? provider.modelPricing.get(resolved.modelId) : undefined

  if (model?.ref_hourly_prices && model.ref_hourly_prices.length > 0) {
    return { hourly: model.ref_hourly_prices, currency: model.currency || resolved.currency }
  }
  if (provider?.defaultPricing?.ref_hourly_prices && provider.defaultPricing.ref_hourly_prices.length > 0) {
    return { hourly: provider.defaultPricing.ref_hourly_prices, currency: provider.defaultPricing.currency || resolved.currency }
  }
  return null
}

// ── 展示格式化 ──

/** 分 → 金额字符串（如 1250 → "$12.50"，¥ 同）。 */
export function formatCost(cents: number, currency: Currency = 'USD'): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.round(Math.abs(cents))
  const dollars = Math.floor(abs / 100)
  const rem = abs % 100
  const symbol = currency === 'CNY' ? '¥' : '$'
  return `${sign}${symbol}${dollars}.${String(rem).padStart(2, '0')}`
}

// ── 供 statistics 路由复用的聚合辅助 ──

export interface CostAccumulator {
  /** 实际费用（分，按结算币种分桶）。 */
  cost: MoneyCents
  /** 节省金额（分，按结算币种分桶；仅免费模型 >0）。 */
  savings: MoneyCents
  /** 分项费用（分，按结算币种分桶）：输入未命中 / 缓存命中 / 输出。 */
  miss: MoneyCents
  hit: MoneyCents
  out: MoneyCents
  freeCalls: number
  paidCalls: number
}

export function createCostAccumulator(): CostAccumulator {
  return {
    cost: moneyCents(), savings: moneyCents(),
    miss: moneyCents(), hit: moneyCents(), out: moneyCents(),
    freeCalls: 0, paidCalls: 0,
  }
}

export function accumulateCost(
  acc: CostAccumulator,
  result: CostResult,
): void {
  addToBucket(acc.cost, result.cost, result.currency)
  addToBucket(acc.savings, result.savings, result.currency)
  addToBucket(acc.miss, result.costMiss ?? 0, result.currency)
  addToBucket(acc.hit, result.costHit ?? 0, result.currency)
  addToBucket(acc.out, result.costOut ?? 0, result.currency)
  if (result.isFree) acc.freeCalls += 1
  else acc.paidCalls += 1
}

/** 从单次结算结果构造分币种金额（用于 detail/by-model 行级 JSON）。 */
export function resultMoney(result: CostResult): MoneyCents {
  return moneyCents(result.currency === 'CNY' ? 0 : result.cost, result.currency === 'CNY' ? result.cost : 0)
}

/**
 * 选主展示币种：
 * 1. 调用方显式指定（display_currency）→ 用它
 * 2. 只有一种币种金额 → 那一种
 * 3. 两种都有 → 按金额主导（换算后比较大者）
 */
export function primaryCurrency(usd: number, cny: number, hint?: Currency): Currency {
  if (hint === 'USD' || hint === 'CNY') return hint
  if (cny > 0 && !(usd > 0)) return 'CNY'
  if (usd > 0 && !(cny > 0)) return 'USD'
  // 两种都有：换算参考，哪个合计大用哪个
  const usdOfCny = cny / DEFAULT_RATE_FOR_PICK
  return usd >= usdOfCny ? 'USD' : 'CNY'
}
/** 选主币种用的参考汇率（仅用于决定主币种，不参与金额换算展示）。 */
const DEFAULT_RATE_FOR_PICK = 7.2

/**
 * 把分币种桶换算成某个币种的合计（展示用；真实账目仍在 MoneyCents 原币种）。
 * 先对每桶取整分（与输出字段 total_cost_usd/cny 一致），保证
 * total_cost === round(total_cost_usd × rate + total_cost_cny) 可自洽重算。
 * @param to 目标币种；缺省自动选主币种
 */
export function moneyInCurrency(bucket: MoneyCents, to?: Currency): { currency: Currency; total: number } {
  const usd = Math.round(bucket.usd)
  const cny = Math.round(bucket.cny)
  const cur = to ?? primaryCurrency(usd, cny)
  const rate = getExchangeRate().usdToCny
  const total = cur === 'CNY'
    ? Math.round(usd * rate + cny)
    : usd + Math.round(cny / rate)
  return { currency: cur, total }
}

/** ProviderPricingRules 的便捷访问（兼容字段命名）。 */
export function providerPricingOf(p: ProviderPricingRules): ProviderPricing | undefined {
  return p.defaultPricing
}
