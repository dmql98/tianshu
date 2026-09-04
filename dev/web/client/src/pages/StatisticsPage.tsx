/**
 * StatisticsPage — 用量统计（Token / 费用）。
 *
 * 数据：/api/statistics（overview / by-model / by-character / by-provider /
 * by-day / detail / filters）。费用字段已按价目表币种分桶（USD/CNY 分）返回。
 *
 * 视图：
 * - 筛选：时间范围（近7/30天、全部、自定义）、角色、服务商、模型、币种（展示换算）
 * - KPI：总费用（含分币种真实金额）、节省、Token、调用数、缓存命中率
 * - 每日趋势（费用 / Tokens / 调用）CSS 柱状
 * - 免费 / 付费构成环形 + 分段条
 * - 排行 / 明细表：按模型 / 角色 / 服务商 / 天 / 最近调用
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '@/i18n'
import {
  fetchOverview, fetchByModel, fetchByCharacter, fetchByProvider, fetchByDay,
  fetchDetail, fetchStatisticsFilters,
  type StatisticsOverview, type StatRow, type DetailRow, type StatisticsFilterOptions, type Currency,
} from '@/api/statistics'
import './statistics.css'

// ── 通用格式化 ──

const nf = (n?: number | null) => (n ?? 0).toLocaleString('en-US')

function tkn(n?: number | null): string {
  const v = n ?? 0
  if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B'
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M'
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K'
  return String(v)
}

/** 分（任意币种）→ 金额字符串。 */
function fmtCents(cents: number, cur: Currency): string {
  const sym = cur === 'CNY' ? '¥' : '$'
  const v = cents / 100
  if (v === 0) return `${sym}0.00`
  if (Math.abs(v) >= 100) return sym + v.toLocaleString('en-US', { maximumFractionDigits: 0 })
  return sym + v.toFixed(2)
}

function fmtDateTime(ts: number): string {
  const d = new Date(ts)
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getMonth() + 1}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 真实分币种账单：$13.57 + ¥394.08（某桶为 0 时省略，两桶皆 0 返回空串）。 */
function billText(usd: number, cny: number): string {
  const parts: string[] = []
  if (usd > 0) parts.push(fmtCents(usd, 'USD'))
  if (cny > 0) parts.push(fmtCents(cny, 'CNY'))
  return parts.join(' + ')
}

/** 分币种账单 → 目标币种合并金额（分），跟随显示币种换算（与后端 moneyInCurrency 同公式）。 */
function mergedCents(usd: number, cny: number, currency: Currency, rate: number): number {
  return currency === 'CNY'
    ? Math.round(usd * rate) + cny
    : usd + Math.round(cny / rate)
}

/**
 * KPI 小字：真实分币种账单 + 合并价（跟随显示币种）。
 * 双币种 → "$13.57 + ¥394.08 ≈ $68.30"；单币种且与显示币种不一致时只显示真实账单；
 * 单币种且与显示币种一致（或全 0）→ 不显示（主值已表达）。
 */
function moneySub(usd: number, cny: number, currency: Currency, rate: number): string | null {
  if (!(usd > 0 || cny > 0)) return null
  const bill = billText(usd, cny)
  if (usd > 0 && cny > 0) return `${bill} ≈ ${fmtCents(mergedCents(usd, cny, currency, rate), currency)}`
  const real: Currency = usd > 0 ? 'USD' : 'CNY'
  return real === currency ? null : bill
}

function KpiSub({ usd, cny, currency, rate }: { usd: number; cny: number; currency: Currency; rate: number }) {
  const sub = moneySub(usd, cny, currency, rate)
  return sub ? <span className="stats-kpi-sub">{sub}</span> : null
}

type RangeKey = '7' | '30' | 'all' | 'custom'

