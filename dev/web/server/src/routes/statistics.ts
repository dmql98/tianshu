/**
 * routes/statistics.ts — Token 用量统计与费用计算 API。
 *
 * 数据源：llm_calls（每次 LLM 调用一行）JOIN sessions（角色/服务商/标题）。
 * 价格：pricing/calculator.ts 从各 provider 目录 pricing.json 匹配（model 级 → provider 级 → 免费）。
 *
 * 币种：价目表声明结算币种（USD/CNY），账目按币种分桶（cost_usd / cost_cny 真实金额），
 * 展示换算（display_currency / 主币种）使用 exchange-rate.json 的参考汇率，不混算真实账目。
 *
 * 端点：
 *   GET /overview     全局汇总（token / 费用 / 节省 / 缓存率 / 调用次数）
 *   GET /by-model     按模型聚合
 *   GET /by-character 按角色聚合
 *   GET /by-provider  按服务商聚合
 *   GET /by-day       按天聚合（趋势）
 *   GET /detail       明细列表（分页）
 *
 * 公共筛选参数：from / to / model / character_id / provider_id（epoch ms）
 * 显示参数：display_currency=USD|CNY（可选，控制换算主币种）
 */
import { Hono, type Context } from 'hono'
import { getDb } from '../db/schema.js'
import { calculateCost, formatCost, createCostAccumulator, accumulateCost, resultMoney, moneyInCurrency, type CostAccumulator, type CostResult, type MoneyCents } from '../pricing/calculator.js'
import { getExchangeRate, type Currency } from '../pricing/exchangeRate.js'

const router = new Hono()

// ── 筛选条件构建 ──

interface Filters {
  where: string[]
  params: unknown[]
}

/**
 * 从查询参数构建 WHERE 条件。主表别名由 alias 指定（llm_calls → c，messages → m），
 * 角色/服务商筛选一律 JOIN sessions（s.*）。model 筛选在主表侧（c.request_model）。
 */
function buildFiltersWithAlias(c: Context, alias: string): Filters {
  const where: string[] = []
  const params: unknown[] = []
  const from = c.req.query('from')
  const to = c.req.query('to')
  const model = c.req.query('model')
  const characterId = c.req.query('character_id')
  const providerId = c.req.query('provider_id')

  if (from) {
    const n = Number(from)
    if (Number.isFinite(n)) { where.push(`${alias}.created_at >= ?`); params.push(n) }
  }
  if (to) {
    const n = Number(to)
    if (Number.isFinite(n)) { where.push(`${alias}.created_at <= ?`); params.push(n) }
  }
  if (model) { where.push(`${alias}.request_model = ?`); params.push(model) }
  if (characterId) { where.push('s.character_id = ?'); params.push(characterId) }
  if (providerId) { where.push('s.provider_id = ?'); params.push(providerId) }

  return { where, params }
}

/** llm_calls JOIN sessions 的筛选（现有端点用，主表别名 c）。 */
function buildFilters(c: Context): Filters {
  return buildFiltersWithAlias(c, 'c')
}

/**
 * /usage 端点专用筛选：主表 messages（别名 m）。model 筛选落到 sessions.model
 * （messages 无模型列，工具行由所属会话的模型决定）。
 */
function buildUsageFilters(c: Context): Filters {
  const f = buildFiltersWithAlias(c, 'm')
  // model 移到 sessions 侧
  f.where = f.where.map(w => w === 'm.request_model = ?' ? 's.model = ?' : w)
  return f
}

/** 读 display_currency 查询参数（非法值忽略）。 */
function displayCurrencyOf(c: Context): Currency | undefined {
  const v = c.req.query('display_currency')
  return v === 'CNY' ? 'CNY' : v === 'USD' ? 'USD' : undefined
}

/** llm_calls JOIN sessions 的公共前缀。 */
const FROM_JOIN = 'FROM llm_calls c LEFT JOIN sessions s ON s.id = c.session_id'

function whereClause(f: Filters): string {
  return f.where.length > 0 ? ` WHERE ${f.where.join(' AND ')}` : ''
}

