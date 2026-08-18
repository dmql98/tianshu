import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { fetchRecentRuns, fetchRunTrajectory, type RunRow } from '@/api/runs'
import type { TrajectoryData } from '@/types'
import {
  buildTrajectory,
  filterTrajectory,
  highlightParts,
  summarizeTrajectory,
  type TrajectoryModel,
  type TrajectoryRow,
  type TrajectoryTimelineMode,
} from '@/features/trajectory/trajectory'
import TimelineBar from '@/features/trajectory/TimelineBar'
import { formatDuration, formatTokens } from '@/features/chat/runStats'
import { useI18n } from '@/i18n'

const STATUS_LABEL: Record<string, string> = {
  queued: '排队中', preparing: '准备中', running: '运行中', cancelling: '取消中',
  awaiting_approval: '等待审批', awaiting_input: '等待输入', paused: '已暂停',
  completed: '已完成', failed: '失败', cancelled: '已取消',
  max_turns: '轮数上限', budget_exhausted: '预算耗尽', interrupted: '已中断',
}

function hhmmss(ts: number): string {
  const d = new Date(ts)
  const two = (v: number) => String(v).padStart(2, '0')
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`
}

function runStatusClass(status: string): string {
  if (status === 'completed') return 'ok'
  if (status === 'failed' || status === 'cancelled' || status === 'interrupted'
    || status === 'max_turns' || status === 'budget_exhausted') return 'error'
  return 'running'
}

/** 高亮一段文本中搜索命中的子串（query 为空时原样输出）。 */
function Highlighted({ text, query }: { text: string; query: string }) {
  const parts = highlightParts(text, query)
  if (parts.length === 1 && !parts[0].hit) return <>{text}</>
  return (
    <>
      {parts.map((part, i) => part.hit
        ? <mark key={i} className="tjs-mark">{part.text}</mark>
        : <span key={i}>{part.text}</span>)}
    </>
  )
}

function RowHeader({ row, query }: { row: TrajectoryRow; query: string }) {
  const t = useI18n()
  if (row.kind === 'user') {
    return <span className="tjs-row-title"><Highlighted text={row.text.slice(0, 80) || t('用户')} query={query} /></span>
  }
  if (row.kind === 'assistant') {
    const bits: string[] = []
    if (row.requestNumber !== null) bits.push(`#${row.requestNumber}`)
    if (row.step !== null) bits.push(`步 ${row.step}`)
    bits.push(t('助手'))
    if (row.llmMs !== null && row.llmMs > 0) bits.push(formatDuration(row.llmMs))
    return <span className="tjs-row-title">{bits.join(' · ')}</span>
  }
  const bits: Array<string | React.ReactNode> = []
  if (row.requestNumber !== null) bits.push(`#${row.requestNumber}`)
  if (row.step !== null) bits.push(`步 ${row.step}`)
  bits.push(t('工具'))
  if (row.toolName) bits.push(<Highlighted key="name" text={row.toolName} query={query} />)
  if (row.durationMs !== null && row.durationMs > 0) bits.push(formatDuration(row.durationMs))
  return <span className="tjs-row-title">{bits}</span>
}

function AssistantBody({ row, query }: { row: TrajectoryRow; query: string }) {
  const t = useI18n()
  const [showReasoning, setShowReasoning] = useState(false)
  const meta: string[] = []
  if (row.llmMs !== null) meta.push(`${t('时长')} ${formatDuration(row.llmMs)}`)
  if (row.ttftMs !== null) meta.push(`${t('首 token')} ${formatDuration(row.ttftMs)}`)
  if (row.tokenSpeed !== null && row.tokenSpeed > 0) meta.push(`${row.tokenSpeed.toFixed(1)} tok/s`)
  if (row.inputTokens !== null || row.outputTokens !== null) {
    meta.push(`${t('输入')} ${formatTokens(row.inputTokens ?? 0)} · ${t('输出')} ${formatTokens(row.outputTokens ?? 0)}`)
  }
  if (row.cacheHitTokens !== null) {
    const total = (row.cacheHitTokens ?? 0) + (row.cacheMissTokens ?? 0)
    const pct = total > 0 ? Math.round((row.cacheHitTokens ?? 0) / total * 100) : null
    if (pct !== null) meta.push(`${t('缓存命中')} ${pct}%`)
  }
  return (
    <div className="tjs-assistant">
      {row.reasoning && (
        <div className="tjs-reasoning">
          <button className="tjs-toggle" onClick={() => setShowReasoning(v => !v)}>
            {showReasoning ? '▾' : '▸'} {t('思考')}
          </button>
          {showReasoning && <pre className="tjs-pre tjs-reasoning-body">{row.reasoning}</pre>}
        </div>
      )}
      {row.text && <pre className="tjs-pre tjs-assistant-text"><Highlighted text={row.text} query={query} /></pre>}
      {meta.length > 0 && <div className="tjs-meta">{meta.join(' · ')}</div>}
    </div>
  )
}

