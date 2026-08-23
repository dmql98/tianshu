import { useEffect, useMemo, useState } from 'react'
import { fetchSessionTrajectory, type SessionTrajectoryData } from '@/api/sessions'
import { getEventBus } from '@/api/eventBus'
import { useChatStore } from '@/stores/chatStore'
import {
  buildTrajectory,
  filterTrajectory,
  summarizeTrajectory,
  toolDescriptionOf,
  toolNameOf,
  toolNames,
  type TrajectoryLifecycleItem,
  type TrajectoryModel,
  type TrajectoryRow,
  type TrajectoryRunMeta,
  type TrajectorySystemRow,
} from '@/features/trajectory/trajectory'
import { formatDuration, formatTokens } from '@/features/chat/runStats'
import { useI18n } from '@/i18n'

/** 实时重拉的节流窗口：合并同一窗口内的多次事件，避免工具密集 loop 时频繁整拉。 */
const TRAJECTORY_REFRESH_THROTTLE_MS = 400

/**
 * 会影响轨迹视图重建的 durable 事件。刻意排除 message.delta / tool.output：
 * 它们是高频流式事件，只改 chat 侧流式文本，而轨迹内容来自 messages 表的最终态，
 * 系统提示注入来自 llm_calls 快照，二者都不依赖这两个事件，重拉无需被它们驱动。
 */
const TRAJECTORY_REFRESH_EVENTS = [
  'run.queued', 'run.started', 'run.retrying', 'run.completed', 'run.failed',
  'run.cancelled', 'run.interrupted', 'run.max_turns', 'run.budget_exhausted',
  'run.limit_warning', 'run.grace_started', 'run.continuation_queued', 'run.compacted',
  'message.created', 'message.metrics', 'tool.started', 'tool.completed',
  'approval.requested', 'ask_user', 'usage', 'sub_agent.started',
] as const

const STATUS_LABEL: Record<string, string> = {
  queued: '排队中', preparing: '准备中', running: '运行中', cancelling: '取消中',
  awaiting_approval: '等待审批', awaiting_input: '等待输入', paused: '已暂停',
  completed: '已完成', failed: '失败', cancelled: '已取消',
  max_turns: '轮数上限', budget_exhausted: '预算耗尽', interrupted: '已中断',
}

/** 生命周期事件的中文标签（渲染在事件条上）。 */
const LIFECYCLE_LABEL: Record<string, string> = {
  'run.queued': '入队', 'run.started': '开始', 'run.retrying': '重试',
  'run.completed': '完成', 'run.failed': '失败', 'run.cancelled': '取消',
  'run.interrupted': '中断', 'run.max_turns': '轮数上限',
  'run.budget_exhausted': '预算耗尽', 'run.limit_warning': '软上限提醒',
  'run.grace_started': '宽限开始', 'run.continuation_queued': '自动续跑入队',
  'approval.requested': '等待审批', 'ask_user': '询问用户',
}

const LIFECYCLE_CLASS: Record<string, string> = {
  'run.completed': 'ok',
  'run.failed': 'error',
  'run.cancelled': 'error',
  'run.interrupted': 'error',
  'run.max_turns': 'error',
  'run.budget_exhausted': 'error',
  'approval.requested': 'warn',
  'ask_user': 'warn',
}

/** 右侧详情窗口的选中对象：内容行 或 系统提示注入记录。 */
export type TrajectorySelection =
  | { kind: 'row'; key: string; row: TrajectoryRow }
  | { kind: 'system'; key: string; row: TrajectorySystemRow }

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

function RowHeader({ row }: { row: TrajectoryRow }) {
  const t = useI18n()
  if (row.kind === 'user') {
    return <span className="tjs-row-title">{t('用户')}</span>
  }
  if (row.kind === 'assistant') {
    const bits: string[] = []
    if (row.step !== null) bits.push(`${row.step}`)
    bits.push(t('助手'))
    if (row.llmMs !== null && row.llmMs > 0) bits.push(formatDuration(row.llmMs))
    return <span className="tjs-row-title">{bits.join(' · ')}</span>
  }
  const bits: string[] = []
  if (row.step !== null) bits.push(`${row.step}`)
  bits.push(t('工具'))
  if (row.toolName) bits.push(row.toolName)
  if (row.durationMs !== null && row.durationMs > 0) bits.push(formatDuration(row.durationMs))
  return <span className="tjs-row-title">{bits.join(' · ')}</span>
}