export default function StatisticsPage() {
  const t = useI18n()
  // ── 筛选状态 ──
  const [range, setRange] = useState<RangeKey>('30')
  const [fromTs, setFromTs] = useState<number | null>(null)
  const [toTs, setToTs] = useState<number | null>(null)
  const [character, setCharacter] = useState('')
  const [provider, setProvider] = useState('')
  const [model, setModel] = useState('')
  const [currency, setCurrency] = useState<Currency>('USD')
  const [view, setView] = useState<'model' | 'character' | 'provider' | 'day' | 'detail'>('model')
  const [chartMetric, setChartMetric] = useState<'cost' | 'tokens' | 'calls'>('cost')
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 15

  // ── 数据 ──
  const [overview, setOverview] = useState<StatisticsOverview | null>(null)
  const [byModel, setByModel] = useState<StatRow[]>([])
  const [byCharacter, setByCharacter] = useState<StatRow[]>([])
  const [byProvider, setByProvider] = useState<StatRow[]>([])
  const [byDay, setByDay] = useState<StatRow[]>([])
  const [detail, setDetail] = useState<{ total: number; items: DetailRow[] }>({ total: 0, items: [] })
  const [filters, setFilters] = useState<StatisticsFilterOptions>({ models: [], characters: [], providers: [] })
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  const rate = overview?.exchange_rate_usd_cny ?? 7.2

  // 当前筛选（发送给后端）
  const f = useMemo(() => {
    const q: {
      from?: number; to?: number; model?: string; character_id?: string; provider_id?: string; display_currency?: Currency
    } = { display_currency: currency }
    if (range === 'custom') {
      if (fromTs) q.from = fromTs
      if (toTs) q.to = toTs
    } else if (range !== 'all') {
      const days = Number(range)
      const to = Date.now()
      const from = to - (days - 1) * 86400000
      q.from = from
      q.to = to
    }
    if (model) q.model = model
    if (character) q.character_id = character
    if (provider) q.provider_id = provider
    return q
  }, [range, fromTs, toTs, model, character, provider, currency])

  const reload = useCallback(async (showSpinner = true) => {
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    if (showSpinner) setLoading(true)
    setErr('')
    try {
      const [o, m, c, p, d, fl] = await Promise.all([
        fetchOverview(f), fetchByModel(f), fetchByCharacter(f), fetchByProvider(f), fetchByDay(f), fetchStatisticsFilters(),
      ])
      if (ac.signal.aborted) return
      setOverview(o)
      setByModel(m.items ?? [])
      setByCharacter(c.items ?? [])
      setByProvider(p.items ?? [])
      setByDay(d.items ?? [])
      setFilters(fl)
    } catch (e: any) {
      if (ac.signal.aborted) return
      console.error('Failed to load statistics:', e)
      setErr(e?.message || t('加载失败'))
    } finally {
      if (!ac.signal.aborted && showSpinner) setLoading(false)
    }
  }, [f, t])

  // 明细独立加载（分页）
  const reloadDetail = useCallback(async () => {
    try {
      const res = await fetchDetail(f, PAGE_SIZE, (page - 1) * PAGE_SIZE)
      setDetail(res)
    } catch (e) {
      console.error('Failed to load detail:', e)
    }
  }, [f, page])

  useEffect(() => { void reload() }, [reload])
  useEffect(() => { if (view === 'detail') void reloadDetail() }, [view, reloadDetail])

  // ── 派生 ──
  const rows = useMemo(() => {
    if (view === 'model') return byModel
    if (view === 'character') return byCharacter
    if (view === 'provider') return byProvider
    if (view === 'day') return byDay
    return []
  }, [view, byModel, byCharacter, byProvider, byDay])

  const freePaid = useMemo(() => {
    const paid = overview?.paid_calls ?? 0
    const free = overview?.free_calls ?? 0
    const total = Math.max(paid + free, 1)
    return { paid, free, total, pct: paid / total * 100 }
  }, [overview])

  const resetFilters = () => {
    setRange('30'); setFromTs(null); setToTs(null); setCharacter(''); setProvider(''); setModel('')
    setPage(1)
  }

  // 主体
  return (
    <main className="main stats-main">
      <div className="page-header stats-header">
        <div className="page-header-left">
          <span className="page-title">{t('用量统计')}</span>
          <span className="page-desc">
            {overview ? `${nf(overview.total_calls)} ${t('次调用')} · ${nf(overview.total_tokens)} tokens` : t('加载中...')}
          </span>
        </div>
        <div className="header-actions">
          <span className="stats-rate-hint" title="exchange-rate.json · 仅展示换算">1 USD ≈ {rate} CNY</span>
          <button className="btn" onClick={() => void reload()} title={t('刷新')}>{t('刷新')}</button>
        </div>
      </div>

      <div className="content stats-content">
        {err && <div className="stats-error">{err}</div>}

        {/* ── 筛选条 ── */}
        <div className="stats-toolbar">
          <div className="chip-group">
            {([['7', t('近 7 天')], ['30', t('近 30 天')], ['all', t('全部')]] as const).map(([k, label]) => (
              <button key={k} className={`chip ${range === k ? 'active' : ''}`}
                onClick={() => { setRange(k); setPage(1) }}>{label}</button>
            ))}
          </div>
          <label className="stats-date">
            {t('从')}
            <input type="date" value={fromTs ? toDateInput(fromTs) : ''}
              onChange={e => { setFromTs(e.target.value ? new Date(e.target.value + 'T00:00:00').getTime() : null); setRange('custom') }} />
            <input type="date" value={toTs ? toDateInput(toTs) : ''}
              onChange={e => { setToTs(e.target.value ? new Date(e.target.value + 'T23:59:59').getTime() : null); setRange('custom') }} />
            {t('至')}
          </label>
          <div className="stats-divider" />
          <select className="sel" value={character} onChange={e => { setCharacter(e.target.value); setPage(1) }}>
            <option value="">{t('全部角色')}</option>
            {filters.characters.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select className="sel" value={provider} onChange={e => { setProvider(e.target.value); setModel(''); setPage(1) }}>
            <option value="">{t('全部服务商')}</option>
            {filters.providers.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <select className="sel" value={model} onChange={e => { setModel(e.target.value); setPage(1) }}>
            <option value="">{t('全部模型')}</option>
            {filters.models.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <div className="stats-divider" />
          <div className="chip-group" title={t('金额显示币种（展示换算）')}>
            <button className={`chip ${currency === 'USD' ? 'active' : ''}`} onClick={() => setCurrency('USD')}>$ USD</button>
            <button className={`chip ${currency === 'CNY' ? 'active' : ''}`} onClick={() => setCurrency('CNY')}>¥ CNY</button>
          </div>
          <button className="btn sm" onClick={resetFilters}>✕ {t('重置')}</button>
        </div>

        {/* ── KPI ── */}
        <div className="stats-kpis">
          {overview ? <>
            <div className="stats-kpi">
              <div className="stats-kpi-label">{t('总费用')}</div>
              <div className="stats-kpi-value gold">{fmtCents(overview.total_cost, overview.currency)}
                <KpiSub usd={overview.total_cost_usd} cny={overview.total_cost_cny} currency={currency} rate={rate} />
              </div>
              <div className="stats-kpi-foot">{nf(overview.paid_calls)} {t('付费')} · {nf(overview.free_calls)} {t('免费')}</div>
            </div>
            <div className="stats-kpi">
              <div className="stats-kpi-label">{t('节省金额')}</div>
              <div className="stats-kpi-value green">{fmtCents(overview.total_savings, overview.currency)}
                <KpiSub usd={overview.total_savings_usd} cny={overview.total_savings_cny} currency={currency} rate={rate} />
              </div>
              <div className="stats-kpi-foot">{t('免费模型按参考价折算')}</div>
            </div>
            <div className="stats-kpi">
              <div className="stats-kpi-label">{t('Token 用量')}</div>
              <div className="stats-kpi-value">{tkn(overview.total_tokens)}</div>
              <div className="stats-kpi-foot">{t('输入')} {tkn(overview.total_input_tokens)} · {t('输出')} {tkn(overview.total_output_tokens)}</div>
            </div>
            <div className="stats-kpi">
              <div className="stats-kpi-label">{t('调用次数')}</div>
              <div className="stats-kpi-value">{nf(overview.total_calls)}</div>
              <div className="stats-kpi-foot">{byDay.length} {t('个活跃日')}</div>
            </div>
            <div className="stats-kpi">
              <div className="stats-kpi-label">{t('缓存命中')}</div>
              <div className="stats-kpi-value">{overview.cache_hit_rate != null ? overview.cache_hit_rate.toFixed(1) + '%' : '—'}</div>
              <div className="stats-kpi-foot">{t('命中')} {tkn(overview.total_cache_hit_tokens)}</div>
            </div>
            <div className="stats-kpi">
              <div className="stats-kpi-label">{t('输入构成')}</div>
              <div className="stats-kpi-value stats-kpi-small">
                <span className="gold">{tkn(overview.total_cache_hit_tokens)}</span> {t('命中')}
              </div>
              <div className="stats-kpi-foot">{t('新输入')} {tkn(overview.total_cache_miss_tokens)} · {t('输出')} {tkn(overview.total_output_tokens)}</div>
            </div>
          </> : loading ? (
            <div className="stats-loading">{t('加载中...')}</div>
          ) : (
            <div className="stats-loading">{t('暂无数据')}</div>
          )}
        </div>

        {/* ── 中部：趋势 + 免费付费 ── */}
        <div className="stats-mid">
          <section className="stats-card">
            <div className="stats-card-head">
              <span className="stats-card-title">{t('每日趋势')}</span>
              <div className="chip-group">
                {([['cost', t('费用')], ['tokens', 'Tokens'], ['calls', t('调用')]] as const).map(([k, label]) => (
                  <button key={k} className={`chip ${chartMetric === k ? 'active' : ''}`} onClick={() => setChartMetric(k)}>{label}</button>
                ))}
              </div>
            </div>
            <DayChart rows={byDay} metric={chartMetric} currency={currency} rate={rate} />
          </section>

          <section className="stats-card">
            <div className="stats-card-head"><span className="stats-card-title">{t('免费 / 付费构成')}</span><span className="stats-card-count">{t('按调用次数')}</span></div>
            <div className="stats-chart-wrap">
              <div className="stats-donut-box">
                <div className="stats-donut" style={{ background: `conic-gradient(var(--gold) 0 ${freePaid.pct}%, var(--jade) ${freePaid.pct}% 100%)` }}>
                  <div className="stats-donut-hole">
                    <b>{nf(freePaid.paid + freePaid.free)}</b>
                    <span>{t('次调用')}</span>
                  </div>
                </div>
              </div>
              <div className="stats-stack">
                <div className="stats-stack-seg" style={{ width: `${freePaid.pct}%`, background: 'var(--gold)' }}>{t('付费')} {nf(freePaid.paid)}</div>
                <div className="stats-stack-seg" style={{ width: `${100 - freePaid.pct}%`, background: 'var(--jade)' }}>{t('免费')} {nf(freePaid.free)}</div>
              </div>
              <div className="stats-donut-legend">
                <div><i style={{ background: 'var(--gold)' }} />{t('付费调用')} {nf(freePaid.paid)}{overview && (overview.total_cost_usd > 0 || overview.total_cost_cny > 0) ? <em> · {t('实际计费')} <b>{billText(overview.total_cost_usd, overview.total_cost_cny)}{overview.total_cost_usd > 0 && overview.total_cost_cny > 0 ? ` ≈ ${fmtCents(mergedCents(overview.total_cost_usd, overview.total_cost_cny, currency, rate), currency)}` : ''}</b></em> : ''}</div>
                <div><i style={{ background: 'var(--jade)' }} />{t('免费调用')} {nf(freePaid.free)}{overview ? <em> · {t('等效节省')} <b>{fmtCents(overview.total_savings ?? 0, overview.currency)}{overview.total_savings_usd > 0 && overview.total_savings_cny > 0 ? ` ≈ ${fmtCents(mergedCents(overview.total_savings_usd, overview.total_savings_cny, currency, rate), currency)}` : ''}</b></em> : null}</div>
              </div>
            </div>
          </section>
        </div>

        {/* ── 排行 / 明细 ── */}
        <section className="stats-card">
          <div className="stats-card-head">
            <div className="chip-group">
              {([['model', t('按模型')], ['character', t('按角色')], ['provider', t('按服务商')], ['day', t('按天')], ['detail', t('最近调用')]] as const)
                .map(([k, label]) => (
                  <button key={k} className={`chip ${view === k ? 'active' : ''}`}
                    onClick={() => { setView(k); setPage(1) }}>{label}</button>
                ))}
            </div>
            <span className="stats-card-count">{view === 'detail' ? `${nf(detail.total)} ${t('条')}` : ''}</span>
          </div>

          {view === 'detail' ? (
            <DetailTable rows={detail.items} currency={currency} rate={rate} />
          ) : (
            <StatTable
              rows={rows} view={view} currency={currency} rate={rate}
              onFilter={(p, m, c) => { setProvider(p || ''); setModel(m || ''); setCharacter(c || ''); setView('model'); setPage(1) }}
            />          )}

          {view === 'detail' && detail.total > PAGE_SIZE && (
            <div className="stats-pager">
              <span>{t('第 {page} 页 · 共 {pages} 页', { page, pages: Math.max(1, Math.ceil(detail.total / PAGE_SIZE)) })}</span>
              <span>
                <button className="btn sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>‹</button>{' '}
                <button className="btn sm" disabled={page >= Math.ceil(detail.total / PAGE_SIZE)} onClick={() => setPage(p => p + 1)}>›</button>
              </span>
            </div>
          )}
        </section>
      </div>
    </main>
  )
}

function toDateInput(ts: number): string {
  const d = new Date(ts)
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/* ═══ 每日趋势 CSS 柱状 ═══ */

function DayChart({ rows, metric, currency, rate }: { rows: StatRow[]; metric: 'cost' | 'tokens' | 'calls'; currency: Currency; rate: number }) {
  const t = useI18n()
  if (!rows.length) return <div className="stats-empty">{t('暂无数据')}</div>
  const vals = rows.map(r => {
    if (metric === 'cost') return Math.round((r.total_cost_usd ?? 0) + (r.total_cost_cny ?? 0) / rate)
    if (metric === 'tokens') return r.total_tokens ?? 0
    return r.call_count ?? 0
  })
  const max = Math.max(...vals, 1)
  return (
    <div className="stats-bars">
      {rows.map((r, i) => {
        const v = vals[i]
        const h = v > 0 ? Math.max(4, (v / max) * 100) : 0
        const costRow = billText(r.total_cost_usd ?? 0, r.total_cost_cny ?? 0)
        const tooltip = metric === 'cost'
          ? `${r.date} · ${costRow}${costRow && r.total_cost_usd && r.total_cost_cny ? ` ≈ ${fmtCents(mergedCents(r.total_cost_usd, r.total_cost_cny, currency, rate), currency)}` : ''} · ${nf(r.call_count)} ${t('次')}`
          : `${r.date} · ${metric === 'tokens' ? tkn(v) : nf(v)} · ${nf(r.call_count)} ${t('次')}`
        return (
          <div key={r.date} className="stats-bar-col" title={tooltip}>
            <div className="stats-bar-area">
              <div className={`stats-bar ${v === 0 ? 'zero' : ''}`} style={{ height: v === 0 ? 6 : h + '%' }} />
            </div>
            <div className="stats-bar-x">{(r.date || '').slice(5).replace('-', '/')}</div>
          </div>
        )
      })}
      <div className="stats-bars-legend">
        <span>{metric === 'cost' ? t('单位：金额（真实分币种 + 当前币种换算）') : metric === 'tokens' ? t('单位：Tokens') : t('单位：次')}</span>
      </div>
    </div>
  )
}

/* ═══ 明细表 ═══ */

function DetailTable({ rows, currency, rate }: { rows: DetailRow[]; currency: Currency; rate: number }) {
  const t = useI18n()
  if (!rows.length) return <div className="stats-empty">{t('暂无数据')}</div>
  return (
    <div className="stats-table-scroll">
      <table className="tbl stats-tbl">
        <thead><tr>
          <th>{t('时间')}</th>
          <th>{t('会话')}</th>
          <th>{t('角色')}</th>
          <th>{t('服务商')}</th>
          <th>{t('模型')}</th>
          <th className="num">{t('输入')}</th>
          <th className="num">{t('缓存命中')}</th>
          <th className="num">{t('输出')}</th>
          <th className="num">{t('总费用')}</th>
          <th>{t('计费')}</th>
        </tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id}>
              <td className="mono">{fmtDateTime(r.created_at)}</td>
              <td className="stats-ellipsis" title={r.session_title || ''}>{r.session_title || '—'}</td>
              <td>{r.character_id || '—'}</td>
              <td>{r.provider_id || '—'}</td>
              <td className="mono">{r.model || '—'}</td>
              <td className="num">{r.is_free && r.ref_miss ? <span className="ref">{tkn(r.usage_cache_miss)} <em>{fmtCents(r.ref_miss, r.currency)}</em></span> : <span>{tkn(r.usage_cache_miss)} {r.cost_miss ? <em className="gold">{fmtCents(r.cost_miss, r.currency)}</em> : ''}</span>}</td>
              <td className="num">{r.is_free && r.ref_hit ? <span className="ref">{tkn(r.usage_cache_hit)} <em>{fmtCents(r.ref_hit, r.currency)}</em></span> : <span>{tkn(r.usage_cache_hit)} {r.cost_hit ? <em className="gold">{fmtCents(r.cost_hit, r.currency)}</em> : ''}</span>}</td>
              <td className="num">{r.is_free && r.ref_out ? <span className="ref">{tkn(r.usage_output)} <em>{fmtCents(r.ref_out, r.currency)}</em></span> : <span>{tkn(r.usage_output)} {r.cost_out ? <em className="gold">{fmtCents(r.cost_out, r.currency)}</em> : ''}</span>}</td>
              <td className="num strong">{r.is_free ? <><del className="ref-del">{fmtCents(r.savings_usd + (r.savings_cny ? r.savings_cny / rate : 0), currency)}</del> <span className="free-0">{fmtCents(0, currency)}</span></> : fmtCents(r.cost_usd + (r.cost_cny ? r.cost_cny / rate : 0), currency)}</td>
              <td>{r.is_free ? <span className="badge free">FREE</span> : <span className="badge paid">{t('计费')}</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ═══ 聚合表 ═══ */

function StatTable({ rows, view, currency, rate, onFilter }: {
  rows: StatRow[]; view: 'model' | 'character' | 'provider' | 'day'; currency: Currency; rate: number; onFilter: (p?: string, m?: string, c?: string) => void
}) {
  const t = useI18n()
  if (!rows.length) return <div className="stats-empty">{t('暂无数据')}</div>
  const isModel = view === 'model'
  return (
    <div className="stats-table-scroll">
      <table className="tbl stats-tbl">
        <thead><tr>
          <th>#</th>
          <th>{view === 'model' ? t('模型 / 服务商') : view === 'character' ? t('角色') : view === 'provider' ? t('服务商') : t('日期')}</th>
          {isModel && <th className="num">{t('调用')}</th>}
          {view === 'model' && <>
            <th className="num">{t('输入（未命中）')}<span className="th-sub">{t('用量')} / {t('费用')}</span></th>
            <th className="num">{t('缓存命中')}<span className="th-sub">{t('用量')} / {t('费用')}</span></th>
            <th className="num">{t('输出')}<span className="th-sub">{t('用量')} / {t('费用')}</span></th>
          </>}
          {view === 'character' && <>
            <th className="num">{t('调用')}</th><th className="num">{t('Tokens')}</th>
          </>}
          {view === 'provider' && <>
            <th className="num">{t('调用')}</th><th className="num">{t('Tokens')}</th>
          </>}
          {view === 'day' && <>
            <th className="num">{t('调用')}</th><th className="num">{t('Tokens')}</th>
          </>}
          <th className="num">{t('总费用')}</th>
          {view !== 'day' && <th className="num">{t('节省')}</th>}
          {isModel && <th>{t('计费')}</th>}
        </tr></thead>
        <tbody>
          {rows.map((r, i) => {
            const usd = r.total_cost_usd ?? 0
            const cny = r.total_cost_cny ?? 0
            const hasCost = usd > 0 || cny > 0
            const costText = hasCost
              ? `${billText(usd, cny)} ${usd > 0 && cny > 0 ? `≈ ${fmtCents(mergedCents(usd, cny, currency, rate), currency)}` : ''}`
              : fmtCents(0, currency)
            const saveUsd = r.total_savings_usd ?? 0
            const saveCny = r.total_savings_cny ?? 0
            const hasSave = saveUsd > 0 || saveCny > 0
            const saveText = hasSave
              ? `${billText(saveUsd, saveCny)} ${saveUsd > 0 && saveCny > 0 ? `≈ ${fmtCents(mergedCents(saveUsd, saveCny, currency, rate), currency)}` : ''}`
              : ''
            const rowCur: Currency = cny > 0 ? 'CNY' : usd > 0 ? 'USD' : currency
            const key = `${r.model || ''}@${r.provider_id || ''}`
            const clickable = isModel || view === 'provider' || view === 'character'
            return (
              <tr key={key || i}
                className={clickable ? 'clickable' : ''}
                onClick={clickable ? () => onFilter(
                  isModel || view === 'provider' ? (r.provider_id || undefined) : undefined,
                  isModel ? (r.model || undefined) : undefined,
                  view === 'character' ? (r.character_id || undefined) : undefined,
                ) : undefined}>
                <td><span className="rank">{i + 1}</span></td>
                <td className="stats-ellipsis" title={isModel ? `${r.model} @ ${r.provider_id}` : ''}>
                  {isModel ? <><b>{r.model}</b><span className="sub">{r.provider_id}</span></>
                    : view === 'character' ? <><b>{r.character_id}</b></>
                      : view === 'provider' ? <b>{r.provider_id}</b>
                        : r.date}
                </td>
                {isModel && <td className="num">{nf(r.call_count)}</td>}
                {isModel && <>
                  <td className="num stats-seg-cell">{r.is_free
                    ? <span className="ref">{tkn(r.total_cache_miss_tokens ?? 0)} <em>{r.ref_miss ? fmtCents(r.ref_miss, rowCur) : fmtCents(0, rowCur)}</em></span>
                    : (r.cost_miss ? <span>{tkn(r.total_cache_miss_tokens ?? 0)} <em className="gold">{fmtCents(r.cost_miss, rowCur)}</em></span> : '—')}</td>
                  <td className="num stats-seg-cell">{r.is_free
                    ? <span className="ref">{tkn(r.total_cache_hit_tokens ?? 0)} <em>{r.ref_hit ? fmtCents(r.ref_hit, rowCur) : fmtCents(0, rowCur)}</em></span>
                    : (r.cost_hit ? <span>{tkn(r.total_cache_hit_tokens ?? 0)} <em className="gold">{fmtCents(r.cost_hit, rowCur)}</em></span> : '—')}</td>
                  <td className="num stats-seg-cell">{r.is_free
                    ? <span className="ref">{tkn(r.total_output_tokens ?? 0)} <em>{r.ref_out ? fmtCents(r.ref_out, rowCur) : fmtCents(0, rowCur)}</em></span>
                    : (r.cost_out ? <span>{tkn(r.total_output_tokens ?? 0)} <em className="gold">{fmtCents(r.cost_out, rowCur)}</em></span> : '—')}</td>
                </>}
                {(view === 'character' || view === 'provider' || view === 'day') && <>
                  <td className="num">{nf(r.call_count)}</td>
                  <td className="num">{tkn(r.total_tokens)}</td>
                </>}
                <td className="num strong">
                  {hasCost ? costText : <span className="free-0">{fmtCents(0, currency)}</span>}
                </td>
                {view !== 'day' && (
                  <td className="num green">{saveText || '—'}</td>
                )}
                {isModel && <td>{r.is_free ? <span className="badge free">FREE</span> : <span className="badge paid">{t('计费')}</span>}</td>}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
