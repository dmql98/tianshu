import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// 同 pricing-calculator.test：一次性设置 dataDir，避免 getDataDir 缓存问题。
let root: string
let router: any

// DeepSeek V4 Flash 价目表（24 小时）
const OFF = 22, PEAK = 44
const deepseekFlash24 = Array.from({ length: 24 }, (_, hour) => {
  const peak = new Set([1, 2, 3, 6, 7, 8, 9]).has(hour)
  return { hour, input: peak ? PEAK : OFF, output: peak ? 132 : 66, cache_hit: 1, cache_miss: peak ? PEAK : OFF }
})

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'tianshu-statistics-api-'))
  mkdirSync(join(root, 'config'), { recursive: true })
  process.env.TIANSHU_CONFIG_DIR = join(root, 'config')
  process.env.TIANSHU_DATA_DIR = root

  // 预置 provider 价目表：<dataDir>/providers/opencode-go/pricing.json（带 deepseek-v4-flash 价格）
  const ogDir = join(root, 'providers', 'opencode-go')
  mkdirSync(ogDir, { recursive: true })
  writeFileSync(join(ogDir, 'pricing.json'), JSON.stringify({
    schemaVersion: 1,
    currency: 'USD',
    models: { 'deepseek-v4-flash': { currency: 'USD', is_free: false, hourly_prices: deepseekFlash24 } },
  }, null, 2), 'utf-8')

  // 预置数据库：llm_calls 3 条 + 对应 sessions
  const { getDb } = await import('../src/db/schema.js')
  const db = getDb()
  db.exec(`
    INSERT INTO sessions (id, character_id, title, model, provider_id, input_tokens, output_tokens, created_at, updated_at)
    VALUES ('s1', 'coder', '会话1', 'deepseek-v4-flash', 'opencode-go', 0, 0, 1700000000000, 1700000000000),
           ('s2', 'worker', '会话2', 'deepseek-v4-flash', 'opencode-go', 0, 0, 1700000000000, 1700000000000),
           ('s3', 'coder', '会话3', 'gpt-5.6-luna', 'opencode-free', 0, 0, 1700000000000, 1700000000000);
    INSERT INTO llm_calls (session_id, request_model, request_messages, usage_input, usage_output, usage_cache_hit, usage_cache_miss, created_at)
    VALUES
      ('s1', 'deepseek-v4-flash', '[]', 1000000, 0, 0, 0, 1700000000000),   -- hour=22 Off-Peak → 22分
      ('s2', 'deepseek-v4-flash', '[]', 1000000, 0, 0, 0, 1700000000000),   -- 同上
      ('s3', 'gpt-5.6-luna', '[]', 500000, 50000, 0, 0, 1700000000000);     -- 无价格规则 → 免费
  `)

  const mod = await import('../src/routes/statistics.js')
  router = mod.default
})

afterAll(async () => {
  const { closeDb } = await import('../src/db/schema.js') as any
  try { closeDb() } catch { /* ignore */ }
  rmSync(root, { recursive: true, force: true })
  delete process.env.TIANSHU_CONFIG_DIR
  delete process.env.TIANSHU_DATA_DIR
})

async function req(path: string): Promise<{ status: number; body: any }> {
  const r = await router.request(`http://localhost${path}`)
  return { status: r.status, body: await r.json() }
}

describe('GET /overview', () => {
  it('汇总 token/费用/调用次数', async () => {
    const { status, body } = await req('/overview')
    expect(status).toBe(200)
    expect(body.total_input_tokens).toBe(2500000)
    expect(body.total_output_tokens).toBe(50000)
    expect(body.total_calls).toBe(3)
    // 2 条付费（各 22分=44分）+ 1 条免费
    expect(body.total_cost).toBe(88)
    expect(body.paid_calls).toBe(2)
    expect(body.free_calls).toBe(1)
  })
})

describe('GET /by-model', () => {
  it('按模型聚合并计算费用', async () => {
    const { body } = await req('/by-model')
    const ds = body.items.find((x: any) => x.model === 'deepseek-v4-flash')
    expect(ds.total_cost).toBe(88)
    expect(ds.total_input_tokens).toBe(2000000)
    expect(ds.is_free).toBe(false)
    const gpt = body.items.find((x: any) => x.model === 'gpt-5.6-luna')
    expect(gpt.is_free).toBe(true)
    expect(gpt.total_cost).toBe(0)
  })
})

describe('GET /by-character', () => {
  it('按角色聚合', async () => {
    const { body } = await req('/by-character')
    const coder = body.items.find((x: any) => x.character_id === 'coder')
    expect(coder.total_cost).toBe(44) // 只有 s1 是 coder 的付费调用 (Peak hour=6)
    expect(coder.call_count).toBe(2)
  })
})

describe('GET /by-provider', () => {
  it('按服务商聚合', async () => {
    const { body } = await req('/by-provider')
    const og = body.items.find((x: any) => x.provider_id === 'opencode-go')
    expect(og.total_cost).toBe(88)
    expect(og.call_count).toBe(2)
  })
})