// ── 汇总工具 ──

interface RawUsageRow {
  input: number
  output: number
  cacheHit: number
  cacheMiss: number
  providerId: string | null
  model: string | null
  createdAt: number
}

/** 逐行计算费用并累加（内存匹配价格规则）。 */
function accumulateRows(rows: RawUsageRow[], acc: CostAccumulator): void {
  for (const row of rows) {
    const result = calculateCost(row.providerId, row.model, {
      input: row.input,
      output: row.output,
      cacheHit: row.cacheHit,
      cacheMiss: row.cacheMiss,
    }, row.createdAt)
    accumulateCost(acc, result)
  }
}

/**
 * 聚合金额 → JSON 字段。total_cost_* / total_savings_* 为真实分币种账目，
 * total_cost / total_savings / currency / *_display 为按主币种（或 display_currency 指定）换算的展示值。
 */
function moneyFields(bucket: { cost: MoneyCents; savings: MoneyCents }, hint?: Currency) {
  const costView = moneyInCurrency(bucket.cost, hint)
  const savingsView = moneyInCurrency(bucket.savings, hint)
  return {
    total_cost_usd: Math.round(bucket.cost.usd),
    total_cost_cny: Math.round(bucket.cost.cny),
    total_cost: costView.total,
    total_cost_display: formatCost(costView.total, costView.currency),
    total_savings_usd: Math.round(bucket.savings.usd),
    total_savings_cny: Math.round(bucket.savings.cny),
    total_savings: savingsView.total,
    total_savings_display: formatCost(savingsView.total, savingsView.currency),
    currency: costView.currency,
  }
}

/** 单次结算结果 → 行级金额 JSON（cost/cost_display 为原币种，cost_usd/cost_cny 分币种）。 */
function rowMoneyFields(r: CostResult) {
  const money = resultMoney(r)
  return {
    cost: Math.round(r.cost),
    cost_display: formatCost(r.cost, r.currency),
    cost_usd: Math.round(money.usd),
    cost_cny: Math.round(money.cny),
    savings: Math.round(r.savings),
    savings_usd: Math.round(r.currency === 'CNY' ? 0 : r.savings),
    savings_cny: Math.round(r.currency === 'CNY' ? r.savings : 0),
    currency: r.currency,
  }
}

// ── GET /usage ──
// 工具 / 技能调用次数（按 tool_usage 事实表聚合，含控制工具）。
// 时间/角色/服务商/模型 筛选与其它端点同参数。
// 每次调用打一行（recordToolUsage / sweepToolUsage），status 分 success/error/denied。
// 支持 ?by=day 返回按天趋势（保留 tools/skills 结构，tool_total 等按天累计）。

function isSkillToolName(name: string): boolean {
  return name === 'skill_manager'
}

interface UsageRow {
  tool_name: string
  call_count: number
  success_count: number
  error_count: number
  denied_count: number
}

/** /usage 专用筛选：主表 tool_usage（别名 u），session 侧维度 JOIN sessions（s.*）。 */
function buildToolUsageFilters(c: Context): Filters {
  const where: string[] = []
  const params: unknown[] = []
  const from = c.req.query('from')
  const to = c.req.query('to')
  const characterId = c.req.query('character_id')
  const providerId = c.req.query('provider_id')
  const model = c.req.query('model')

  if (from) { const n = Number(from); if (Number.isFinite(n)) { where.push('u.created_at >= ?'); params.push(n) } }
  if (to) { const n = Number(to); if (Number.isFinite(n)) { where.push('u.created_at <= ?'); params.push(n) } }
  if (characterId) { where.push('s.character_id = ?'); params.push(characterId) }
  if (providerId) { where.push('s.provider_id = ?'); params.push(providerId) }
  if (model) { where.push('s.model = ?'); params.push(model) }
  return { where, params }
}