/**
 * 会话的轨迹视图（聊天页 "对话 / 轨迹" 分页中的轨迹页）：
 * 哪个会话就是哪个会话的轨迹 —— 无 run 选择器，直接按会话加载并渲染完整时间线：
 * run 边界分隔条 + 生命周期事件条 + 系统提示注入记录 + 内容行；
 * 选中记录后在右侧打开详情窗口（分页 tabs，DSH 风格）。
 */
export default function TrajectoryView({ sessionId }: { sessionId: string }) {
  const t = useI18n()
  const [data, setData] = useState<SessionTrajectoryData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [compactExpanded, setCompactExpanded] = useState(false)
  const compactionSummary = useChatStore(s => s.sessions.find(x => x.id === sessionId)?.compaction_summary ?? null)
  const [selection, setSelection] = useState<TrajectorySelection | null>(null)

  // 会话切换时重置，再按会话加载整条轨迹。
  useEffect(() => {
    let cancelled = false
    let refetchTimer: ReturnType<typeof setTimeout> | null = null
    setData(null)
    setError(null)
    setSelection(null)
    if (!sessionId) return
    setLoading(true)
    fetchSessionTrajectory(sessionId)
      .then(result => { if (!cancelled) setData(result) })
      .catch(() => { if (!cancelled) setError(t('加载轨迹失败')) })
      .finally(() => { if (!cancelled) setLoading(false) })

    // 实时刷新：订阅本会话的轨迹相关事件，节流后重新拉取整条轨迹。
    // 只在本会话的事件上触发；重拉失败静默处理（初始快照仍有效，不闪烁报错）。
    const bus = getEventBus()
    const scheduleRefetch = (): void => {
      if (refetchTimer) return
      refetchTimer = setTimeout(() => {
        refetchTimer = null
        fetchSessionTrajectory(sessionId)
          .then(result => { if (!cancelled) setData(result) })
          .catch(() => { /* 实时重拉失败：保留当前快照 */ })
      }, TRAJECTORY_REFRESH_THROTTLE_MS)
    }
    const listeners = TRAJECTORY_REFRESH_EVENTS.map(type => {
      const cb = (data: unknown): void => {
        const ev = data as { session_id?: string | number } | null
        const evSession = ev?.session_id
        if (evSession === undefined || String(evSession) !== sessionId) return
        scheduleRefetch()
      }
      bus.on(type, cb)
      return [type, cb] as const
    })

    return () => {
      cancelled = true
      if (refetchTimer) { clearTimeout(refetchTimer); refetchTimer = null }
      for (const [type, cb] of listeners) bus.off(type, cb)
    }
  }, [sessionId, t])

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

  return (
    <div className="tjs-view">
      <div className="tjs-toolbar">
        {data && (
          <span className="tjs-session-title" title={data.session.id}>
            {data.session.title || t('会话轨迹')}
          </span>
        )}
        {model && model.runs.length > 0 && (
          <span className="tjs-runs-count">{t('运行')} ×{model.runs.length}</span>
        )}
        {model && model.retries > 0 && <span>{t('重试')} ×{model.retries}</span>}
        {headerChips.map(chip => <span key={chip}>{chip}</span>)}
        <input
          className="tjs-search"
          placeholder={t('搜索轨迹')}
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
      </div>

      {compactionSummary && (
        <div className={`tjs-compact-bar${compactExpanded ? ' expanded' : ''}`}>
          <button
            type="button"
            className="tjs-compact-bar-head"
            onClick={() => setCompactExpanded(v => !v)}
            aria-expanded={compactExpanded}
          >
            <span className="tjs-compact-bar-icon">⚠</span>
            <span>{t('会话已压缩')}</span>
            <span className="tjs-compact-bar-caret">{compactExpanded ? '▾' : '▸'}</span>
          </button>
          {compactExpanded && <p className="tjs-compact-bar-summary">{compactionSummary}</p>}
        </div>
      )}

      {loading && <div className="tjs-empty">{t('加载中…')}</div>}
      {error && <div className="tjs-empty tjs-error">{error}</div>}
      {!loading && !error && filtered
        && filtered.rows.length === 0 && filtered.systemRows.length === 0 && (
          <div className="tjs-empty">{t('无轨迹数据')}</div>
        )}

      {!loading && !error && filtered && (filtered.rows.length > 0 || filtered.systemRows.length > 0) && (
        <div className="tjs-body-row">
          <div className="tjs-ledger">
            <MergedTimeline
              model={filtered}
              selection={selection}
              onSelect={setSelection}
            />
          </div>
          {selection && (
            <DetailsPanel
              selection={selection}
              onClose={() => setSelection(null)}
            />
          )}
        </div>
      )}
    </div>
  )
}

