/**
 * providers/opencode-pricing.ts — OpenCode 价目表（规范数据源）。
 *
 * 来源：用户提供的 OpenCode 官方价目表（美元/1M tokens）。
 * 此表同时服务两个 provider：
 *  - opencode-go：模型按真实价格计费；免费模型标 is_free
 *  - opencode-free：所有模型 is_free=true，ref_hourly_prices = 真实价格（算节省）
 *
 * 单位约定：内部一律「分/1M tokens」整数（$2.50/1M → 250），避免浮点误差。
 * 字段说明：
 *  - cache_write：价目表的"缓存写入"列；OpenCode 网关不返回 cache_write，
 *    统计侧 cache_miss 统一按 input 价计（缓存未命中 = 全价输入）。
 *  - peak：DeepSeek 专有的 Peak/Off-Peak 时段（01-04, 06-10 UTC 为 Peak）。
 */
import type { HourlyPrice } from '../pricing/types.js'

const usd = (dollar: number) => Math.round(dollar * 100)

export interface PricingSpec {
  input: number      // $/1M
  output: number     // $/1M
  cacheHit: number   // $/1M（缓存读取）
  cacheWrite?: number // $/1M（缓存写入，仅展示，统计按 input 计 cache_miss）
  peak?: { input: number; output: number; cacheHit: number }
  isFree?: boolean   // 该模型本身免费
}

/** 24 小时统一价格。cacheMiss 缺省按 input 价（缓存未命中 = 全价输入）。 */
export function uniform(input: number, output: number, cacheHit: number, cacheMiss = input): HourlyPrice[] {
  return Array.from({ length: 24 }, (_, hour) => ({
    hour, input: usd(input), output: usd(output), cache_hit: usd(cacheHit), cache_miss: usd(cacheMiss),
  }))
}

/** DeepSeek V4 Peak 时段：01:00-04:00 与 06:00-10:00 UTC；其余 Off-Peak。 */
export function deepseekPeak(
  inputOff: number, outputOff: number, cacheOff: number,
  inputPeak: number, outputPeak: number, cachePeak: number,
): HourlyPrice[] {
  const peak = new Set([1, 2, 3, 6, 7, 8, 9])
  return Array.from({ length: 24 }, (_, hour) => peak.has(hour)
    ? { hour, input: usd(inputPeak), output: usd(outputPeak), cache_hit: usd(cachePeak), cache_miss: usd(inputPeak) }
    : { hour, input: usd(inputOff), output: usd(outputOff), cache_hit: usd(cacheOff), cache_miss: usd(inputOff) })
}