router.get('/usage', (c) => {
  const f = buildToolUsageFilters(c)
  const byDay = c.req.query('by') === 'day'
  const groupExpr = byDay ? '(u.created_at / 86400000) * 86400000' : 'u.tool_name'
  const orderExpr = byDay ? 'day_start' : 'call_count DESC, u.tool_name ASC'

  const rows = getDb().prepare(`
    SELECT
      ${byDay ? '(u.created_at / 86400000) * 86400000 AS day_start' : 'u.tool_name AS tool_name'},
      SUM(u.count) AS call_count,
      SUM(CASE WHEN u.status = 'success' THEN u.count ELSE 0 END) AS success_count,
      SUM(CASE WHEN u.status = 'error'   THEN u.count ELSE 0 END) AS error_count,
      SUM(CASE WHEN u.status = 'denied'  THEN u.count ELSE 0 END) AS denied_count
    FROM tool_usage u
    LEFT JOIN sessions s ON s.id = u.session_id
    WHERE 1=1
      ${f.where.length > 0 ? ` AND ${f.where.join(' AND ')}` : ''}
    GROUP BY ${groupExpr}
    ORDER BY ${orderExpr}
  `).all(...f.params) as UsageRow[]

  if (byDay) {
    // 按天：返回 tools=day 序列（成功/失败/拒绝分桶累计），skills 复用 tool_usage 的技能行按天。
    const tools: Array<{ date: string; call_count: number; success_count: number; error_count: number; denied_count: number }> = []
    const skills: Array<{ date: string; call_count: number; success_count: number; error_count: number; denied_count: number }> = []
    let toolTotal = 0
    let skillTotal = 0
    for (const row of rows) {
      // 技能行以 tool_name 区分，按天分组时需聚合技能名 → 这里保持按天对日聚合：
      // 由于 GROUP BY day_start 已把所有工具/技能合并到同一天，需再按工具维度展开。
      // 简化：by-day 模式不拆分 tools/skills，统一进 tools（前端趋势用 call_count）。
      tools.push({
        date: new Date((row as any).day_start).toISOString().slice(0, 10),
        call_count: row.call_count,
        success_count: row.success_count,
        error_count: row.error_count,
        denied_count: row.denied_count,
      })
      toolTotal += row.call_count
    }
    return c.json({ tools, skills, tool_total: toolTotal, skill_total: skillTotal })
  }

  const tools: Array<{ tool_name: string; call_count: number; success_count: number; error_count: number; denied_count: number }> = []
  const skills: Array<{ tool_name: string; call_count: number; success_count: number; error_count: number; denied_count: number }> = []
  let toolTotal = 0
  let skillTotal = 0
  for (const row of rows) {
    const item = {
      tool_name: row.tool_name,
      call_count: row.call_count,
      success_count: row.success_count,
      error_count: row.error_count,
      denied_count: row.denied_count,
    }
    if (isSkillToolName(row.tool_name)) {
      skills.push(item)
      skillTotal += row.call_count
    } else {
      tools.push(item)
      toolTotal += row.call_count
    }
  }
  return c.json({ tools, skills, tool_total: toolTotal, skill_total: skillTotal })
})

// ── GET /overview ──

