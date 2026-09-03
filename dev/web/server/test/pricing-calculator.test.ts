import { describe, expect, it, afterAll, beforeAll } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

// getDataDir() 在 config.ts 有模块级缓存，须在 import calculator 前一次性设置 env
//（与 theme-api.test 一致：beforeAll 设置）。
// pricingStore 从 <dataDir>/providers/<id>/pricing.json 读价目表。
let root: string
let providersRootDir: string
let calc: typeof import('../src/pricing/calculator.js')

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'tianshu-pricing-test-'))
  providersRootDir = join(root, 'providers')
  mkdirSync(providersRootDir, { recursive: true })
  process.env.TIANSHU_CONFIG_DIR = join(root, 'config')
  process.env.TIANSHU_DATA_DIR = root
  calc = await import('../src/pricing/calculator.js')
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
  delete process.env.TIANSHU_CONFIG_DIR
  delete process.env.TIANSHU_DATA_DIR
  calc.invalidatePricingCache()
})

/** 写入 <dataDir>/providers/<id>/pricing.json 并清缓存。 */
function seedProviderPricing(providerId: string, file: Record<string, unknown>): void {
  const dir = resolve(providersRootDir, providerId)
  mkdirSync(dir, { recursive: true })
  writeFileSync(resolve(dir, 'pricing.json'), JSON.stringify(file, null, 2), 'utf-8')
  calc.invalidatePricingCache()
}

const OFF = 22, PEAK = 44
const deepseekFlash24 = Array.from({ length: 24 }, (_, hour) => {
  const peak = new Set([1, 2, 3, 6, 7, 8, 9]).has(hour)
  return { hour, input: peak ? PEAK : OFF, output: peak ? 132 : 66, cache_hit: 1, cache_miss: peak ? PEAK : OFF }
})

const goPricingFile = {
  schemaVersion: 1,
  currency: 'USD',
  models: {
    'deepseek-v4-flash': { currency: 'USD', is_free: false, hourly_prices: deepseekFlash24 },
    'minimax-m2.5': { currency: 'USD', is_free: true, hourly_prices: [], ref_hourly_prices: deepseekFlash24 },
  },
}

describe('resolvePrice', () => {
  it('model 级 pricing 命中（pricing.json）', () => {
    seedProviderPricing('opencode-go', goPricingFile)
    const r = calc.resolvePrice('opencode-go', 'deepseek-v4-flash')
    expect(r.isFree).toBe(false)
    expect(r.hourly).toHaveLength(24)
    expect(r.hourly[0].input).toBe(OFF)
    expect(r.hourly[2].input).toBe(PEAK)
  })

  it('免费模型（is_free=true）', () => {
    seedProviderPricing('opencode-go', goPricingFile)
    const r = calc.resolvePrice('opencode-go', 'minimax-m2.5')
    expect(r.isFree).toBe(true)
  })

  it('provider 无 model 匹配 → 免费兜底', () => {
    seedProviderPricing('opencode-go', goPricingFile)
    const r = calc.resolvePrice('opencode-go', 'nonexistent')
    expect(r.isFree).toBe(true)
    expect(r.hourly).toHaveLength(0)
  })

  it('本服务商无规则时，跨服务商按模型 id 取价', () => {
    seedProviderPricing('opencode-go', goPricingFile)
    // tokendance 无 pricing.json → 应从 opencode-go 借价
    const r = calc.resolvePrice('tokendance', 'deepseek-v4-flash')
    expect(r.isFree).toBe(false)
    expect(r.hourly[0].input).toBe(OFF)
  })

  it('无任何 pricing.json → 全部免费', () => {
    rmSync(resolve(providersRootDir, 'opencode-go'), { recursive: true, force: true })
    calc.invalidatePricingCache()
    const r = calc.resolvePrice('whatever', 'deepseek-v4-flash')
    expect(r.isFree).toBe(true)
    expect(r.hourly).toHaveLength(0)
  })
})

