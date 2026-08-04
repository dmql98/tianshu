import { useState, useEffect } from 'react'
import { useProvidersStore } from '@/stores/providersStore'
import { fetchCharacters } from '@/api/characters'
import type { Character } from '@/types'
import {
  fetchEventDefinitions, createEventDefinition, fetchEventOccurrences,
  fireEventDefinition, retryEventOccurrence, deleteEventDefinition,
  archiveEventDefinition, restoreEventDefinition,
  type EventDefinition, type EventOccurrence,
} from '@/api/eventDefinitions'

const statusLabels: Record<string, string> = {
  pending: '待执行', running: '运行中', completed: '已完成', failed: '失败',
  cancelled: '已取消', skipped: '已跳过',
}

const statusColors: Record<string, string> = {
  pending: 'var(--gold)', running: 'var(--blue)', completed: 'var(--jade)',
  failed: 'var(--cinnabar)', cancelled: 'var(--ink-faint)', skipped: 'var(--ink-light)',
}

type EventLane = 'pending' | 'running' | 'completed' | 'failed' | 'archived'

const eventLanes: Array<{ id: EventLane; label: string; icon: string }> = [
  { id: 'pending', label: '等待', icon: '⏳' },
  { id: 'running', label: '运行中', icon: '▶' },
  { id: 'completed', label: '成功', icon: '✓' },
  { id: 'failed', label: '失败', icon: '✗' },
  { id: 'archived', label: '归档', icon: '📦' },
]

