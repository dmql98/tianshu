import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  fetchDebugSessions,
  fetchDebugTurnDetail,
  fetchDebugTurns,
  type DebugFileMeta,
  type DebugSessionMeta,
  type DebugTurnMeta,
} from '@/api/debug'
import {
  buildDebugTurnView,
  deriveDebugTimeline,
  summarizeDebugTurns,
  type DebugTimelineMode,
  type DebugTurnView,
} from '@/features/trajectory/debugTrajectory'
import DebugTimelineBar from '@/features/trajectory/DebugTimelineBar'
import Highlighted from '@/features/trajectory/highlight'
import { formatDuration, formatTokens } from '@/features/chat/runStats'
import { useI18n } from '@/i18n'

function hhmmss(ts: number): string {
  const d = new Date(ts)
  const two = (v: number) => String(v).padStart(2, '0')
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`
}

/** 是否显示 SYSTEM 记录：该 turn 是会话段（fp）的第一个 turn。 */
function isSegmentStart(turns: DebugTurnMeta[], index: number): boolean {
  if (index === 0) return true
  return turns[index].fp !== turns[index - 1].fp
}

/**
 * 调试详情视图（M2）：把 devdata/debug 里每次 LLM 调用的完整请求/响应
 * （system prompt、工具目录、消息历史、text/reasoning/toolCalls/usage/error）
 * 按「轮次 → SYSTEM/助手/工具 记录」可视化，支持会话/会话段选择、时间线联动、
 * 搜索高亮与懒加载。
 */
export default function DebugTrajectoryView() {
  const t = useI18n()

  // 数据源
  const [sessions, setSessions] = useState<DebugSessionMeta[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [file, setFile] = useState<string | null>(null)
  const [turns, setTurns] = useState<DebugTurnMeta[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 视图状态
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<DebugTimelineMode>('sequence')
  const [focus, setFocus] = useState<ReadonlySet<number> | null>(null)
  const [collapsedTurns, setCollapsedTurns] = useState<ReadonlySet<number>>(new Set())
  const [collapsedSystems, setCollapsedSystems] = useState<ReadonlySet<string>>(new Set())
  const [showHistory, setShowHistory] = useState<ReadonlySet<number>>(new Set())

  // 懒加载的 turn 详情缓存
  const [details, setDetails] = useState<Map<number, DebugTurnView>>(new Map())
  const [loadingTurns, setLoadingTurns] = useState<ReadonlySet<number>>(new Set())

  // 加载会话列表（全局，不依赖当前聊天会话）
  useEffect(() => {
    let cancelled = false
    fetchDebugSessions()
      .then(res => {
        if (cancelled) return
        setSessions(res.sessions)
        const first = res.sessions[0]
        if (first) {
          setSessionId(first.session_id)
          setFile(first.files[0]?.file ?? null)
        }
      })
      .catch(() => { if (!cancelled) setError(t('加载调试会话失败')) })
    return () => { cancelled = true }
  }, [t])

  // 切换会话/会话段 → 加载 turn 元数据
  useEffect(() => {
    if (!sessionId || !file) {
      setTurns([])
      setDetails(new Map())
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    setFocus(null)
    setCollapsedTurns(new Set())
    setDetails(new Map())
    fetchDebugTurns(sessionId, file)
      .then(res => { if (!cancelled) setTurns(res.turns) })
      .catch(() => { if (!cancelled) setError(t('加载调试轨迹失败')) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [sessionId, file, t])

  const selectSession = (id: string) => {
    setSessionId(id)
    const meta = sessions.find(s => s.session_id === id)
    setFile(meta?.files[0]?.file ?? null)
  }
  const selectFile = (name: string) => setFile(name)

  const toggleSet = (
    setter: React.Dispatch<React.SetStateAction<ReadonlySet<number>>>,
    key: number,
  ) => {
    setter(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const toggleTurn = (turnNo: number) => {
    toggleSet(setCollapsedTurns, turnNo)
    ensureDetail(turnNo)
  }

  // 懒加载 turn 详情；有工具调用时顺带加载下一轮以匹配结果。
  const ensureDetail = useCallback((turnNo: number) => {
    if (!sessionId || !file || details.has(turnNo) || loadingTurns.has(turnNo)) return
    setLoadingTurns(prev => new Set(prev).add(turnNo))
    const meta = turns.find(turn => turn.turn === turnNo)
    const needNext = Boolean(meta && meta.tool_calls.length > 0 && turns.some(t => t.turn === turnNo + 1))
    fetchDebugTurnDetail(sessionId, turnNo, file)
      .then(res => {
        const nextPromise = needNext
          ? fetchDebugTurnDetail(sessionId, turnNo + 1, file).catch(() => null)
          : Promise.resolve(null)
        return nextPromise.then(next => {
          setDetails(prev => {
            const map = new Map(prev)
            map.set(turnNo, buildDebugTurnView(res.turn, next?.turn ?? null))
            return map
          })
        })
      })
      .catch(() => { /* 详情加载失败：保持未加载态，可重试 */ })
      .finally(() => setLoadingTurns(prev => {
        const next = new Set(prev)
        next.delete(turnNo)
        return next
      }))
  }, [sessionId, file, turns, details, loadingTurns])

  const collapseAll = () => {
    setCollapsedTurns(new Set(turns.map(turn => turn.turn)))
    setCollapsedSystems(new Set())
  }
  const expandAll = () => {
    setCollapsedTurns(new Set())
    setCollapsedSystems(new Set())
    for (const turn of turns) ensureDetail(turn.turn)
  }

  // 搜索过滤：meta 字段 + 已加载详情的文本/参数/结果
  const visibleTurns = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return turns
    return turns.filter(turn => {
      if (turn.model?.toLowerCase().includes(q)) return true
      if (turn.fp?.toLowerCase().includes(q)) return true
      if (turn.error?.toLowerCase().includes(q)) return true
      if (turn.tool_calls.some(call =>
        call.name.toLowerCase().includes(q) || call.args_preview.toLowerCase().includes(q))) return true
      const view = details.get(turn.turn)
      if (view) {
        if (view.text.toLowerCase().includes(q)) return true
        if (view.reasoning.toLowerCase().includes(q)) return true
        if (view.systemPrompts.some(p => p.toLowerCase().includes(q))) return true
        if (view.toolCalls.some(call =>
          call.name.toLowerCase().includes(q) || call.args.toLowerCase().includes(q)
          || (call.result ?? '').toLowerCase().includes(q))) return true
      }
      return false
    })
  }, [turns, query, details])

  const summary = useMemo(() => summarizeDebugTurns(turns), [turns])
  const timeline = useMemo(
    () => deriveDebugTimeline(visibleTurns, mode),
    [visibleTurns, mode],
  )

  const currentSession = sessions.find(s => s.session_id === sessionId)
  const currentFile = currentSession?.files.find((f: DebugFileMeta) => f.file === file)

  const chips = [
    summary.turns > 0 ? `${summary.turns} ${t('轮次')}` : '',
    summary.models.length > 0 ? summary.models.join(' / ') : '',
    summary.inputTokens > 0 || summary.outputTokens > 0
      ? `${t('累计')} ${formatTokens(summary.inputTokens)} → ${formatTokens(summary.outputTokens)}`
      : '',
    summary.toolCalls > 0 ? `${summary.toolCalls} ${t('工具调用')}` : '',
    summary.errors > 0 ? `${t('错误')} ${summary.errors}` : '',
  ].filter(Boolean)

  return (
    <div className="tjs-view">
      <div className="tjs-toolbar">
        <select
          className="tjs-run-select"
          value={sessionId ?? ''}
          onChange={e => selectSession(e.target.value)}
          disabled={sessions.length === 0}
          title={t('选择调试会话')}
        >
          {sessions.length === 0 && <option value="">{t('无调试会话')}</option>}
          {sessions.map(session => (
            <option key={session.session_id} value={session.session_id}>
              {session.session_id}（{session.total_turns} {t('轮')}）
            </option>
          ))}
        </select>
        <select
          className="tjs-run-select"
          value={file ?? ''}
          onChange={e => selectFile(e.target.value)}
          disabled={!currentSession || currentSession.files.length <= 1}
          title={t('选择会话段（系统提示变更分段）')}
        >
          {currentSession?.files.map(f => (
            <option key={f.file} value={f.file}>
              {f.file} · {f.turns} {t('轮')}
              {f.fps.length > 0 ? ` · ${f.fps[0].slice(0, 8)}…` : ''}
            </option>
          ))}
        </select>
        {chips.map(chip => <span key={chip}>{chip}</span>)}
        {turns.length > 0 && (
          <>
            <button className="tjs-toggle tjs-toolbar-btn" onClick={collapseAll}>{t('折叠全部')}</button>
            <button className="tjs-toggle tjs-toolbar-btn" onClick={expandAll}>{t('展开全部')}</button>
          </>
        )}
        <input
          className="tjs-search"
          placeholder={t('搜索调试轨迹')}
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
      </div>

      {visibleTurns.length > 0 && (
        <DebugTimelineBar
          turns={visibleTurns}
          timeline={timeline}
          mode={mode}
          onModeChange={setMode}
          focus={focus}
          onFocusChange={setFocus}
        />
      )}

      {loading && <div className="tjs-empty">{t('加载中…')}</div>}
      {error && <div className="tjs-empty tjs-error">{error}</div>}
      {!loading && !error && turns.length === 0 && (
        <div className="tjs-empty">
          {sessions.length === 0 ? t('无调试会话数据') : t('该会话段无数据')}
          {currentFile && currentFile.last_ts
            ? ` · ${t('最近')} ${hhmmss(currentFile.last_ts)}`
            : ''}
        </div>
      )}

      {!loading && !error && turns.length > 0 && (
        <div className="tjs-ledger">
          {visibleTurns.map((turn, index) => {
            const turnNo = turn.turn
            const collapsed = collapsedTurns.has(turnNo)
            const dimmed = focus !== null && !focus.has(turnNo)
            const view = details.get(turnNo)
            const loadingDetail = loadingTurns.has(turnNo)
            const segmentStart = isSegmentStart(visibleTurns, index)
            return (
              <div key={`turn-${turnNo}`} className={`tjs-turn-block ${dimmed ? 'dimmed' : ''}`}>
                <div className="tjs-turn">
                  <button className="tjs-turn-head" onClick={() => toggleTurn(turnNo)}>
                    <span className="tjs-chevron">{collapsed ? '▸' : '▾'}</span>
                    <span className="tjs-kind tjs-kind-turn">{t('轮次')} {turnNo}</span>
                    {turn.fp && <span className="tjs-fp" title={turn.fp}>{turn.fp.slice(0, 8)}</span>}
                    {turn.model && <span className="tjs-row-title">{turn.model}</span>}
                    {turn.usage && (
                      <span className="tjs-group-usage">
                        {formatTokens(turn.usage.input)} → {formatTokens(turn.usage.output)}
                      </span>
                    )}
                    {turn.error && <span className="tjs-error">{t('错误')}</span>}
                    <span className="tjs-time">{hhmmss(turn.timestamp)}</span>
                  </button>
                </div>
                {!collapsed && (
                  <div className="tjs-group tjs-group-step">
                    {segmentStart && (
                      <SystemRecord
                        turnNo={turnNo}
                        fp={turn.fp}
                        view={view}
                        loading={loadingDetail}
                        collapsed={collapsedSystems.has(turn.fp)}
                        onToggle={() => {
                          ensureDetail(turnNo)
                          const key = turn.fp || `fp-${turnNo}`
                          setCollapsedSystems(prev => {
                            const next = new Set(prev)
                            if (next.has(key)) next.delete(key)
                            else next.add(key)
                            return next
                          })
                        }}
                        query={query}
                      />
                    )}
                    <AssistantRecord
                      turnNo={turnNo}
                      view={view}
                      loading={loadingDetail}
                      onExpand={() => ensureDetail(turnNo)}
                      query={query}
                      showHistory={showHistory.has(turnNo)}
                      onToggleHistory={() => toggleSet(setShowHistory, turnNo)}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function SystemRecord({ turnNo, fp, view, loading, collapsed, onToggle, query }: {
  turnNo: number
  fp: string
  view: DebugTurnView | undefined
  loading: boolean
  collapsed: boolean
  onToggle: () => void
  query: string
}) {
  const t = useI18n()
  const toolCount = view ? view.tools.length : null
  return (
    <div className="tjs-row tjs-row-system">
      <button className="tjs-row-head" onClick={onToggle}>
        <span className="tjs-chevron">{collapsed ? '▸' : '▾'}</span>
        <span className="tjs-kind tjs-kind-system">SYSTEM</span>
        <span className="tjs-row-title">
          {t('系统提示')}
          {toolCount !== null ? ` · ${toolCount} ${t('工具')}` : ''}
          {fp ? ` · sha256:${fp}` : ''}
        </span>
        {loading && <span className="tjs-time">{t('加载中…')}</span>}
      </button>
      {!collapsed && (
        <div className="tjs-body">
          {loading && !view && <div className="tjs-meta">{t('加载中…')}</div>}
          {view && (
            <div className="tjs-tool">
              {view.systemPrompts.map((prompt, i) => (
                <div key={i} className="tjs-block">
                  <div className="tjs-block-label">{t('系统提示')} {view.systemPrompts.length > 1 ? i + 1 : ''}</div>
                  <pre className="tjs-pre tjs-system-prompt"><Highlighted text={prompt} query={query} /></pre>
                </div>
              ))}
              {view.tools.length > 0 && (
                <div className="tjs-block">
                  <div className="tjs-block-label">{t('工具目录')}（{view.tools.length}）</div>
                  <pre className="tjs-pre tjs-tools-json">{JSON.stringify(view.tools, null, 2)}</pre>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function AssistantRecord({ turnNo, view, loading, onExpand, query, showHistory, onToggleHistory }: {
  turnNo: number
  view: DebugTurnView | undefined
  loading: boolean
  onExpand: () => void
  query: string
  showHistory: boolean
  onToggleHistory: () => void
}) {
  const t = useI18n()
  const [showReasoning, setShowReasoning] = useState(false)
  const [openTools, setOpenTools] = useState<ReadonlySet<string>>(new Set())
  const open = Boolean(view)
  const toolKey = (call: { id: string | null; name: string }) => `${turnNo}:${call.id ?? call.name}`

  return (
    <div className={`tjs-row tjs-row-assistant ${view?.error ? 'is-error' : ''}`}>
      <button className="tjs-row-head" onClick={onExpand}>
        <span className="tjs-chevron">{open ? '▾' : '▸'}</span>
        <span className="tjs-kind tjs-kind-assistant">{t('助手')} #{turnNo}</span>
        <span className="tjs-row-title">
          {view?.model ?? ''}
          {view?.usage ? ` · ${formatTokens(view.usage.input)} → ${formatTokens(view.usage.output)}` : ''}
          {view?.error ? ` · ${t('错误')}` : ''}
        </span>
        {loading && !view && <span className="tjs-time">{t('加载中…')}</span>}
        {!loading && !view && <span className="tjs-time">{t('点击加载完整请求/响应')}</span>}
      </button>
      {open && view && (
        <div className="tjs-body">
          <div className="tjs-assistant">
            {view.error && <div className="tjs-error">{view.error}</div>}
            {view.reasoning && (
              <div className="tjs-reasoning">
                <button className="tjs-toggle" onClick={() => setShowReasoning(v => !v)}>
                  {showReasoning ? '▾' : '▸'} {t('思考')}
                </button>
                {showReasoning && <pre className="tjs-pre tjs-reasoning-body"><Highlighted text={view.reasoning} query={query} /></pre>}
              </div>
            )}
            {view.text ? (
              <pre className="tjs-pre tjs-assistant-text"><Highlighted text={view.text} query={query} /></pre>
            ) : (
              <div className="tjs-meta">{t('（无文本，仅工具调用）')}</div>
            )}
            {view.toolCalls.length > 0 && (
              <div className="tjs-block">
                <div className="tjs-block-label">{t('工具调用')}（{view.toolCalls.length}）</div>
                {view.toolCalls.map(call => {
                  const key = toolKey(call)
                  const expanded = openTools.has(key)
                  const hasResult = call.result !== null
                  return (
                    <div key={key} className="tjs-toolcall">
                      <button
                        className="tjs-toolcall-head"
                        onClick={() => setOpenTools(prev => {
                          const next = new Set(prev)
                          if (next.has(key)) next.delete(key)
                          else next.add(key)
                          return next
                        })}
                      >
                        <span className="tjs-chevron">{expanded ? '▾' : '▸'}</span>
                        <span className="tjs-kind tjs-kind-tool">{call.name}</span>
                        {hasResult && <span className="tjs-status ok">{t('成功')}</span>}
                        {!hasResult && <span className="tjs-status denied">{t('未记录结果')}</span>}
                      </button>
                      {expanded && (
                        <div className="tjs-toolcall-body">
                          <div className="tjs-block">
                            <div className="tjs-block-label">{t('参数')}</div>
                            <pre className="tjs-pre"><Highlighted text={call.args || '{}'} query={query} /></pre>
                          </div>
                          <div className="tjs-block">
                            <div className="tjs-block-label">{t('结果')}</div>
                            {hasResult
                              ? <pre className="tjs-pre"><Highlighted text={call.result!} query={query} /></pre>
                              : <div className="tjs-meta">{t('（未在下一轮消息中找到匹配的工具结果）')}</div>}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
            <button className="tjs-toggle" onClick={onToggleHistory}>
              {showHistory ? '▾' : '▸'} {t('完整消息历史')}
            </button>
            {showHistory && (
              <div className="tjs-history">
                {view.messages.map((msg, i) => (
                  <div key={i} className="tjs-history-msg">
                    <span className={`tjs-kind tjs-kind-${msg.role === 'tool' ? 'tool' : msg.role === 'assistant' ? 'assistant' : msg.role === 'user' ? 'user' : 'system'}`}>
                      {msg.role}
                    </span>
                    {msg.tool_call_id && <span className="tjs-time">{msg.tool_call_id.slice(0, 16)}…</span>}
                    {msg.content === null
                      ? <span className="tjs-meta">{t('（无文本内容）')}</span>
                      : <pre className="tjs-pre"><Highlighted text={msg.content} query={query} /></pre>}
                    {msg.truncated && <div className="tjs-block-label">{t('（内容过长已截断）')}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