describe('calculateCost', () => {
  it('付费模型按小时时段价格计算（Peak 更高）', () => {
    seedProviderPricing('opencode-go', goPricingFile)
    const usage = { input: 1_000_000, output: 0, cacheHit: 0, cacheMiss: 0 }
    const off = calc.calculateCost('opencode-go', 'deepseek-v4-flash', usage, new Date(2026, 0, 1, 0).getTime())
    expect(off.cost).toBeCloseTo(22, 5)
    expect(off.isFree).toBe(false)
    const peak = calc.calculateCost('opencode-go', 'deepseek-v4-flash', usage, new Date(2026, 0, 1, 2).getTime())
    expect(peak.cost).toBeCloseTo(44, 5)
  })

  it('免费模型实际费用=0，节省按 ref_hourly_prices 估算', () => {
    seedProviderPricing('opencode-go', goPricingFile)
    const usage = { input: 1_000_000, output: 0, cacheHit: 0, cacheMiss: 0 }
    const r = calc.calculateCost('opencode-go', 'minimax-m2.5', usage, new Date(2026, 0, 1, 0).getTime())
    expect(r.cost).toBe(0)
    expect(r.isFree).toBe(true)
    expect(r.savings).toBeCloseTo(OFF, 5)
  })

  it('无价格规则 → 免费且节省=0', () => {
    seedProviderPricing('opencode-go', goPricingFile)
    const r = calc.calculateCost('opencode-go', 'gpt-5.6-luna', { input: 1000, output: 100, cacheHit: 0, cacheMiss: 0 }, Date.now())
    expect(r.isFree).toBe(true)
    expect(r.cost).toBe(0)
    expect(r.savings).toBe(0)
  })

  it('跨服务商命中免费模型时，节省仍按命中方 ref_hourly_prices 计算', () => {
    // opencode-go 有 minimax-m2.5（免费 + ref_hourly_prices）；tokendance 无价目表。
    seedProviderPricing('opencode-go', goPricingFile)
    const usage = { input: 1_000_000, output: 0, cacheHit: 0, cacheMiss: 0 }
    const r = calc.calculateCost('tokendance', 'minimax-m2.5', usage, new Date(2026, 0, 1, 0).getTime())
    expect(r.isFree).toBe(true)
    expect(r.cost).toBe(0)
    // 未命中缓存 → input 整体按 ref.input 计参考价（Off-Peak=22 分）
    expect(r.savings).toBeCloseTo(OFF, 5)
    expect(r.refMiss).toBeCloseTo(OFF, 5)
  })
})

describe('priceForHour', () => {
  it('缺小时条目回退到最近之前的一条', () => {
    const hourly = [
      { hour: 0, input: 10, output: 20, cache_hit: 1, cache_miss: 10 },
      { hour: 8, input: 30, output: 60, cache_hit: 2, cache_miss: 30 },
    ]
    expect(calc.priceForHour(hourly, 0)?.input).toBe(10)
    expect(calc.priceForHour(hourly, 5)?.input).toBe(10)
    expect(calc.priceForHour(hourly, 8)?.input).toBe(30)
    expect(calc.priceForHour(hourly, 9)?.input).toBe(30)
    expect(calc.priceForHour([], 0)).toBeNull()
  })
})

describe('formatCost', () => {
  it('分 → 金额字符串', () => {
    expect(calc.formatCost(1250, 'USD')).toBe('$12.50')
    expect(calc.formatCost(0, 'USD')).toBe('$0.00')
    expect(calc.formatCost(3574, 'USD')).toBe('$35.74')
    expect(calc.formatCost(311, 'CNY')).toBe('¥3.11')
  })
})

describe('CNY 价目表（分币种）', () => {
  it('CNY 结算模型费用币种为 CNY', () => {
    seedProviderPricing('volcengine', {
      schemaVersion: 1,
      currency: 'CNY',
      models: { 'deepseek-v4-flash': { currency: 'CNY', is_free: false, hourly_prices: deepseekFlash24 } },
    })
    const r = calc.calculateCost('volcengine', 'deepseek-v4-flash', { input: 1_000_000, output: 0, cacheHit: 0, cacheMiss: 0 }, new Date(2026, 0, 1, 0).getTime())
    expect(r.currency).toBe('CNY')
    expect(r.cost).toBeCloseTo(OFF, 5)
  })

  it('分币种聚合：USD + CNY 分别累加，moneyInCurrency 按主币种换算', () => {
    seedProviderPricing('opencode-go', goPricingFile)
    seedProviderPricing('volcengine', {
      schemaVersion: 1,
      currency: 'CNY',
      models: { 'deepseek-v4-flash': { currency: 'CNY', is_free: false, hourly_prices: deepseekFlash24 } },
    })
    const acc = calc.createCostAccumulator()
    const usage = { input: 1_000_000, output: 0, cacheHit: 0, cacheMiss: 0 }
    // USD 档 2 次（Off-Peak 各 22 分）
    acc.cost.usd += calc.calculateCost('opencode-go', 'deepseek-v4-flash', usage, new Date(2026, 0, 1, 0).getTime()).cost
    acc.cost.usd += calc.calculateCost('opencode-go', 'deepseek-v4-flash', usage, new Date(2026, 0, 1, 0).getTime()).cost
    // CNY 档 1 次（22 分 CNY）
    const cny = calc.calculateCost('volcengine', 'deepseek-v4-flash', usage, new Date(2026, 0, 1, 0).getTime())
    acc.cost.cny += cny.cost
    expect(acc.cost.usd).toBeCloseTo(44, 5)
    expect(acc.cost.cny).toBeCloseTo(22, 5)
    // 主币种 USD：44 + 22/7.2 ≈ 47（round(44 + 3.055…)）
    const view = calc.moneyInCurrency(acc.cost)
    expect(view.currency).toBe('USD')
    expect(view.total).toBe(47)
    // display_currency=CNY：44*7.2 + 22 = 338.8 → 339
    const cnyView = calc.moneyInCurrency(acc.cost, 'CNY')
    expect(cnyView.currency).toBe('CNY')
    expect(cnyView.total).toBe(339)
  })
})