/**
 * 合并时间线：run 边界分隔条 + 生命周期事件条 + 系统提示注入记录 + 内容行，
 * 全部按真实时间顺序交错（时间戳相同则行优先，保证 run.started 显示在第一条内容之前）。
 */
function MergedTimeline({
  model,
  selection,
  onSelect,
}: {
  model: TrajectoryModel
  selection: TrajectorySelection | null
  onSelect: (s: TrajectorySelection) => void
}) {
  const rowItems = model.rows.map(row => ({
    key: `row-${row.messageId}`,
    kind: 'row' as const,
    ref: row,
    time: row.createdAt,
  }))
  const allSystemItems = model.systemRows.map((row, i) => ({
    key: `sys-${row.callTurn}-${i}`,
    kind: 'system' as const,
    ref: row,
    time: row.createdAt,
  }))
  // 初始系统提示（会话开头注入）始终钉在时间线最顶端——它在构造上最先被注入，
  // 不应被按 createdAt 的归并排序推到用户消息 / 生命周期事件之后（llm_calls.created_at
  // 记录的是调用返回时刻，天然晚于首条消息与 run.started，见 llm-call-store.ts）。
  // 之后的 system / tools 变化(update)仍按真实时间参与三路归并。
  const initialSystemItems = allSystemItems.filter(
    it => (it.ref as TrajectorySystemRow).kind === 'initial',
  )
  const updateSystemItems = allSystemItems.filter(
    it => (it.ref as TrajectorySystemRow).kind === 'update',
  )
  const lifecycleItems = model.lifecycle.map((item, i) => ({
    key: `lc-${i}-${item.type}-${item.createdAt}`,
    kind: 'lifecycle' as const,
    ref: item,
    time: item.createdAt,
  }))

  // 三路归并：row / update-system / lifecycle 按 createdAt 交错。
  const merged: Array<{
    key: string
    kind: 'lifecycle' | 'row' | 'system'
    ref: TrajectoryLifecycleItem | TrajectoryRow | TrajectorySystemRow
  }> = []
  let r = 0
  let s = 0
  let l = 0
  while (r < rowItems.length || s < updateSystemItems.length || l < lifecycleItems.length) {
    const row = rowItems[r]
    const sys = updateSystemItems[s]
    const lc = lifecycleItems[l]
    const pick = (a: { time: number } | undefined, b: { time: number } | undefined): boolean =>
      a !== undefined && (b === undefined || a.time <= b.time)
    if (row && pick(row, sys) && pick(row, lc)) {
      merged.push({ key: row.key, kind: 'row', ref: row.ref })
      r++
    } else if (sys && pick(sys, lc)) {
      merged.push({ key: sys.key, kind: 'system', ref: sys.ref })
      s++
    } else if (lc) {
      merged.push({ key: lc.key, kind: 'lifecycle', ref: lc.ref })
      l++
    } else break
  }

  // run 边界：内容行跨 run 时插入分隔条（首个 run 不插，会话级轨迹无需开头分隔）。
  const seenRuns = new Set<string>()
  const items: Array<{
    key: string
    kind: 'lifecycle' | 'row' | 'system' | 'run'
    ref: TrajectoryLifecycleItem | TrajectoryRow | TrajectorySystemRow | TrajectoryRunMeta
  }> = []
  // 初始系统提示钉顶：在任何内容行 / 生命周期事件 / run 分隔条之前。
  for (const it of initialSystemItems) items.push(it)
  for (const it of merged) {
    if (it.kind === 'row') {
      const runId = (it.ref as TrajectoryRow).runId
      if (runId && !seenRuns.has(runId)) {
        seenRuns.add(runId)
        const runIndex = model.runs.findIndex(run => run.id === runId)
        if (runIndex > 0) {
          items.push({ key: `run-${runId}`, kind: 'run', ref: model.runs[runIndex] })
        }
      }
    }
    items.push(it)
  }

  return (
    <div className="tjs-timeline">
      {items.map(it => {
        if (it.kind === 'run') {
          return <RunBoundaryBar key={it.key} run={it.ref as TrajectoryRunMeta} />
        }
        if (it.kind === 'lifecycle') {
          return <LifecycleBar key={it.key} item={it.ref as TrajectoryLifecycleItem} />
        }
        if (it.kind === 'system') {
          const row = it.ref as TrajectorySystemRow
          const key = it.key
          const selected = selection?.kind === 'system' && selection.key === key
          return (
            <SystemRowView
              key={key}
              row={row}
              selected={selected}
              onSelect={() => onSelect({ kind: 'system', key, row })}
            />
          )
        }
        const row = it.ref as TrajectoryRow
        const key = it.key
        const selected = selection?.kind === 'row' && selection.key === key
        return (
          <TrajectoryRowView
            key={key}
            row={row}
            selected={selected}
            onSelect={() => onSelect({ kind: 'row', key, row })}
          />
        )
      })}
    </div>
  )
}