router.get('/overview', (c) => {
  const f = buildFilters(c)
  const hint = displayCurrencyOf(c)
  const rows = getDb().prepare(`
    SELECT
      c.session_id,
      c.request_model AS model,
      s.provider_id AS providerId,
      COALESCE(c.usage_input, 0)   AS input,
      COALESCE(c.usage_output, 0)  AS output,
      COALESCE(c.usage_cache_hit, 0)  AS cacheHit,
      COALESCE(c.usage_cache_miss, 0) AS cacheMiss,
      c.created_at AS createdAt
    ${FROM_JOIN}
    ${whereClause(f)}
  `).all(...f.params) as unknown as Array<RawUsageRow & { session_id: string }>

  let totalInput = 0, totalOutput = 0, totalCacheHit = 0, totalCacheMiss = 0
  const acc = createCostAccumulator()
  for (const row of rows) {
    totalInput += row.input
    totalOutput += row.output
    totalCacheHit += row.cacheHit
    totalCacheMiss += row.cacheMiss
  }
  accumulateRows(rows, acc)

  const totalTokens = totalInput + totalOutput + totalCacheHit + totalCacheMiss
  const cacheTotal = totalCacheHit + totalCacheMiss
  const cacheHitRate = cacheTotal > 0 ? Math.round((totalCacheHit / cacheTotal) * 1000) / 10 : null

  // 会话数：与本次筛选相关的、实际发生过 LLM 调用的去重会话数。
  const sessionCountRow = getDb().prepare(`
    SELECT COUNT(DISTINCT c.session_id) AS n
    FROM llm_calls c
    LEFT JOIN sessions s ON s.id = c.session_id
    ${whereClause(f)}
  `).get(...f.params) as { n: number }

  return c.json({
    total_input_tokens: totalInput,
    total_output_tokens: totalOutput,
    total_cache_hit_tokens: totalCacheHit,
    total_cache_miss_tokens: totalCacheMiss,
    total_tokens: totalTokens,
    cache_hit_rate: cacheHitRate,
    ...moneyFields(acc, hint),
    exchange_rate_usd_cny: getExchangeRate().usdToCny,
    total_calls: rows.length,
    free_calls: acc.freeCalls,
    paid_calls: acc.paidCalls,
    session_count: sessionCountRow.n,
  })
})

/** 单次结算节省金额 → 分币种桶（节省币种 = 结算币种）。 */
function savingsOf(r: CostResult): MoneyCents {
  return { usd: r.currency === 'CNY' ? 0 : r.savings, cny: r.currency === 'CNY' ? r.savings : 0 }
}

/** 行级 JSON 附加分项费用字段（cost_miss/cost_hit/cost_out + ref 三件套，原币种分）。 */
function rowSegmentFields(r: CostResult) {
  return {
    cost_miss: Math.round(r.costMiss ?? 0),
    cost_hit: Math.round(r.costHit ?? 0),
    cost_out: Math.round(r.costOut ?? 0),
    ref_miss: Math.round(r.refMiss ?? 0),
    ref_hit: Math.round(r.refHit ?? 0),
    ref_out: Math.round(r.refOut ?? 0),
  }
}

/** 聚合桶 JSON 附加分币种分项（跨币种给两桶；前端按行币种挑用）。 */
function bucketSegmentFields(b: CostAccumulator) {
  return {
    total_cost_miss_usd: Math.round(b.miss.usd),
    total_cost_miss_cny: Math.round(b.miss.cny),
    total_cost_hit_usd: Math.round(b.hit.usd),
    total_cost_hit_cny: Math.round(b.hit.cny),
    total_cost_out_usd: Math.round(b.out.usd),
    total_cost_out_cny: Math.round(b.out.cny),
  }
}

// ── GET /by-model ──

router.get('/by-model', (c) => {
  const f = buildFilters(c)
  const hint = displayCurrencyOf(c)
  const rows = getDb().prepare(`
    SELECT
      c.request_model AS model,
      s.provider_id AS provider_id,
      COALESCE(SUM(c.usage_input), 0)    AS input,
      COALESCE(SUM(c.usage_output), 0)   AS output,
      COALESCE(SUM(c.usage_cache_hit), 0)  AS cacheHit,
      COALESCE(SUM(c.usage_cache_miss), 0) AS cacheMiss,
      COUNT(*) AS call_count,
      MAX(c.created_at) AS createdAt
    ${FROM_JOIN}
    ${whereClause(f)}
    GROUP BY c.request_model, s.provider_id
    ORDER BY input + output + cacheHit + cacheMiss DESC
  `).all(...f.params) as Array<{
    model: string | null
    provider_id: string | null
    input: number
    output: number
    cacheHit: number
    cacheMiss: number
    call_count: number
    createdAt: number | null
  }>

  const items = rows.map(row => {
    const result = calculateCost(row.provider_id, row.model, {
      input: row.input, output: row.output, cacheHit: row.cacheHit, cacheMiss: row.cacheMiss,
    }, row.createdAt || 0)
    const m = resultMoney(result)
    return {
      model: row.model,
      provider_id: row.provider_id,
      total_input_tokens: row.input,
      total_output_tokens: row.output,
      total_cache_hit_tokens: row.cacheHit,
      total_cache_miss_tokens: row.cacheMiss,
      total_tokens: row.input + row.output + row.cacheHit + row.cacheMiss,
      ...moneyFields({ cost: m, savings: savingsOf(result) }, hint),
      ...rowSegmentFields(result),
      call_count: row.call_count,
      is_free: result.isFree,
    }
  })

  return c.json({ items })
})