/** OpenCode 全量价目表（key = 基础模型 id，opencode-free 的 -free 后缀会自动去掉匹配）。 */
export const OPENCODE_PRICING: Record<string, PricingSpec> = {
  // ── 免费模型（isFree=true，真实价=0；若给参考价则为估算节省用） ──
  'big-pickle':                 { input: 0, output: 0, cacheHit: 0, isFree: true },
  'mimo-v2.5':                  { input: 0, output: 0, cacheHit: 0, isFree: true },
  'ling-3.0-flash-fin':         { input: 0, output: 0, cacheHit: 0, isFree: true },
  'nemotron-3-ultra':           { input: 0, output: 0, cacheHit: 0, isFree: true },
  'nemotron-3.5-lightning':     { input: 0, output: 0, cacheHit: 0, isFree: true },
  'laguna-s-2.1':               { input: 0, output: 0, cacheHit: 0, isFree: true },
  'muse-spark-1.3-contributor': { input: 0, output: 0, cacheHit: 0, isFree: true },
  'muse-spark-1.2-contributor': { input: 1.25, output: 4.25, cacheHit: 0.15, isFree: true },
  'muse-spark-1.2':             { input: 1.25, output: 4.25, cacheHit: 0.15 },

  // ── MiniMax ──
  'minimax-m3':   { input: 0.30, output: 1.20, cacheHit: 0.06 },
  'minimax-m2.7': { input: 0.30, output: 1.20, cacheHit: 0.06 },
  'minimax-m2.5': { input: 0.30, output: 1.20, cacheHit: 0.06 },

  // ── GLM ──
  'glm-5.2': { input: 1.40, output: 4.40, cacheHit: 0.26 },
  'glm-5.1': { input: 1.40, output: 4.40, cacheHit: 0.26 },
  'glm-5':   { input: 1.00, output: 3.20, cacheHit: 0.20 },

  // ── Kimi ──
  'kimi-k2.7-code': { input: 0.95, output: 4.00, cacheHit: 0.19 },
  'kimi-k3':        { input: 3.00, output: 15.00, cacheHit: 0.30 },
  'kimi-k2.6':      { input: 0.95, output: 4.00, cacheHit: 0.16 },
  'kimi-k2.5':      { input: 0.60, output: 3.00, cacheHit: 0.10 },

  // ── Qwen（cacheWrite = 缓存写入价，统计 cache_miss 按 input） ──
  'qwen3.7-max':  { input: 2.50, output: 7.50, cacheHit: 0.50, cacheWrite: 3.125 },
  'qwen3.7-plus': { input: 0.40, output: 1.60, cacheHit: 0.04, cacheWrite: 0.50 },
  'qwen3.6-plus': { input: 0.50, output: 3.00, cacheHit: 0.05, cacheWrite: 0.625 },
  'qwen3.5-plus': { input: 0.20, output: 1.20, cacheHit: 0.02, cacheWrite: 0.25 },

  // ── DeepSeek（Peak/Off-Peak） ──
  'deepseek-v4-pro':   { input: 0.66, output: 1.98, cacheHit: 0.022, peak: { input: 1.32, output: 3.96, cacheHit: 0.044 } },
  'deepseek-v4-flash': { input: 0.22, output: 0.66, cacheHit: 0.007, peak: { input: 0.44, output: 1.32, cacheHit: 0.014 } },

  // ── Claude ──
  'claude-fable-5':      { input: 10.00, output: 50.00, cacheHit: 0.25, cacheWrite: 12.50 },
  'claude-fable-5.1':    { input: 10.00, output: 50.00, cacheHit: 1.00, cacheWrite: 12.50 },
  'claude-opus-5':       { input: 5.00, output: 25.00, cacheHit: 0.50, cacheWrite: 6.25 },
  'claude-opus-4-8':     { input: 5.00, output: 25.00, cacheHit: 0.50, cacheWrite: 6.25 },
  'claude-opus-4-7':     { input: 5.00, output: 25.00, cacheHit: 0.50, cacheWrite: 6.25 },
  'claude-opus-4-6':     { input: 5.00, output: 25.00, cacheHit: 0.50, cacheWrite: 6.25 },
  'claude-opus-4-5':     { input: 5.00, output: 25.00, cacheHit: 0.50, cacheWrite: 6.25 },
  'claude-sonnet-5':     { input: 2.00, output: 10.00, cacheHit: 0.20, cacheWrite: 2.50 },
  'claude-sonnet-4-6':   { input: 3.00, output: 15.00, cacheHit: 0.30, cacheWrite: 3.75 },
  'claude-sonnet-4-5':   { input: 3.00, output: 15.00, cacheHit: 0.30, cacheWrite: 3.75 },
  'claude-haiku-4-5':    { input: 1.00, output: 5.00, cacheHit: 0.10, cacheWrite: 1.25 },

  // ── Gemini ──
  'gemini-3.8-flash':        { input: 1.50, output: 7.50, cacheHit: 0.15 },
  'gemini-3.7-flash':        { input: 1.50, output: 7.50, cacheHit: 0.15 },
  'gemini-3.6-flash':        { input: 1.50, output: 7.50, cacheHit: 0.15 },
  'gemini-3.5-flash':        { input: 1.50, output: 9.00, cacheHit: 0.15 },
  'gemini-3.5-flash-lite':   { input: 0.30, output: 2.50, cacheHit: 0.03 },
  'gemini-3.1-pro':          { input: 2.00, output: 12.00, cacheHit: 0.20 },
  'gemini-3-flash':          { input: 0.50, output: 3.00, cacheHit: 0.05 },

  // ── Grok ──
  'grok-4.6':        { input: 2.00, output: 6.00, cacheHit: 0.50 },
  'grok-4.5':        { input: 2.00, output: 6.00, cacheHit: 0.30 },
  'grok-build-0.1':  { input: 1.00, output: 2.00, cacheHit: 0.20 },

  // ── GPT ──
  'gpt-5.6-sol':      { input: 2.00, output: 10.00, cacheHit: 0.20, cacheWrite: 2.50 },
  'gpt-5.6-terra':    { input: 2.00, output: 12.00, cacheHit: 0.20, cacheWrite: 2.50 },
  'gpt-5.6-luna':     { input: 0.20, output: 1.20, cacheHit: 0.02, cacheWrite: 0.25 },
  'gpt-5.5':          { input: 5.00, output: 30.00, cacheHit: 0.50 },
  'gpt-5.5-pro':      { input: 30.00, output: 180.00, cacheHit: 30.00 },
  'gpt-5.4':          { input: 2.50, output: 15.00, cacheHit: 0.25 },
  'gpt-5.4-pro':      { input: 30.00, output: 180.00, cacheHit: 30.00 },
  'gpt-5.4-mini':     { input: 0.75, output: 4.50, cacheHit: 0.075 },
  'gpt-5.4-nano':     { input: 0.20, output: 1.25, cacheHit: 0.02 },
  'gpt-5.3-codex-spark': { input: 1.75, output: 14.00, cacheHit: 0.175 },
  'gpt-5.3-codex':    { input: 1.75, output: 14.00, cacheHit: 0.175 },
  'gpt-5.2':          { input: 1.75, output: 14.00, cacheHit: 0.175 },
  'gpt-5.2-codex':    { input: 1.75, output: 14.00, cacheHit: 0.175 },
  'gpt-5.1':          { input: 1.07, output: 8.50, cacheHit: 0.107 },
  'gpt-5.1-codex':    { input: 1.07, output: 8.50, cacheHit: 0.107 },
  'gpt-5.1-codex-max':{ input: 1.25, output: 10.00, cacheHit: 0.125 },
  'gpt-5.1-codex-mini':{ input: 0.25, output: 2.00, cacheHit: 0.025 },
  'gpt-5':            { input: 1.07, output: 8.50, cacheHit: 0.107 },
  'gpt-5-codex':      { input: 1.07, output: 8.50, cacheHit: 0.107 },
  'gpt-5-nano':       { input: 0.05, output: 0.40, cacheHit: 0.005 },
}