function RunBoundaryBar({ run }: { run: TrajectoryRunMeta }) {
  return (
    <div className="tjs-run-boundary">
      <span className={`tjs-status ${runStatusClass(run.status)}`}>
        {STATUS_LABEL[run.status] ?? run.status}
      </span>
      <span className="tjs-run-boundary-id">{run.id}</span>
      {run.startedAt && run.finishedAt && (
        <span>{formatDuration(Math.max(0, run.finishedAt - run.startedAt))}</span>
      )}
    </div>
  )
}

function LifecycleBar({ item }: { item: TrajectoryLifecycleItem }) {
  const label = LIFECYCLE_LABEL[item.type] ?? item.type
  const cls = LIFECYCLE_CLASS[item.type] ?? ''
  return (
    <div className="tjs-lifecycle">
      <span className={`tjs-status ${cls}`}>{label}</span>
      {item.runId && <span className="tjs-lifecycle-run">{item.runId}</span>}
      {item.detail && <span className="tjs-lifecycle-detail">{item.detail}</span>}
      <span className="tjs-time">{hhmmss(item.createdAt)}</span>
    </div>
  )
}

/** 系统提示注入记录行（DSH 的 system / system-update）。 */
function SystemRowView({
  row,
  selected,
  onSelect,
}: {
  row: TrajectorySystemRow
  selected: boolean
  onSelect: () => void
}) {
  const t = useI18n()
  return (
    <div className={`tjs-row tjs-row-system ${selected ? 'selected' : ''}`}>
      <button className="tjs-row-head" onClick={onSelect}>
        <span className="tjs-chevron">·</span>
        <span className="tjs-kind tjs-kind-system">
          {row.kind === 'initial' ? t('系统提示') : t('系统提示更新')}
        </span>
        <span className="tjs-row-title">
          {row.system.slice(0, 80) || (t('（无系统提示）'))}
        </span>
        <span className="tjs-time">{hhmmss(row.createdAt)}</span>
      </button>
    </div>
  )
}

function TrajectoryRowView({
  row,
  selected,
  onSelect,
}: {
  row: TrajectoryRow
  selected: boolean
  onSelect: () => void
}) {
  const t = useI18n()
  return (
    <div className={`tjs-row tjs-row-${row.kind} ${row.isError ? 'is-error' : ''} ${selected ? 'selected' : ''}`}>
      <button className="tjs-row-head" onClick={onSelect}>
        <span className="tjs-chevron">·</span>
        <span className={`tjs-kind tjs-kind-${row.kind}`}>
          {row.kind === 'user' ? t('用户') : row.kind === 'assistant' ? t('助手') : t('工具')}
        </span>
        <RowHeader row={row} />
        <span className="tjs-time">{hhmmss(row.createdAt)}</span>
      </button>
    </div>
  )
}

// ── 右侧详情窗口（DSH 风格 inspector，分页 tabs）──

function DetailTabs({ tabs, active, onChange }: {
  tabs: string[]
  active: string
  onChange: (tab: string) => void
}) {
  return (
    <div className="tjs-tabs" role="tablist">
      {tabs.map(tab => (
        <button
          key={tab}
          role="tab"
          aria-selected={tab === active}
          className={`tjs-tab ${tab === active ? 'active' : ''}`}
          onClick={() => onChange(tab)}
        >
          {tab}
        </button>
      ))}
    </div>
  )
}

function DetailsPanel({
  selection,
  onClose,
}: {
  selection: TrajectorySelection
  onClose: () => void
}) {
  const t = useI18n()
  const isSystem = selection.kind === 'system'
  const tabs = isSystem
    ? (selection.row.kind === 'update'
      ? [t('系统提示'), t('工具'), t('差异')]
      : [t('系统提示'), t('工具')])
    : selection.row.kind === 'assistant'
      ? [t('内容'), t('思考'), t('指标'), t('原始')]
      : selection.row.kind === 'tool'
        ? [t('内容'), t('参数'), t('结果'), t('指标'), t('原始')]
        : [t('内容'), t('原始')]

  const [active, setActive] = useState(tabs[0])
  // 选中对象切换时回到第一个 tab。
  useEffect(() => { setActive(tabs[0]) }, [selection.key]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="tjs-details">
      <div className="tjs-details-head">
        <span className="tjs-details-title">
          {isSystem
            ? (selection.row.kind === 'initial' ? t('系统提示注入') : t('系统提示更新'))
            : selection.row.kind === 'user'
              ? t('用户消息')
              : selection.row.kind === 'assistant' ? t('助手回复') : t('工具调用')}
        </span>
        <button className="tjs-details-close" onClick={onClose} aria-label={t('关闭')}>×</button>
      </div>
      <DetailTabs tabs={tabs} active={active} onChange={setActive} />
      <div className="tjs-details-body">
        {isSystem
          ? <SystemDetails row={selection.row} tab={active} />
          : <RowDetails row={selection.row} tab={active} />}
      </div>
    </div>
  )
}