// ── GET /by-character ──

router.get('/by-character', (c) => {
  const f = buildFilters(c)
  const hint = displayCurrencyOf(c)
  const rows = getDb().prepare(`
    SELECT
      s.character_id AS character_id,
      c.request_model AS model,
      s.provider_id AS provider_id,
      COALESCE(SUM(c.usage_input), 0)    AS input,
      COALESCE(SUM(c.usage_output), 0)   AS output,
      COALESCE(SUM(c.usage_cache_hit), 0)  AS cacheHit,
      COALESCE(SUM(c.usage_cache_miss), 0) AS cacheMiss,
      COUNT(*) AS call_count,
      COUNT(DISTINCT c.session_id) AS session_count,
      MAX(c.created_at) AS createdAt
    ${FROM_JOIN}
    ${whereClause(f)}
    GROUP BY s.character_id, c.request_model, s.provider_id
  `).all(...f.params) as Array<{
    character_id: string | null
    model: string | null
    provider_id: string | null
    input: number
    output: number
    cacheHit: number
    cacheMiss: number
    call_count: number
    session_count: number
    createdAt: number | null
  }>

  // 按角色聚合（跨模型/服务商汇总费用）
  const byChar = new Map<string, {
    character_id: string
    input: number
    output: number
    cacheHit: number
    cacheMiss: number
    call_count: number
    session_count: number
    acc: CostAccumulator
  }>()
  for (const row of rows) {
    const key = row.character_id || 'unknown'
    let bucket = byChar.get(key)
    if (!bucket) {
      bucket = {
        character_id: row.character_id || 'unknown',
        input: 0, output: 0, cacheHit: 0, cacheMiss: 0, call_count: 0, session_count: 0,
        acc: createCostAccumulator(),
      }
      byChar.set(key, bucket)
    }
    bucket.input += row.input
    bucket.output += row.output
    bucket.cacheHit += row.cacheHit
    bucket.cacheMiss += row.cacheMiss
    bucket.call_count += row.call_count
    bucket.session_count += row.session_count
    const result = calculateCost(row.provider_id, row.model, {
      input: row.input, output: row.output, cacheHit: row.cacheHit, cacheMiss: row.cacheMiss,
    }, row.createdAt || 0)
    accumulateCost(bucket.acc, result)
  }

  const items = [...byChar.values()].map(b => ({
    character_id: b.character_id,
    total_input_tokens: b.input,
    total_output_tokens: b.output,
    total_cache_hit_tokens: b.cacheHit,
    total_cache_miss_tokens: b.cacheMiss,
    total_tokens: b.input + b.output + b.cacheHit + b.cacheMiss,
    ...moneyFields(b.acc, hint),
    ...bucketSegmentFields(b.acc),
    call_count: b.call_count,
    session_count: b.session_count,
  })).sort((a, b) => b.total_tokens - a.total_tokens)

  return c.json({ items })
})

// ── GET /by-provider ──