function timeAgo(ts: number | null): string {
  if (!ts) return '-'
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return '刚刚'
  if (mins < 60) return `${mins}分钟前`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}小时前`
  return `${Math.floor(hours / 24)}天前`
}

function nextFireLabel(def: EventDefinition): string {
  if (def.status !== 'active' || def.next_fire_at === null) return '-'
  if (def.next_fire_at === 0) return '已结束'
  return new Date(def.next_fire_at).toLocaleString('zh-CN', { hour12: false })
}

export default function EventsPage() {
  const { providers, load: loadProviders } = useProvidersStore()
  const [definitions, setDefinitions] = useState<EventDefinition[]>([])
  const [characters, setCharacters] = useState<Character[]>([])
  const [loading, setLoading] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [occurrences, setOccurrences] = useState<Record<string, EventOccurrence[]>>({})
  const [occurrencesLoading, setOccurrencesLoading] = useState<Set<string>>(new Set())

  const [form, setForm] = useState<{
    name: string; type: 'once' | 'cron'; cron_expr: string; timezone: string;
    instruction: string; character_id: string; overlap_policy: 'skip' | 'queue';
    provider_id: string; model: string; workspace: string; assigned_group: string;
  }>({
    name: '', type: 'once', cron_expr: '', timezone: 'Asia/Shanghai', instruction: '',
    character_id: '', overlap_policy: 'skip', provider_id: '', model: '', workspace: '',
    assigned_group: '',
  })

  const loadDefinitions = async (showSpinner = true) => {
    if (showSpinner) setLoading(true)
    try {
      const nextDefinitions = await fetchEventDefinitions()
      const occurrenceEntries = await Promise.all(nextDefinitions.map(async definition => {
        try {
          return [definition.id, await fetchEventOccurrences(definition.id)] as const
        } catch {
          return [definition.id, [] as EventOccurrence[]] as const
        }
      }))
      setDefinitions(nextDefinitions)
      setOccurrences(Object.fromEntries(occurrenceEntries))
    } catch (err) {
      console.error('Failed to load event definitions:', err)
    } finally {
      if (showSpinner) setLoading(false)
    }
  }

  useEffect(() => {
    loadProviders()
    fetchCharacters().then(setCharacters).catch(() => {})
    void loadDefinitions()
    const refreshTimer = window.setInterval(() => void loadDefinitions(false), 5000)
    return () => window.clearInterval(refreshTimer)
  }, [])

  const selectedCharGroups = form.character_id
    ? characters.find(c => c.id === form.character_id)?.groups?.filter(g => g.trim()) || []
    : []
  const selectedProviderModels = form.provider_id
    ? providers.find(p => p.id === form.provider_id)?.models?.filter((m: any) => m.enabled !== false) || []
    : []

  const handleCreate = async () => {
    setCreateError('')
    if (!form.name.trim()) { setCreateError('请输入事件名称'); return }
    if (!form.character_id) { setCreateError('请选择执行角色'); return }
    if (!form.instruction.trim()) { setCreateError('请输入指令'); return }
    if (form.type === 'cron' && !form.cron_expr.trim()) { setCreateError('请输入 Cron 表达式'); return }
    setCreating(true)
    try {
      const created = await createEventDefinition({
        name: form.name.trim(),
        type: form.type,
        cron_expr: form.type === 'cron' ? form.cron_expr.trim() : undefined,
        timezone: form.timezone,
        instruction: form.instruction.trim(),
        character_id: form.character_id,
        overlap_policy: form.overlap_policy,
        assigned_group: form.assigned_group || null,
        provider_id: form.provider_id || null,
        model: form.model || null,
        workspace: form.workspace || null,
      })
      setDefinitions(prev => [created, ...prev])
      setShowCreate(false)
      setForm({ name: '', type: 'once', cron_expr: '', timezone: 'Asia/Shanghai', instruction: '', character_id: '', overlap_policy: 'skip', provider_id: '', model: '', workspace: '', assigned_group: '' })
    } catch (err: any) {
      setCreateError(err.message || '创建失败')
    } finally {
      setCreating(false)
    }
  }

  const handleFire = async (def: EventDefinition) => {
    try {
      const occ = await fireEventDefinition(def.id)
      setOccurrences(prev => ({ ...prev, [def.id]: [occ, ...(prev[def.id] || []).filter(item => item.id !== occ.id)] }))
    } catch (err: any) {
      console.error('Failed to fire:', err)
      alert(err.message || '触发失败')
    }
  }

  const handleRetry = async (defId: string, occurrenceId: string) => {
    try {
      const updated = await retryEventOccurrence(occurrenceId)
      setOccurrences(prev => ({
        ...prev,
        [defId]: (prev[defId] || []).map(o => o.id === updated.id ? updated : o),
      }))
    } catch (err: any) {
      console.error('Failed to retry:', err)
    }
  }

  const handleDelete = async (def: EventDefinition) => {
    if (!window.confirm(`删除事件「${def.name}」？\n将同时删除其全部执行记录，不可恢复。`)) return
    try {
      await deleteEventDefinition(def.id)
      setDefinitions(prev => prev.filter(d => d.id !== def.id))
      setOccurrences(prev => {
        const next = { ...prev }
        delete next[def.id]
        return next
      })
      if (expandedId === def.id) setExpandedId(null)
    } catch (err: any) {
      console.error('Failed to delete:', err)
      alert(err.message || '删除失败')
    }
  }

  const handleArchive = async (def: EventDefinition) => {
    try {
      const updated = await archiveEventDefinition(def.id)
      setDefinitions(prev => prev.map(item => item.id === def.id ? updated : item))
    } catch (err: any) {
      alert(err.message || '归档失败')
    }
  }

  const handleRestore = async (def: EventDefinition) => {
    try {
      const updated = await restoreEventDefinition(def.id)
      setDefinitions(prev => prev.map(item => item.id === def.id ? updated : item))
    } catch (err: any) {
      alert(err.message || '恢复失败')
    }
  }

  const toggleExpand = async (def: EventDefinition) => {
    if (expandedId === def.id) {
      setExpandedId(null)
      return
    }
    setExpandedId(def.id)
    if (!occurrences[def.id]) {
      setOccurrencesLoading(prev => new Set(prev).add(def.id))
      try {
        const occs = await fetchEventOccurrences(def.id)
        setOccurrences(prev => ({ ...prev, [def.id]: occs }))
      } catch {
        setOccurrences(prev => ({ ...prev, [def.id]: [] }))
      } finally {
        setOccurrencesLoading(prev => {
          const next = new Set(prev)
          next.delete(def.id)
          return next
        })
      }
    }
  }

  const charName = (id: string) => characters.find(c => c.id === id)?.name || id

  const latestOccurrence = (definitionId: string) => occurrences[definitionId]?.[0]
  const laneFor = (definition: EventDefinition): EventLane => {
    if (definition.status === 'archived') return 'archived'
    const latest = latestOccurrence(definition.id)
    if (!latest || latest.status === 'pending') return 'pending'
    if (latest.status === 'running') return 'running'
    if (latest.status === 'completed') return 'completed'
    if (latest.status === 'failed') return 'failed'
    return 'archived'
  }

  const groupedDefinitions = eventLanes.reduce((groups, lane) => {
    groups[lane.id] = definitions.filter(definition => laneFor(definition) === lane.id)
    return groups
  }, {} as Record<EventLane, EventDefinition[]>)

  return (
    <main className="main">
      <div className="page-header">
        <div className="page-header-left">
          <span className="page-title">事件中心</span>
          <span className="page-desc">{definitions.length} 个事件定义 · {definitions.filter(d => d.status === 'active').length} 个启用</span>
        </div>
        <div className="header-actions">
          <button className="btn primary" onClick={() => setShowCreate(true)}>+ 新建事件</button>
        </div>
      </div>

      <div className="content">
        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--ink-faint)' }}>加载中...</div>
        ) : definitions.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--ink-faint)' }}>暂无事件定义</div>
        ) : (
          <div className="event-lanes">
            {eventLanes.map(lane => (
              <section key={lane.id} className={`lane ${lane.id}`}>
                <div className="lane-header">
                  <span>{lane.icon}</span>
                  <span>{lane.label}</span>
                  <span className="lane-count">{groupedDefinitions[lane.id].length}</span>
                </div>
                <div className="lane-body">
                  {groupedDefinitions[lane.id].length === 0 ? (
                    <div className="lane-empty">暂无</div>
                  ) : groupedDefinitions[lane.id].map(def => {
                    const latest = latestOccurrence(def.id)
                    const occs = occurrences[def.id] || []
                    const isExpanded = expandedId === def.id
                    return (
                      <article key={def.id} className={`event-card ${isExpanded ? 'expanded' : ''}`}>
                        <div className="card-header">
                          <span className="type-tag">{def.type === 'cron' ? '⏱ 定时' : '一次性'}</span>
                          <button className="btn-expand" onClick={() => void toggleExpand(def)}>
                            {isExpanded ? '收起' : '展开'}
                          </button>
                        </div>
                        <div className="event-card-title">{def.name}</div>
                        <div className="event-card-agent">
                          <span className="agent-icon">{charName(def.character_id)[0] || '👤'}</span>
                          <span className="agent-name">{charName(def.character_id)}</span>
                        </div>
                        <div className={`card-payload ${isExpanded ? 'card-payload-expanded' : ''}`}>{def.instruction}</div>
                        <div className="event-card-meta">
                          <span>{latest ? timeAgo(latest.updated_at) : '尚未执行'}</span>
                          <span>{def.type === 'cron' ? `下次 ${nextFireLabel(def)}` : ''}</span>
                        </div>
                        {latest?.status === 'failed' && latest.error && (
                          <div className="card-error">{latest.error}</div>
                        )}
                        {isExpanded && occs.length > 0 && (
                          <div className="event-occurrence-history">
                            {occs.map(occ => (
                              <div key={occ.id} className="event-occurrence-row">
                                <span style={{ color: statusColors[occ.status] }}>{statusLabels[occ.status] || occ.status}</span>
                                <span>{timeAgo(occ.scheduled_for)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="card-actions">
                          {lane.id === 'pending' && <button className="btn sm primary" onClick={() => void handleFire(def)}>▶ 触发</button>}
                          {lane.id === 'failed' && latest && <button className="btn sm" onClick={() => void handleRetry(def.id, latest.id)}>重试</button>}
                          {(lane.id === 'completed' || lane.id === 'failed' || lane.id === 'pending') && (
                            <button className="btn sm" onClick={() => void handleArchive(def)}>归档</button>
                          )}
                          {lane.id === 'archived' && (
                            <>
                              <button className="btn sm" onClick={() => void handleRestore(def)}>恢复</button>
                              <button className="btn sm danger" onClick={() => void handleDelete(def)}>删除</button>
                            </>
                          )}
                        </div>
                      </article>
                    )
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      {/* 创建事件弹窗 */}
      {showCreate && (
        <div className="approval-overlay" onClick={() => setShowCreate(false)}>
          <div className="approval-dialog" style={{ maxWidth: 560, width: '100%' }} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>新建事件</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, color: 'var(--ink-light)', marginBottom: 4, display: 'block' }}>事件名称 *</label>
                <input type="text" value={form.name} onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))} placeholder="例如：每日巡检" style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, background: 'var(--bg-input)', color: 'var(--ink-deep)' }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--ink-light)', marginBottom: 4, display: 'block' }}>执行角色 *</label>
                  <select value={form.character_id} onChange={e => setForm(prev => ({ ...prev, character_id: e.target.value, assigned_group: '' }))} style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, background: 'var(--bg-input)', color: 'var(--ink-deep)' }}>
                    <option value="">请选择...</option>
                    {characters.map(c => <option key={c.id} value={c.id}>{c.name} ({c.id})</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--ink-light)', marginBottom: 4, display: 'block' }}>分组</label>
                  <select value={form.assigned_group} onChange={e => setForm(prev => ({ ...prev, assigned_group: e.target.value }))} disabled={selectedCharGroups.length === 0} style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, background: 'var(--bg-input)', color: 'var(--ink-deep)', opacity: selectedCharGroups.length === 0 ? 0.5 : 1 }}>
                    <option value="">无</option>
                    {selectedCharGroups.map(g => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--ink-light)', marginBottom: 4, display: 'block' }}>提供商</label>
                  <select value={form.provider_id} onChange={e => setForm(prev => ({ ...prev, provider_id: e.target.value, model: '' }))} style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, background: 'var(--bg-input)', color: 'var(--ink-deep)' }}>
                    <option value="">默认</option>
                    {providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--ink-light)', marginBottom: 4, display: 'block' }}>模型</label>
                  <select value={form.model} onChange={e => setForm(prev => ({ ...prev, model: e.target.value }))} disabled={!form.provider_id} style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, background: 'var(--bg-input)', color: 'var(--ink-deep)', opacity: !form.provider_id ? 0.5 : 1 }}>
                    <option value="">默认</option>
                    {selectedProviderModels.map(m => <option key={m.id} value={m.id}>{m.name || m.id}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--ink-light)', marginBottom: 4, display: 'block' }}>工作区</label>
                <input type="text" value={form.workspace} onChange={e => setForm(prev => ({ ...prev, workspace: e.target.value }))} placeholder="工作目录路径" style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, background: 'var(--bg-input)', color: 'var(--ink-deep)' }} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--ink-light)', marginBottom: 4, display: 'block' }}>指令 *</label>
                <textarea value={form.instruction} onChange={e => setForm(prev => ({ ...prev, instruction: e.target.value }))} rows={4} placeholder="描述要执行的任务..." style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, background: 'var(--bg-input)', color: 'var(--ink-deep)', resize: 'vertical', fontFamily: 'inherit' }} />
              </div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, color: 'var(--ink-light)', marginBottom: 4, display: 'block' }}>类型</label>
                  <select value={form.type} onChange={e => setForm(prev => ({ ...prev, type: e.target.value as 'once' | 'cron' }))} style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, background: 'var(--bg-input)', color: 'var(--ink-deep)' }}>
                    <option value="once">一次性</option>
                    <option value="cron">定时 (Cron)</option>
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, color: 'var(--ink-light)', marginBottom: 4, display: 'block' }}>重叠策略</label>
                  <select value={form.overlap_policy} onChange={e => setForm(prev => ({ ...prev, overlap_policy: e.target.value as 'skip' | 'queue' }))} style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, background: 'var(--bg-input)', color: 'var(--ink-deep)' }}>
                    <option value="skip">跳过 (skip)</option>
                    <option value="queue">排队 (queue)</option>
                  </select>
                </div>
              </div>
              {form.type === 'cron' && (
                <div style={{ display: 'flex', gap: 10 }}>
                  <div style={{ flex: 2 }}>
                    <label style={{ fontSize: 12, color: 'var(--ink-light)', marginBottom: 4, display: 'block' }}>Cron 表达式</label>
                    <input type="text" value={form.cron_expr} onChange={e => setForm(prev => ({ ...prev, cron_expr: e.target.value }))} placeholder="0 */4 * * *" style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, background: 'var(--bg-input)', color: 'var(--ink-deep)', fontFamily: 'monospace' }} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: 12, color: 'var(--ink-light)', marginBottom: 4, display: 'block' }}>时区</label>
                    <select value={form.timezone} onChange={e => setForm(prev => ({ ...prev, timezone: e.target.value }))} style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, background: 'var(--bg-input)', color: 'var(--ink-deep)' }}>
                      <option value="Asia/Shanghai">Asia/Shanghai</option>
                      <option value="UTC">UTC</option>
                      <option value="America/New_York">America/New_York</option>
                    </select>
                  </div>
                </div>
              )}
            </div>
            {createError && <p style={{ color: 'var(--cinnabar)', fontSize: 12, margin: '8px 0' }}>{createError}</p>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button className="btn" onClick={() => setShowCreate(false)}>取消</button>
              <button className="btn primary" onClick={handleCreate} disabled={creating}>{creating ? '创建中...' : '创建'}</button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
