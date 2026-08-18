import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { fetchRecentRuns, fetchRunTrajectory, type RunRow } from '@/api/runs'
import type { TrajectoryData } from '@/types'
import {
  buildTrajectory,
  filterTrajectory,
  summarizeTrajectory,
  type TrajectoryModel,
  type TrajectoryRow,
} from '@/features/trajectory/trajectory'
import {
  buildTrajectoryLayout,
  type TrajectoryGroup,
  type TrajectoryTurn,
} from '@/features/trajectory/trajectory-layout'
import {
  deriveTrajectoryTimeline,
  type TrajectoryTimelineMode,
} from '@/features/trajectory/timeline'
import TimelineBar from '@/features/trajectory/TimelineBar'
import DebugTrajectoryView from '@/features/trajectory/DebugTrajectoryView'
import Highlighted from '@/features/trajectory/highlight'
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

function RowHeader({ row, query }: { row: TrajectoryRow; query: string }) {
  const t = useI18n()
  if (row.kind === 'user') {
    return <span className="tjs-row-title"><Highlighted text={t('用户')} query={query} /></span>
  }
  if (row.kind === 'assistant') {
    const bits: string[] = []
    if (row.step !== null) bits.push(`#${row.step}`)
    bits.push(t('助手'))
    if (row.llmMs !== null && row.llmMs > 0) bits.push(formatDuration(row.llmMs))
    return <span className="tjs-row-title">{bits.join(' · ')}</span>
  }
  const bits: string[] = []
  if (row.step !== null) bits.push(`#${row.step}`)
  bits.push(t('工具'))
  if (row.toolName) bits.push(row.toolName)
  if (row.durationMs !== null && row.durationMs > 0) bits.push(formatDuration(row.durationMs))
  return <span className="tjs-row-title"><Highlighted text={bits.join(' · ')} query={query} /></span>
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
          {showReasoning && <pre className="tjs-pre tjs-reasoning-body"><Highlighted text={row.reasoning} query={query} /></pre>}
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
          <pre className="tjs-pre">{
            (showOutput || !truncated)
              ? <Highlighted text={row.text} query={query} />
              : <Highlighted text={`${row.text.slice(0, 4000)}\n…`} query={query} />
          }</pre>
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

function TrajectoryRowView({ row, query, dimmed }: { row: TrajectoryRow; query: string; dimmed: boolean }) {
  const t = useI18n()
  const [expanded, setExpanded] = useState(false)
  const expandable = row.kind === 'assistant' || row.kind === 'tool'
  return (
    <div className={`tjs-row tjs-row-${row.kind} ${row.isError ? 'is-error' : ''} ${dimmed ? 'dimmed' : ''}`}>
      <button
        className="tjs-row-head"
        onClick={() => { if (expandable) setExpanded(v => !v) }}
        style={{ cursor: expandable ? 'pointer' : 'default' }}
      >
        <span className="tjs-chevron">{expandable ? (expanded ? '▾' : '▸') : '·'}</span>
        <span className={`tjs-kind tjs-kind-${row.kind}`}>
          {row.kind === 'user' ? t('用户') : row.kind === 'assistant' ? t('助手') : t('工具')}
        </span>
        <RowHeader row={row} query={query} />
        <span className="tjs-time">{hhmmss(row.createdAt)}</span>
      </button>
      {row.kind === 'user' && <div className="tjs-body"><pre className="tjs-pre tjs-user-text"><Highlighted text={row.text} query={query} /></pre></div>}
      {(row.kind === 'assistant' || row.kind === 'tool') && expanded && (
        <div className="tjs-body">
          {row.kind === 'assistant' ? <AssistantBody row={row} query={query} /> : <ToolBody row={row} query={query} />}
        </div>
      )}
    </div>
  )
}

function TurnHeader({ turn, collapsed, onToggle }: { turn: TrajectoryTurn; collapsed: boolean; onToggle: () => void }) {
  const t = useI18n()
  const rowCount = turn.groups.reduce((sum, g) => sum + g.rows.length, 0)
  return (
    <div className="tjs-turn">
      <button className="tjs-turn-head" onClick={onToggle}>
        <span className="tjs-chevron">{collapsed ? '▸' : '▾'}</span>
        <span className="tjs-kind tjs-kind-turn">{t('轮次')} {turn.turn}</span>
        <span className="tjs-row-title">
          {turn.groups.length} {t('组')} · {rowCount} {t('条记录')}
        </span>
        <span className="tjs-time">{hhmmss(turn.startedAt)}</span>
      </button>
    </div>
  )
}

function groupKey(turn: TrajectoryTurn, group: TrajectoryGroup): string {
  return `${turn.turn}:${group.kind}:${group.step ?? 'm'}`
}

function GroupHeader({ group, collapsed, onToggle, query }: {
  group: TrajectoryGroup
  collapsed: boolean
  onToggle: () => void
  query: string
}) {
  const t = useI18n()
  const stepBits: string[] = []
  if (group.kind === 'step') {
    if (group.step !== null) stepBits.push(`#${group.step}`)
    stepBits.push(t('Step'))
  } else {
    stepBits.push(t('消息'))
  }
  return (
    <button className="tjs-group-head" onClick={onToggle}>
      <span className="tjs-chevron">{collapsed ? '▸' : '▾'}</span>
      <span className={`tjs-kind ${group.kind === 'step' ? 'tjs-kind-step' : 'tjs-kind-message'}`}>
        {stepBits.join(' ')}
      </span>
      {group.kind === 'step' && (group.cumulativeInput > 0 || group.cumulativeOutput > 0) && (
        <span className="tjs-group-usage">
          {t('累计')} {formatTokens(group.cumulativeInput)} → {formatTokens(group.cumulativeOutput)}
        </span>
      )}
      <span className="tjs-row-title">
        {group.rows.length} {t('条记录')}
      </span>
    </button>
  )
}

/**
 * 会话的轨迹视图（聊天页 "对话 / 轨迹" 分页中的轨迹页）：
 * 运行选择 + 状态/汇总工具条 + 顶部时间线（序列/时长 + 拖选联动）+ 轮次/Step 分组折叠账本 + 搜索高亮。
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
  const [mode, setMode] = useState<TrajectoryTimelineMode>('sequence')
  const [focus, setFocus] = useState<ReadonlySet<number> | null>(null)
  const [collapsedTurns, setCollapsedTurns] = useState<ReadonlySet<number>>(new Set())
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(new Set())
  const [subView, setSubView] = useState<'runs' | 'debug'>('runs')

  // 会话切换时重置，再加载运行列表（最多 20 条）；优先恢复 URL 里的 ?run=。
  useEffect(() => {
    let cancelled = false
    setRuns([])
    setRunId(null)
    setData(null)
    setError(null)
    setFocus(null)
    setCollapsedTurns(new Set())
    setCollapsedGroups(new Set())
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
  const layout = useMemo(() => (filtered ? buildTrajectoryLayout(filtered) : null), [filtered])
  const timeline = useMemo(
    () => (filtered ? deriveTrajectoryTimeline(filtered, mode) : null),
    [filtered, mode],
  )
  // 时间线 span.index 与 filtered.rows 下标对齐：记录 messageId → 下标用于焦点 dimming。
  const rowIndexById = useMemo(() => {
    const map = new Map<number, number>()
    filtered?.rows.forEach((row, i) => map.set(row.messageId, i))
    return map
  }, [filtered])

  const toggleTurn = (turnNo: number) => {
    setCollapsedTurns(prev => {
      const next = new Set(prev)
      if (next.has(turnNo)) next.delete(turnNo)
      else next.add(turnNo)
      return next
    })
  }
  const toggleGroup = (key: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  const collapseAll = () => {
    if (!layout) return
    setCollapsedTurns(new Set(layout.turns.map(turn => turn.turn)))
    const groupKeys = new Set<string>()
    for (const turn of layout.turns) {
      for (const group of turn.groups) groupKeys.add(groupKey(turn, group))
    }
    setCollapsedGroups(groupKeys)
  }
  const expandAll = () => {
    setCollapsedTurns(new Set())
    setCollapsedGroups(new Set())
  }

  const headerChips = summary ? [
    summary.turns > 0 ? `${summary.turns} ${t('助手调用')}` : '',
    summary.tools > 0 ? `${summary.tools} ${t('工具调用')}` : '',
    layout && layout.requestCount > 0 ? `${layout.requestCount} ${t('请求')}` : '',
    layout && (layout.totalInput > 0 || layout.totalOutput > 0)
      ? `${t('累计')} ${formatTokens(layout.totalInput)} → ${formatTokens(layout.totalOutput)}`
      : '',
    summary.llmMs > 0 ? `LLM ${formatDuration(summary.llmMs)}` : '',
    summary.toolMs > 0 ? `${t('工具时间')} ${formatDuration(summary.toolMs)}` : '',
    summary.ttftAvgMs !== null ? `${t('首 token 平均')} ${formatDuration(summary.ttftAvgMs)}` : '',
    summary.decodeMs > 0 && summary.outputTokens > 0
      ? `${(summary.outputTokens / (summary.decodeMs / 1000)).toFixed(1)} tok/s`
      : '',
  ].filter(Boolean) : []

  return (
    <div className="tjs-view">
      <div className="tjs-toolbar">
        <div className="tjs-view-toggle" role="tablist" aria-label={t('轨迹视图')}>
          <button
            type="button"
            role="tab"
            aria-selected={subView === 'runs'}
            className={`tjs-view-toggle-btn ${subView === 'runs' ? 'active' : ''}`}
            onClick={() => setSubView('runs')}
          >{t('运行轨迹')}</button>
          <button
            type="button"
            role="tab"
            aria-selected={subView === 'debug'}
            className={`tjs-view-toggle-btn ${subView === 'debug' ? 'active' : ''}`}
            onClick={() => setSubView('debug')}
          >{t('调试详情')}</button>
        </div>
        {subView === 'runs' && (<>
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
        {filtered && filtered.rows.length > 1 && (
          <>
            <button className="tjs-toggle tjs-toolbar-btn" onClick={collapseAll}>{t('折叠全部')}</button>
            <button className="tjs-toggle tjs-toolbar-btn" onClick={expandAll}>{t('展开全部')}</button>
          </>
        )}
        <input
          className="tjs-search"
          placeholder={t('搜索轨迹')}
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        </>)}
      </div>

      {subView === 'debug' && <DebugTrajectoryView />}

      {subView === 'runs' && (<>
      {filtered && filtered.rows.length > 0 && (
        <TimelineBar
          model={filtered}
          timeline={timeline}
          mode={mode}
          onModeChange={setMode}
          focus={focus}
          onFocusChange={setFocus}
        />
      )}

      {loading && <div className="tjs-empty">{t('加载中…')}</div>}
      {error && <div className="tjs-empty tjs-error">{error}</div>}
      {!loading && !error && filtered && filtered.rows.length === 0 && (
        <div className="tjs-empty">{t('无轨迹数据')}</div>
      )}

      {layout && (
        <div className="tjs-ledger">
          {layout.turns.map(turn => {
            const turnCollapsed = collapsedTurns.has(turn.turn)
            return (
              <div key={`turn-${turn.turn}`} className="tjs-turn-block">
                <TurnHeader turn={turn} collapsed={turnCollapsed} onToggle={() => toggleTurn(turn.turn)} />
                {!turnCollapsed && turn.groups.map(group => {
                  const key = groupKey(turn, group)
                  const groupCollapsed = collapsedGroups.has(key)
                  return (
                    <div key={key} className={`tjs-group ${group.kind === 'step' ? 'tjs-group-step' : 'tjs-group-message'}`}>
                      <GroupHeader
                        group={group}
                        collapsed={groupCollapsed}
                        onToggle={() => toggleGroup(key)}
                        query={query}
                      />
                      {!groupCollapsed && group.rows.map(row => (
                        <TrajectoryRowView
                          key={row.messageId}
                          row={row}
                          query={query}
                          dimmed={focus !== null && !focus.has(rowIndexById.get(row.messageId) ?? -1)}
                        />
                      ))}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      )}
      </>)}
    </div>
  )
}