router.get('/by-provider', (c) => {
  const f = buildFilters(c)
  const hint = displayCurrencyOf(c)
  const rows = getDb().prepare(`
    SELECT
      s.provider_id AS provider_id,
      c.request_model AS model,
      COALESCE(SUM(c.usage_input), 0)    AS input,
      COALESCE(SUM(c.usage_output), 0)   AS output,
      COALESCE(SUM(c.usage_cache_hit), 0)  AS cacheHit,
      COALESCE(SUM(c.usage_cache_miss), 0) AS cacheMiss,
      COUNT(*) AS call_count,
      MAX(c.created_at) AS createdAt
    ${FROM_JOIN}
    ${whereClause(f)}
    GROUP BY s.provider_id, c.request_model
  `).all(...f.params) as Array<{
    provider_id: string | null
    model: string | null
    input: number
    output: number
    cacheHit: number
    cacheMiss: number
    call_count: number
    createdAt: number | null
  }>

  const byProvider = new Map<string, {
    provider_id: string
    input: number
    output: number
    cacheHit: number
    cacheMiss: number
    call_count: number
    acc: CostAccumulator
  }>()
  for (const row of rows) {
    const key = row.provider_id || 'unknown'
    let bucket = byProvider.get(key)
    if (!bucket) {
      bucket = {
        provider_id: row.provider_id || 'unknown',
        input: 0, output: 0, cacheHit: 0, cacheMiss: 0, call_count: 0,
        acc: createCostAccumulator(),
      }
      byProvider.set(key, bucket)
    }
    bucket.input += row.input
    bucket.output += row.output
    bucket.cacheHit += row.cacheHit
    bucket.cacheMiss += row.cacheMiss
    bucket.call_count += row.call_count
    const result = calculateCost(row.provider_id, row.model, {
      input: row.input, output: row.output, cacheHit: row.cacheHit, cacheMiss: row.cacheMiss,
    }, row.createdAt || 0)
    accumulateCost(bucket.acc, result)
  }

  const items = [...byProvider.values()].map(b => ({
    provider_id: b.provider_id,
    total_input_tokens: b.input,
    total_output_tokens: b.output,
    total_cache_hit_tokens: b.cacheHit,
    total_cache_miss_tokens: b.cacheMiss,
    total_tokens: b.input + b.output + b.cacheHit + b.cacheMiss,
    ...moneyFields(b.acc, hint),
    ...bucketSegmentFields(b.acc),
    call_count: b.call_count,
  })).sort((a, b) => b.total_tokens - a.total_tokens)

  return c.json({ items })
})

// ── GET /by-day ──

router.get('/by-day', (c) => {
  const f = buildFilters(c)
  const hint = displayCurrencyOf(c)
  const rows = getDb().prepare(`
    SELECT
      date(c.created_at / 1000, 'unixepoch', 'localtime') AS day,
      c.request_model AS model,
      s.provider_id AS provider_id,
      COALESCE(SUM(c.usage_input), 0)    AS input,
      COALESCE(SUM(c.usage_output), 0)   AS output,
      COALESCE(SUM(c.usage_cache_hit), 0)  AS cacheHit,
      COALESCE(SUM(c.usage_cache_miss), 0) AS cacheMiss,
      COUNT(*) AS call_count,
      MAX(c.created_at) AS createdAt
    ${FROM_JOIN}
    ${whereClause(f)}
    GROUP BY day, c.request_model, s.provider_id
    ORDER BY day ASC
  `).all(...f.params) as Array<{
    day: string
    model: string | null
    provider_id: string | null
    input: number
    output: number
    cacheHit: number
    cacheMiss: number
    call_count: number
    createdAt: number | null
  }>

  // 按天聚合（跨模型汇总费用）
  const byDay = new Map<string, {
    date: string
    input: number
    output: number
    cacheHit: number
    cacheMiss: number
    call_count: number
    acc: CostAccumulator
  }>()
  for (const row of rows) {
    const key = row.day
    let bucket = byDay.get(key)
    if (!bucket) {
      bucket = {
        date: row.day,
        input: 0, output: 0, cacheHit: 0, cacheMiss: 0, call_count: 0,
        acc: createCostAccumulator(),
      }
      byDay.set(key, bucket)
    }
    bucket.input += row.input
    bucket.output += row.output
    bucket.cacheHit += row.cacheHit
    bucket.cacheMiss += row.cacheMiss
    bucket.call_count += row.call_count
    const result = calculateCost(row.provider_id, row.model, {
      input: row.input, output: row.output, cacheHit: row.cacheHit, cacheMiss: row.cacheMiss,
    }, row.createdAt || 0)
    accumulateCost(bucket.acc, result)
  }

  const items = [...byDay.values()].map(b => ({
    date: b.date,
    total_input_tokens: b.input,
    total_output_tokens: b.output,
    total_cache_hit_tokens: b.cacheHit,
    total_cache_miss_tokens: b.cacheMiss,
    total_tokens: b.input + b.output + b.cacheHit + b.cacheMiss,
    ...moneyFields(b.acc, hint),
    ...bucketSegmentFields(b.acc),
    call_count: b.call_count,
  }))

  return c.json({ items })
})