describe('GET /detail', () => {
  it('返回明细+分页', async () => {
    const { body } = await req('/detail?limit=2')
    expect(body.total).toBe(3)
    expect(body.items.length).toBe(2)
    expect(body.items[0]).toHaveProperty('cost')
    expect(body.items[0]).toHaveProperty('is_free')
  })
})

describe('筛选', () => {
  it('character_id 筛选', async () => {
    const { body } = await req('/overview?character_id=worker')
    expect(body.total_calls).toBe(1)
    expect(body.total_cost).toBe(44)
    expect(body.total_cost_usd).toBe(44)
    expect(body.total_cost_cny).toBe(0)
  })
  it('model 筛选', async () => {
    const { body } = await req('/overview?model=gpt-5.6-luna')
    expect(body.total_calls).toBe(1)
    expect(body.free_calls).toBe(1)
  })
  it('provider_id 筛选', async () => {
    const { body } = await req('/overview?provider_id=opencode-free')
    expect(body.total_calls).toBe(1)
    expect(body.free_calls).toBe(1)
  })
})

// ── 分币种聚合（CNY 价目表服务商 + exchange-rate.json） ──
// 依赖同一 dataDir：在已有 3 行基础上追加 1 行 CNY 计费调用，
// 断言两桶分别累加、换算合计与 display_currency 生效。
describe('多币种聚合（USD + CNY）', () => {
  beforeAll(async () => {
    const { writeFileSync } = await import('fs')
    const { join } = await import('path')
    // 汇率文件：1 USD = 7.2 CNY
    writeFileSync(join(root, 'config', 'exchange-rate.json'), JSON.stringify({ usdToCny: 7.2, updatedAt: 1 }), 'utf-8')
    // volcengine 用 CNY 价目表（uniform：input ¥72/1M → 7200 分/1M）
    const cnyDir = join(root, 'providers', 'volcengine')
    mkdirSync(cnyDir, { recursive: true })
    const cny24 = Array.from({ length: 24 }, (_, hour) => ({ hour, input: 7200, output: 21600, cache_hit: 900, cache_miss: 7200 }))
    writeFileSync(join(cnyDir, 'pricing.json'), JSON.stringify({
      schemaVersion: 1,
      currency: 'CNY',
      models: { 'deepseek-v4-flash': { currency: 'CNY', is_free: false, hourly_prices: cny24 } },
    }, null, 2), 'utf-8')

    const { getDb } = await import('../src/db/schema.js')
    const db = getDb()
    db.exec(`
      INSERT INTO sessions (id, character_id, title, model, provider_id, input_tokens, output_tokens, created_at, updated_at)
      VALUES ('s4', 'coder', '会话4(CNY)', 'deepseek-v4-flash', 'volcengine', 0, 0, 1700000000000, 1700000000000);
      INSERT INTO llm_calls (session_id, request_model, request_messages, usage_input, usage_output, usage_cache_hit, usage_cache_miss, created_at)
      VALUES ('s4', 'deepseek-v4-flash', '[]', 1000000, 0, 0, 0, 1700000000000);
    `)
    const { invalidatePricingCache } = await import('../src/pricing/calculator.js')
    invalidatePricingCache()
  })

  it('overview：USD 与 CNY 分桶累加，主币种换算 + display_currency', async () => {
    const { body } = await req('/overview?provider_id=volcengine')
    expect(body.total_calls).toBe(1)
    expect(body.total_cost_usd).toBe(0)
    expect(body.total_cost_cny).toBe(7200) // ¥72
    expect(body.currency).toBe('CNY')
    expect(body.total_cost_display).toBe('¥72.00')
    expect(body.exchange_rate_usd_cny).toBe(7.2)
  })

  it('display_currency=USD：换算成美元合计', async () => {
    const { body } = await req('/overview?provider_id=volcengine&display_currency=USD')
    expect(body.currency).toBe('USD')
    expect(body.total_cost).toBe(1000) // 7200/7.2
    expect(body.total_cost_display).toBe('$10.00')
  })

  it('全量 overview：两桶都有值（USD 88 分 + CNY 7200 分）', async () => {
    const { body } = await req('/overview')
    expect(body.total_cost_usd).toBe(88)
    expect(body.total_cost_cny).toBe(7200)
    // 主币种：USD 88 vs 7200/7.2=1000 → CNY 主导
    expect(body.currency).toBe('CNY')
    expect(body.total_cost_display).toBe('¥78.34') // 88*7.2 + 7200 = 7833.6 → 7834分 = ¥78.34
  })

  it('by-provider：volcengine 行 CNY 分桶', async () => {
    const { body } = await req('/by-provider')
    const v = body.items.find((x: any) => x.provider_id === 'volcengine')
    expect(v.total_cost_usd).toBe(0)
    expect(v.total_cost_cny).toBe(7200)
    expect(v.currency).toBe('CNY')
  })

  it('detail：行级 cost_usd/cost_cny', async () => {
    const { body } = await req('/detail?model=deepseek-v4-flash&provider_id=volcengine')
    expect(body.items.length).toBe(1)
    expect(body.items[0].cost_cny).toBe(7200)
    expect(body.items[0].cost_usd).toBe(0)
    expect(body.items[0].cost_display).toBe('¥72.00')
  })
})