function PreBlock({ value }: { value: string }) {
  return value ? <pre className="tjs-pre">{value}</pre> : <div className="tjs-details-empty">—</div>
}

function RowDetails({ row, tab }: { row: TrajectoryRow; tab: string }) {
  const t = useI18n()
  if (row.kind === 'user') {
    return tab === t('原始')
      ? <PreBlock value={JSON.stringify({ role: 'user', content: row.text, created_at: row.createdAt }, null, 2)} />
      : <PreBlock value={row.text} />
  }
  if (row.kind === 'assistant') {
    if (tab === t('思考')) return <PreBlock value={row.reasoning} />
    if (tab === t('指标')) {
      const meta: string[] = []
      if (row.llmMs !== null) meta.push(`${t('时长')}: ${formatDuration(row.llmMs)}`)
      if (row.ttftMs !== null) meta.push(`${t('首 token')}: ${formatDuration(row.ttftMs)}`)
      if (row.decodeMs !== null) meta.push(`decode: ${formatDuration(row.decodeMs)}`)
      if (row.tokenSpeed !== null && row.tokenSpeed > 0) meta.push(`speed: ${row.tokenSpeed.toFixed(1)} tok/s`)
      meta.push(`${t('输入')}: ${formatTokens(row.inputTokens ?? 0)}`)
      meta.push(`${t('输出')}: ${formatTokens(row.outputTokens ?? 0)}`)
      meta.push(`cache hit: ${formatTokens(row.cacheHitTokens ?? 0)} / miss: ${formatTokens(row.cacheMissTokens ?? 0)}`)
      return <PreBlock value={meta.join('\n')} />
    }
    if (tab === t('原始')) {
      return <PreBlock value={JSON.stringify(row, null, 2)} />
    }
    return <PreBlock value={row.text} />
  }
  // tool
  if (tab === t('参数')) return <PreBlock value={row.toolArgs ?? ''} />
  if (tab === t('结果')) return <PreBlock value={row.text} />
  if (tab === t('指标')) {
    const meta: string[] = []
    meta.push(`${t('状态')}: ${row.isError ? t('失败') : row.toolStatus === 'denied' ? t('拒绝') : row.toolStatus || t('成功')}`)
    if (row.durationMs !== null) meta.push(`${t('时长')}: ${formatDuration(row.durationMs)}`)
    return <PreBlock value={meta.join('\n')} />
  }
  if (tab === t('原始')) {
    return <PreBlock value={JSON.stringify(row, null, 2)} />
  }
  return <PreBlock value={row.text} />
}

function SystemDetails({ row, tab }: { row: TrajectorySystemRow; tab: string }) {
  const t = useI18n()
  if (tab === t('系统提示')) {
    return <PreBlock value={row.system} />
  }
  if (tab === t('工具')) {
    const names = (row.tools || [])
      .map(tool => {
        const name = toolNameOf(tool)
        const desc = toolDescriptionOf(tool)
        return name ? `${name}${desc ? ` — ${desc}` : ''}` : ''
      })
      .filter(Boolean)
    return <PreBlock value={names.join('\n') || (t('（无工具）'))} />
  }
  if (tab === t('差异') && row.previous) {
    const prev = row.previous
    const prevNames = new Set(prev.toolNames)
    const curNames = toolNames(row.tools)
    const added = curNames.filter(name => !prevNames.has(name))
    const removed = prev.toolNames.filter(name => !curNames.includes(name))
    const lines: string[] = []
    if (row.system !== prev.system) lines.push(`[${t('系统提示已变化')}]`)
    if (added.length > 0) lines.push(`[+ ${t('新增工具')}: ${added.join(', ')}]`)
    if (removed.length > 0) lines.push(`[- ${t('移除工具')}: ${removed.join(', ')}]`)
    return <PreBlock value={lines.join('\n') || t('无变化')} />
  }
  return <PreBlock value={row.system} />
}