// ── GET /detail ──

router.get('/detail', (c) => {
  const f = buildFilters(c)
  const rawLimit = Number(c.req.query('limit')) || 50
  const limit = Math.min(500, Math.max(1, Math.floor(rawLimit)))
  const rawOffset = Number(c.req.query('offset')) || 0
  const offset = Math.max(0, Math.floor(rawOffset))

  // 总数
  const countRow = getDb().prepare(`
    SELECT COUNT(*) AS n
    ${FROM_JOIN}
    ${whereClause(f)}
  `).get(...f.params) as { n: number }
  const total = countRow.n

  // 明细（分页）
  const rows = getDb().prepare(`
    SELECT
      c.id,
      c.session_id,
      s.title AS session_title,
      s.character_id AS character_id,
      s.provider_id AS provider_id,
      c.request_model AS model,
      COALESCE(c.usage_input, 0)   AS input,
      COALESCE(c.usage_output, 0)  AS output,
      COALESCE(c.usage_cache_hit, 0)  AS cacheHit,
      COALESCE(c.usage_cache_miss, 0) AS cacheMiss,
      c.created_at AS createdAt
    ${FROM_JOIN}
    ${whereClause(f)}
    ORDER BY c.id DESC
    LIMIT ? OFFSET ?
  `).all(...f.params, limit, offset) as Array<{
    id: number
    session_id: string
    session_title: string | null
    character_id: string | null
    provider_id: string | null
    model: string | null
    input: number
    output: number
    cacheHit: number
    cacheMiss: number
    createdAt: number
  }>

  const items = rows.map(row => {
    const result = calculateCost(row.provider_id, row.model, {
      input: row.input, output: row.output, cacheHit: row.cacheHit, cacheMiss: row.cacheMiss,
    }, row.createdAt)
    return {
      id: row.id,
      session_id: row.session_id,
      session_title: row.session_title || null,
      character_id: row.character_id,
      provider_id: row.provider_id,
      model: row.model,
      usage_input: row.input,
      usage_output: row.output,
      usage_cache_hit: row.cacheHit,
      usage_cache_miss: row.cacheMiss,
      ...rowMoneyFields(result),
      ...rowSegmentFields(result),
      is_free: result.isFree,
      created_at: row.createdAt,
    }
  })

  return c.json({ total, items })
})

// ── 筛选维度枚举（供前端下拉） ──

router.get('/filters', (c) => {
  const models = getDb().prepare('SELECT DISTINCT request_model AS model FROM llm_calls WHERE request_model IS NOT NULL ORDER BY request_model').all() as Array<{ model: string }>
  const characters = getDb().prepare(`
    SELECT DISTINCT s.character_id AS character_id FROM llm_calls c
    LEFT JOIN sessions s ON s.id = c.session_id
    WHERE s.character_id IS NOT NULL ORDER BY s.character_id
  `).all() as Array<{ character_id: string }>
  const providers = getDb().prepare(`
    SELECT DISTINCT s.provider_id AS provider_id FROM llm_calls c
    LEFT JOIN sessions s ON s.id = c.session_id
    WHERE s.provider_id IS NOT NULL ORDER BY s.provider_id
  `).all() as Array<{ provider_id: string }>

  return c.json({
    models: models.map(m => m.model),
    characters: characters.map(x => x.character_id),
    providers: providers.map(x => x.provider_id),
  })
})

export default router
