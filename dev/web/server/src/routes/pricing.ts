/**
 * routes/pricing.ts — 价格配置 CRUD API。
 *
 * 读写各 provider 目录下的 pricing.json（<dataDir>/providers/<id>/pricing.json）：
 * - provider 级 default_pricing
 * - model 级 pricing（is_free / currency / hourly_prices / ref_hourly_prices）
 * - 汇率（<dataDir>/config/exchange-rate.json，仅展示换算用，不影响真实分币种账目）
 *
 * 端点：
 *   GET  /api/pricing                读取所有服务商的计费配置
 *   PUT  /api/pricing                保存计费配置（全量替换计费字段，不动其他字段）
 *   GET  /api/pricing/exchange-rate  读取汇率
 *   PUT  /api/pricing/exchange-rate  保存汇率（1 USD = ? CNY）
 */
import { Hono } from 'hono'
import { pricingStore } from '../pricing/pricingStore.js'
import { invalidatePricingCache } from '../pricing/calculator.js'
import { getExchangeRate, saveExchangeRate, invalidateExchangeRateCache, DEFAULT_USD_TO_CNY } from '../pricing/exchangeRate.js'
import type { ProviderPricing, ModelPricing } from '../pricing/types.js'

const router = new Hono()

// ── GET /api/pricing/exchange-rate ──

router.get('/exchange-rate', (c) => {
  const cfg = getExchangeRate()
  const fileRate = cfg.usdToCny
  return c.json({
    usd_to_cny: fileRate,
    updated_at: cfg.updatedAt ?? null,
    note: cfg.note ?? null,
    source: fileRate === DEFAULT_USD_TO_CNY && !cfg.updatedAt ? 'default' : 'file',
  })
})

// ── PUT /api/pricing/exchange-rate ──

router.put('/exchange-rate', async (c) => {
  const body = await c.req.json().catch(() => null)
  const rate = Number(body?.usd_to_cny)
  if (!Number.isFinite(rate) || rate <= 0 || rate > 100_000) {
    return c.json({ error: 'usd_to_cny 必须是 >0 的数值（1 USD = ? CNY）' }, 400)
  }
  const saved = saveExchangeRate({ usdToCny: rate, note: typeof body?.note === 'string' ? body.note : undefined })
  invalidateExchangeRateCache()
  invalidatePricingCache()
  return c.json({
    ok: true,
    usd_to_cny: saved.usdToCny,
    updated_at: saved.updatedAt,
    note: saved.note ?? null,
  })
})

// ── GET /api/pricing ──

router.get('/', (c) => {
  const rules = pricingStore.loadAll()
  const items = rules.map(r => ({
    provider_id: r.providerId,
    default_pricing: r.defaultPricing || null,
    models: [...r.modelPricing.entries()].map(([modelId, pricing]) => ({
      model_id: modelId,
      is_free: pricing?.is_free === true,
      pricing,
    })),
  }))
  return c.json({ providers: items })
})

// ── PUT /api/pricing ──

router.put('/', async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body || !Array.isArray(body.providers)) {
    return c.json({ error: 'body 必须包含 providers 数组' }, 400)
  }

  let updated = 0

  for (const item of body.providers) {
    const pid = item?.provider_id
    if (!pid) continue

    const existing = pricingStore.read(pid) || {}
    const file = {
      schemaVersion: 1,
      currency: item.currency ?? existing.currency ?? 'USD',
      default_pricing: (item.default_pricing !== undefined ? item.default_pricing : existing.default_pricing) as ProviderPricing | undefined,
      models: { ...(existing.models || {}) },
    }

    // 更新 model 级 pricing（按 model_id 精确匹配；不存在的 model 新增）
    const modelItems = Array.isArray(item.models) ? item.models : []
    for (const modelItem of modelItems) {
      const mid = modelItem?.model_id
      if (!mid) continue
      if (modelItem.pricing !== undefined) {
        file.models[mid] = (modelItem.pricing || { is_free: true }) as ModelPricing
      }
    }

    pricingStore.write(pid, file)
    updated += 1
  }

  invalidatePricingCache()
  return c.json({ ok: true, updated })
})

export default router