/** 把模型 id 规整为价目表 key（opencode-free 的 -free 后缀去掉匹配基础模型）。 */
export function normalizeModelKey(modelId: string): string {
  let key = modelId.toLowerCase().trim()
  // 兼容 opencode-free 的 "-free" 后缀：'deepseek-v4-flash-free' → 'deepseek-v4-flash'
  // 但保留真·免费模型自己的 key（big-pickle 等无 -free 后缀，不受影响）。
  if (key.endsWith('-free')) {
    const base = key.slice(0, -'-free'.length)
    if (OPENCODE_PRICING[base]) key = base
  }
  return key
}

/** 查询某个模型 id 的价目表规格。 */
export function lookupSpec(modelId: string): PricingSpec | undefined {
  return OPENCODE_PRICING[normalizeModelKey(modelId)]
}

/**
 * 由价目表生成 model 级 pricing。
 * @param modelId 模型 id
 * @param forceFree 是否强制免费（opencode-free 用：价格作为参考价算节省）
 * @returns ModelPricing（含 hourly_prices / ref_hourly_prices），无价目表返回 null
 */
export function buildModelPricing(modelId: string, forceFree = false): {
  currency: 'USD'
  is_free: boolean
  hourly_prices: HourlyPrice[]
  ref_hourly_prices?: HourlyPrice[]
} | null {
  const spec = lookupSpec(modelId)
  if (!spec) return null

  const realHourly = spec.peak
    ? deepseekPeak(spec.input, spec.output, spec.cacheHit, spec.peak.input, spec.peak.output, spec.peak.cacheHit)
    : uniform(spec.input, spec.output, spec.cacheHit, spec.cacheWrite ?? spec.input)

  const isFree = forceFree || spec.isFree === true
  if (isFree) {
    return {
      currency: 'USD',
      is_free: true,
      hourly_prices: uniform(0, 0, 0, 0),
      // 有真实价格的免费模型，参考价用于计算"节省了多少"
      ref_hourly_prices: spec.input > 0 || spec.output > 0 ? realHourly : undefined,
    }
  }
  return { currency: 'USD', is_free: false, hourly_prices: realHourly }
}
