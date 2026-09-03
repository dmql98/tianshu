/**
 * pricing/exchangeRate.ts — 汇率配置（<dataDir>/config/exchange-rate.json）。
 *
 * 用途：把「结算币种」不同的费用归一到「显示币种」做参考换算（不是结算汇率，
 * 结算永远按价目表声明的币种计；统计账目按币种分别累加，不混算）。
 *
 * 文件结构：
 *   { "usdToCny": 7.2, "updatedAt": 1756800000000, "note": "..." }
 *
 * 缓存：文件 mtime 变化时自动重读，无需重启。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import { configExchangeRateFile } from '../data-paths.js'

export const SUPPORTED_CURRENCIES = ['USD', 'CNY'] as const
export type Currency = (typeof SUPPORTED_CURRENCIES)[number]

export const DEFAULT_USD_TO_CNY = 7.2

export interface ExchangeRateConfig {
  /** 1 USD = ? CNY。 */
  usdToCny: number
  /** 最后更新时间（epoch ms，可选）。 */
  updatedAt?: number
  /** 来源说明 / 备注（可选）。 */
  note?: string
}

// ── 读取（带 mtime 缓存） ──

let cache: { mtimeMs: number; cfg: ExchangeRateConfig } | null = null

function readFile(): ExchangeRateConfig | null {
  const file = configExchangeRateFile()
  if (!existsSync(file)) return null
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as Partial<ExchangeRateConfig>
    const rate = Number(parsed.usdToCny)
    if (!Number.isFinite(rate) || rate <= 0) return null
    return {
      usdToCny: rate,
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : undefined,
      note: typeof parsed.note === 'string' ? parsed.note : undefined,
    }
  } catch {
    return null
  }
}

/** 获取当前汇率（文件缺失/损坏 → 默认 7.2，保证永远可用）。 */
export function getExchangeRate(): ExchangeRateConfig {
  const file = configExchangeRateFile()
  let mtimeMs = 0
  try { mtimeMs = existsSync(file) ? statSync(file).mtimeMs : 0 } catch { mtimeMs = 0 }
  if (cache && cache.mtimeMs === mtimeMs) return cache.cfg
  const cfg = readFile() || { usdToCny: DEFAULT_USD_TO_CNY }
  cache = { mtimeMs, cfg }
  return cfg
}

/** 清缓存（测试/热更新用）。 */
export function invalidateExchangeRateCache(): void {
  cache = null
}

/** 保存汇率配置（原子写）。 */
export function saveExchangeRate(rate: Partial<ExchangeRateConfig> & { usdToCny: number }): ExchangeRateConfig {
  const file = configExchangeRateFile()
  mkdirSync(dirname(file), { recursive: true })
  const clean: ExchangeRateConfig = {
    usdToCny: rate.usdToCny,
    updatedAt: Date.now(),
    note: rate.note,
  }
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tmp, JSON.stringify(clean, null, 2), 'utf-8')
  renameSync(tmp, file)
  cache = null
  return clean
}

/** 分（任意币种）→ 分（目标币种），参考换算，四舍五入取整分。 */
export function convertCents(cents: number, from: Currency, to: Currency, rate?: number): number {
  if (!(cents > 0) || from === to) return cents
  const usdToCny = rate ?? getExchangeRate().usdToCny
  if (from === 'USD' && to === 'CNY') return Math.round(cents * usdToCny)
  if (from === 'CNY' && to === 'USD') return Math.round(cents / usdToCny)
  return cents
}