function ToolBody({ row, query }: { row: TrajectoryRow; query: string }) {
  const t = useI18n()
  const [showOutput, setShowOutput] = useState(false)
  const truncated = (row.text?.length ?? 0) > 4000
  return (
    <div className="tjs-tool">
      <div className="tjs-meta">
        <span className={`tjs-status ${row.isError ? 'error' : row.toolStatus === 'denied' ? 'denied' : 'ok'}`}>
          {row.isError ? t('失败') : row.toolStatus === 'denied' ? t('拒绝') : row.toolStatus || t('成功')}
        </span>
        {row.durationMs !== null && row.durationMs > 0 && <span>{formatDuration(row.durationMs)}</span>}
      </div>
      {row.toolArgs && (
        <div className="tjs-block">
          <div className="tjs-block-label">{t('参数')}</div>
          <pre className="tjs-pre"><Highlighted text={row.toolArgs} query={query} /></pre>
        </div>
      )}
      {row.text && (
        <div className="tjs-block">
          <div className="tjs-block-label">{t('结果')}</div>
          <pre className="tjs-pre">{(showOutput || !truncated)
            ? <Highlighted text={row.text} query={query} />
            : `${row.text.slice(0, 4000)}\n…`}</pre>
          {truncated && (
            <button className="tjs-toggle" onClick={() => setShowOutput(v => !v)}>
              {showOutput ? t('收起') : t('展开全部')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * 会话的轨迹视图（聊天页 "对话 / 轨迹" 分页中的轨迹页）：
 * 运行选择 + 状态/汇总工具条 + 时间线 Overview + 请求编号条 + 轮次分组的可展开流水账 + 搜索高亮。
 */
export default function TrajectoryView({ sessionId }: { sessionId: string }) {
  const t = useI18n()
  const [searchParams, setSearchParams] = useSearchParams()
  const [runs, setRuns] = useState<RunRow[]>([])
  const [runId, setRunId] = useState<string | null>(null)
  const [data, setData] = useState<TrajectoryData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [timelineMode, setTimelineMode] = useState<TrajectoryTimelineMode>('sequence')
  const [timelineRange, setTimelineRange] = useState<{ start: number; end: number } | null>(null)
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [collapsedTurns, setCollapsedTurns] = useState<ReadonlySet<number>>(new Set())
  const [collapsedRequests, setCollapsedRequests] = useState<ReadonlySet<number>>(new Set())

  // 会话切换时重置，再加载运行列表（最多 20 条）；优先恢复 URL 里的 ?run=。
  useEffect(() => {
    let cancelled = false
    setRuns([])
    setRunId(null)
    setData(null)
    setError(null)
    setTimelineRange(null)
    setSelectedIndex(null)
    if (!sessionId) return
    fetchRecentRuns(sessionId, 20)
      .then(list => {
        if (cancelled) return
        setRuns(list)
        const requested = searchParams.get('run')
        setRunId(list.find(r => r.id === requested)?.id ?? list[0]?.id ?? null)
      })
      .catch(() => { if (!cancelled) setError(t('加载运行列表失败')) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, t])

  // 选中运行：写入 URL，刷新/深链可恢复。
  const selectRun = (id: string) => {
    setRunId(id)
    setSearchParams({ run: id }, { replace: true })
  }

  // 选中运行的轨迹数据
  useEffect(() => {
    if (!runId) {
      setData(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchRunTrajectory(runId)
      .then(result => { if (!cancelled) setData(result) })
      .catch(() => { if (!cancelled) setError(t('加载轨迹失败')) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [runId, t])

  const model = useMemo<TrajectoryModel | null>(
    () => (data ? buildTrajectory(data) : null),
    [data],
  )
  const filtered = useMemo(
    () => (model ? filterTrajectory(model, query) : null),
    [model, query],
  )
  const summary = useMemo(() => (model ? summarizeTrajectory(model) : null), [model])

  const headerChips = summary ? [
    summary.turns > 0 ? `${summary.turns} ${t('助手调用')}` : '',
    summary.tools > 0 ? `${summary.tools} ${t('工具调用')}` : '',
    summary.llmMs > 0 ? `LLM ${formatDuration(summary.llmMs)}` : '',
    summary.toolMs > 0 ? `${t('工具时间')} ${formatDuration(summary.toolMs)}` : '',
    summary.ttftAvgMs !== null ? `${t('首 token 平均')} ${formatDuration(summary.ttftAvgMs)}` : '',
    summary.decodeMs > 0 && summary.outputTokens > 0
      ? `${(summary.outputTokens / (summary.decodeMs / 1000)).toFixed(1)} tok/s`
      : '',
  ].filter(Boolean) : []

  const visibleRows = filtered?.rows ?? []

  const toggleTurn = (turn: number | null) => {
    if (turn === null) return
    setCollapsedTurns(current => {
      const next = new Set(current)
      if (next.has(turn)) next.delete(turn)
      else next.add(turn)
      return next
    })
  }
  const toggleRequest = (number: number) => {
    setCollapsedRequests(current => {
      const next = new Set(current)
      if (next.has(number)) next.delete(number)
      else next.add(number)
      return next
    })
  }

  return (
    <div className="tjs-view">
      <div className="tjs-toolbar">
        <select
          className="tjs-run-select"
          value={runId ?? ''}
          onChange={e => selectRun(e.target.value)}
          disabled={runs.length === 0}
          title={t('选择运行')}
        >
          {runs.length === 0 && <option value="">{t('无运行记录')}</option>}
          {runs.map(run => (
            <option key={run.id} value={run.id}>
              {run.id}
            </option>
          ))}
        </select>
        {data && (
          <span className={`tjs-status ${runStatusClass(data.run.status)}`}>
            {STATUS_LABEL[data.run.status] ?? data.run.status}
          </span>
        )}
        {data && data.run.started_at && data.run.finished_at && (
          <span>{formatDuration(Math.max(0, data.run.finished_at - data.run.started_at))}</span>
        )}
        {model && model.retries > 0 && <span>{t('重试')} ×{model.retries}</span>}
        {headerChips.map(chip => <span key={chip}>{chip}</span>)}
        {data?.run.error && <span className="tjs-error">{data.run.error}</span>}
        <button
          className="tjs-timeline-mode"
          onClick={() => setTimelineMode(mode => mode === 'sequence' ? 'duration' : 'sequence')}
          title={timelineMode === 'sequence' ? t('按耗时显示') : t('按顺序显示')}
        >
          {timelineMode === 'sequence' ? '≡ 顺序' : '⏱ 耗时'}
        </button>
        <input
          className="tjs-search"
          placeholder={t('搜索轨迹')}
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
      </div>

      {loading && <div className="tjs-empty">{t('加载中…')}</div>}
      {error && <div className="tjs-empty tjs-error">{error}</div>}
      {!loading && !error && filtered && filtered.rows.length === 0 && (
        <div className="tjs-empty">{t('无轨迹数据')}</div>
      )}

      {filtered && filtered.rows.length > 0 && (
        <>
          <TimelineBar
            rows={visibleRows}
            mode={timelineMode}
            range={timelineRange}
            onRangeChange={setTimelineRange}
            onRecordSelect={index => setSelectedIndex(index)}
            selectedIndex={selectedIndex}
          />
          <div className="tjs-requests">
            {filtered.requests.map(req => (
              <button
                key={req.number}
                className={`tjs-request ${selectedIndex === req.rowIndex ? 'active' : ''} ${req.isError ? 'error' : ''}`}
                onClick={() => setSelectedIndex(req.rowIndex)}
                title={`#${req.number} · ${req.inputTokens ?? '—'}→${req.outputTokens ?? '—'} tok · 累计 ${req.cumulativeInput}→${req.cumulativeOutput}`}
              >
                <span className="tjs-request-no">#{req.number}</span>
                {req.llmMs !== null && <span>{formatDuration(req.llmMs)}</span>}
                {req.inputTokens !== null && (
                  <span>{formatTokens(req.inputTokens)}→{formatTokens(req.outputTokens ?? 0)}</span>
                )}
                {req.cumulativeInput > 0 && (
                  <span className="tjs-request-cum">∑{formatTokens(req.cumulativeInput)}→{formatTokens(req.cumulativeOutput)}</span>
                )}
              </button>
            ))}
          </div>
          <div className="tjs-ledger">
            {filtered.turns.map(turn => (
              <TrajectoryTurnView
                key={turn.turn ?? 'orphan'}
                turn={turn}
                query={query}
                collapsed={turn.turn !== null && collapsedTurns.has(turn.turn)}
                collapsedRequests={collapsedRequests}
                onToggleTurn={() => toggleTurn(turn.turn)}
                onToggleRequest={toggleRequest}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function TrajectoryTurnView({
  turn, query, collapsed, collapsedRequests, onToggleTurn, onToggleRequest,
}: {
  turn: TrajectoryModel['turns'][number]
  query: string
  collapsed: boolean
  collapsedRequests: ReadonlySet<number>
  onToggleTurn: () => void
  onToggleRequest: (number: number) => void
}) {
  const t = useI18n()
  const totalRows = turn.groups.reduce((sum, g) => sum + g.rows.length, 0)
  return (
    <div className={`tjs-turn ${collapsed ? 'collapsed' : ''}`}>
      <button className="tjs-turn-head" onClick={onToggleTurn} title={collapsed ? t('展开本轮') : t('折叠本轮')}>
        <span className="tjs-chevron">{collapsed ? '▸' : '▾'}</span>
        <span className="tjs-turn-label">
          {turn.turn !== null ? `${t('轮次')} ${turn.turn}` : t('未归属轮次')}
        </span>
        <span className="tjs-turn-count">{totalRows} 条记录</span>
      </button>
      {!collapsed && turn.groups.map((group, gi) => (
        <div key={gi} className={`tjs-group tjs-group-${group.kind}`}>
          {group.kind === 'step' && group.step !== null && (
            <div className="tjs-group-head">
              <span className="tjs-group-label">{t('步骤')} {group.step}</span>
            </div>
          )}
          {group.rows.map((row, ri) => {
            const requestCollapsed = row.requestNumber !== null && collapsedRequests.has(row.requestNumber)
            return (
              <TrajectoryRowView
                key={row.messageId}
                row={row}
                query={query}
                collapsed={requestCollapsed}
                onToggleRequest={row.requestNumber !== null
                  ? () => onToggleRequest(row.requestNumber!)
                  : undefined}
              />
            )
          })}
        </div>
      ))}
    </div>
  )
}

function TrajectoryRowView({
  row, query, collapsed, onToggleRequest,
}: {
  row: TrajectoryRow
  query: string
  collapsed: boolean
  onToggleRequest?: () => void
}) {
  const t = useI18n()
  const [expanded, setExpanded] = useState(false)
  const expandable = row.kind === 'assistant' || row.kind === 'tool'
  // 折叠助手请求时：整组（助手 + 其工具）折叠成一行摘要
  const headerAction = () => {
    if (onToggleRequest) onToggleRequest()
    else if (expandable) setExpanded(v => !v)
  }
  const chevron = onToggleRequest
    ? (collapsed ? '▸' : '▾')
    : expandable ? (expanded ? '▾' : '▸') : '·'
  const showBody = !collapsed && (row.kind === 'user' || expanded)
  return (
    <div className={`tjs-row tjs-row-${row.kind} ${row.isError ? 'is-error' : ''} ${collapsed ? 'collapsed' : ''}`}>
      <button
        className="tjs-row-head"
        onClick={headerAction}
        style={{ cursor: (onToggleRequest || expandable) ? 'pointer' : 'default' }}
      >
        <span className="tjs-chevron">{chevron}</span>
        <span className={`tjs-kind tjs-kind-${row.kind}`}>
          {row.kind === 'user' ? t('用户') : row.kind === 'assistant' ? t('助手') : t('工具')}
        </span>
        <RowHeader row={row} query={query} />
        <span className="tjs-time">{hhmmss(row.createdAt)}</span>
      </button>
      {showBody && (
        <div className="tjs-body">
          {row.kind === 'user' && <pre className="tjs-pre tjs-user-text"><Highlighted text={row.text} query={query} /></pre>}
          {row.kind === 'assistant' && <AssistantBody row={row} query={query} />}
          {row.kind === 'tool' && <ToolBody row={row} query={query} />}
        </div>
      )}
    </div>
  )
}
