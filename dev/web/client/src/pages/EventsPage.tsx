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
import type { I18nState } from '@/i18n'
import { useI18n } from '@/i18n'

type T = I18nState['t']

const statusLabelKeys: Record<string, string> = {
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

function timeAgo(ts: number | null, t: T): string {
  if (!ts) return '-'
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return t('刚刚')
  if (mins < 60) return t('{mins}分钟前', { mins })
  const hours = Math.floor(mins / 60)
  if (hours < 24) return t('{hours}小时前', { hours })
  return t('{days}天前', { days: Math.floor(hours / 24) })
}

function nextFireLabel(def: EventDefinition, t: T): string {
  if (def.status !== 'active' || def.next_fire_at === null) return '-'
  if (def.next_fire_at === 0) return t('已结束')
  return new Date(def.next_fire_at).toLocaleString('zh-CN', { hour12: false })
}

export default function EventsPage() {
  const { providers, load: loadProviders } = useProvidersStore()
  const t = useI18n()
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
    if (!form.name.trim()) { setCreateError(t('请输入事件名称')); return }
    if (!form.character_id) { setCreateError(t('请选择执行角色')); return }
    if (!form.instruction.trim()) { setCreateError(t('请输入指令')); return }
    if (form.type === 'cron' && !form.cron_expr.trim()) { setCreateError(t('请输入 Cron 表达式')); return }
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
      setCreateError(err.message || t('创建失败'))
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
      alert(err.message || t('触发失败'))
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
    if (!window.confirm(t('删除事件「{name}」？\n将同时删除其全部执行记录，不可恢复。', { name: def.name }))) return
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
      alert(err.message || t('删除失败'))
    }
  }

  const handleArchive = async (def: EventDefinition) => {
    try {
      const updated = await archiveEventDefinition(def.id)
      setDefinitions(prev => prev.map(item => item.id === def.id ? updated : item))
    } catch (err: any) {
      alert(err.message || t('归档失败'))
    }
  }

  const handleRestore = async (def: EventDefinition) => {
    try {
      const updated = await restoreEventDefinition(def.id)
      setDefinitions(prev => prev.map(item => item.id === def.id ? updated : item))
    } catch (err: any) {
      alert(err.message || t('恢复失败'))
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
          <span className="page-title">{t('事件中心')}</span>
          <span className="page-desc">{t('{count} 个事件定义 · {active} 个启用', { count: definitions.length, active: definitions.filter(d => d.status === 'active').length })}</span>
        </div>
        <div className="header-actions">
          <button className="btn primary" onClick={() => setShowCreate(true)}>+ {t('新建事件')}</button>
        </div>
      </div>

      <div className="content">
        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--ink-faint)' }}>{t('加载中...')}</div>
        ) : definitions.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--ink-faint)' }}>{t('暂无事件定义')}</div>
        ) : (
          <div className="event-lanes">
            {eventLanes.map(lane => (
              <section key={lane.id} className={`lane ${lane.id}`}>
                <div className="lane-header">
                  <span>{lane.icon}</span>
                  <span>{t(lane.label)}</span>
                  <span className="lane-count">{groupedDefinitions[lane.id].length}</span>
                </div>
                <div className="lane-body">
                  {groupedDefinitions[lane.id].length === 0 ? (
                    <div className="lane-empty">{t('暂无')}</div>
                  ) : groupedDefinitions[lane.id].map(def => {
                    const latest = latestOccurrence(def.id)
                    const occs = occurrences[def.id] || []
                    const isExpanded = expandedId === def.id
                    return (
                      <article key={def.id} className={`event-card ${isExpanded ? 'expanded' : ''}`}>
                        <div className="card-header">
                          <span className="type-tag">{def.type === 'cron' ? `⏱ ${t('定时')}` : t('一次性')}</span>
                          <button className="btn-expand" onClick={() => void toggleExpand(def)}>
                            {isExpanded ? t('收起') : t('展开')}
                          </button>
                        </div>
                        <div className="event-card-title">{def.name}</div>
                        <div className="event-card-agent">
                          <span className="agent-icon">{charName(def.character_id)[0] || '👤'}</span>
                          <span className="agent-name">{charName(def.character_id)}</span>
                        </div>
                        <div className={`card-payload ${isExpanded ? 'card-payload-expanded' : ''}`}>{def.instruction}</div>
                        <div className="event-card-meta">
                          <span>{latest ? timeAgo(latest.updated_at, t) : t('尚未执行')}</span>
                          <span>{def.type === 'cron' ? `${t('下次')} ${nextFireLabel(def, t)}` : ''}</span>
                        </div>
                        {latest?.status === 'failed' && latest.error && (
                          <div className="card-error">{latest.error}</div>
                        )}
                        {isExpanded && occs.length > 0 && (
                          <div className="event-occurrence-history">
                            {occs.map(occ => (
                              <div key={occ.id} className="event-occurrence-row">
                                <span style={{ color: statusColors[occ.status] }}>{statusLabelKeys[occ.status] ? t(statusLabelKeys[occ.status]) : occ.status}</span>
                                <span>{timeAgo(occ.scheduled_for, t)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="card-actions">
                          {lane.id === 'pending' && <button className="btn sm primary" onClick={() => void handleFire(def)}>▶ {t('触发')}</button>}
                          {lane.id === 'failed' && latest && <button className="btn sm" onClick={() => void handleRetry(def.id, latest.id)}>{t('重试')}</button>}
                          {(lane.id === 'completed' || lane.id === 'failed' || lane.id === 'pending') && (
                            <button className="btn sm" onClick={() => void handleArchive(def)}>{t('归档')}</button>
                          )}
                          {lane.id === 'archived' && (
                            <>
                              <button className="btn sm" onClick={() => void handleRestore(def)}>{t('恢复')}</button>
                              <button className="btn sm danger" onClick={() => void handleDelete(def)}>{t('删除')}</button>
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
            <h2 style={{ fontSize: 'calc(18px * var(--ui-font-scale))', fontWeight: 600, marginBottom: 16 }}>{t('新建事件')}</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: 'calc(12px * var(--ui-font-scale))', color: 'var(--ink-light)', marginBottom: 4, display: 'block' }}>{t('事件名称')} *</label>
                <input type="text" value={form.name} onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))} placeholder={t('例如：每日巡检')} style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 'calc(13px * var(--ui-font-scale))', background: 'var(--bg-input)', color: 'var(--ink-deep)' }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ fontSize: 'calc(12px * var(--ui-font-scale))', color: 'var(--ink-light)', marginBottom: 4, display: 'block' }}>{t('执行角色')} *</label>
                  <select value={form.character_id} onChange={e => setForm(prev => ({ ...prev, character_id: e.target.value, assigned_group: '' }))} style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 'calc(13px * var(--ui-font-scale))', background: 'var(--bg-input)', color: 'var(--ink-deep)' }}>
                    <option value="">{t('请选择...')}</option>
                    {characters.map(c => <option key={c.id} value={c.id}>{c.name} ({c.id})</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 'calc(12px * var(--ui-font-scale))', color: 'var(--ink-light)', marginBottom: 4, display: 'block' }}>{t('分组')}</label>
                  <select value={form.assigned_group} onChange={e => setForm(prev => ({ ...prev, assigned_group: e.target.value }))} disabled={selectedCharGroups.length === 0} style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 'calc(13px * var(--ui-font-scale))', background: 'var(--bg-input)', color: 'var(--ink-deep)', opacity: selectedCharGroups.length === 0 ? 0.5 : 1 }}>
                    <option value="">{t('无')}</option>
                    {selectedCharGroups.map(g => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 'calc(12px * var(--ui-font-scale))', color: 'var(--ink-light)', marginBottom: 4, display: 'block' }}>{t('提供商')}</label>
                  <select value={form.provider_id} onChange={e => setForm(prev => ({ ...prev, provider_id: e.target.value, model: '' }))} style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 'calc(13px * var(--ui-font-scale))', background: 'var(--bg-input)', color: 'var(--ink-deep)' }}>
                    <option value="">{t('默认')}</option>
                    {providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 'calc(12px * var(--ui-font-scale))', color: 'var(--ink-light)', marginBottom: 4, display: 'block' }}>{t('模型')}</label>
                  <select value={form.model} onChange={e => setForm(prev => ({ ...prev, model: e.target.value }))} disabled={!form.provider_id} style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 'calc(13px * var(--ui-font-scale))', background: 'var(--bg-input)', color: 'var(--ink-deep)', opacity: !form.provider_id ? 0.5 : 1 }}>
                    <option value="">{t('默认')}</option>
                    {selectedProviderModels.map(m => <option key={m.id} value={m.id}>{m.name || m.id}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label style={{ fontSize: 'calc(12px * var(--ui-font-scale))', color: 'var(--ink-light)', marginBottom: 4, display: 'block' }}>{t('工作区')}</label>
                <input type="text" value={form.workspace} onChange={e => setForm(prev => ({ ...prev, workspace: e.target.value }))} placeholder={t('工作目录路径')} style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 'calc(13px * var(--ui-font-scale))', background: 'var(--bg-input)', color: 'var(--ink-deep)' }} />
              </div>
              <div>
                <label style={{ fontSize: 'calc(12px * var(--ui-font-scale))', color: 'var(--ink-light)', marginBottom: 4, display: 'block' }}>{t('指令')} *</label>
                <textarea value={form.instruction} onChange={e => setForm(prev => ({ ...prev, instruction: e.target.value }))} rows={4} placeholder={t('描述要执行的任务...')} style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 'calc(13px * var(--ui-font-scale))', background: 'var(--bg-input)', color: 'var(--ink-deep)', resize: 'vertical', fontFamily: 'inherit' }} />
              </div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 'calc(12px * var(--ui-font-scale))', color: 'var(--ink-light)', marginBottom: 4, display: 'block' }}>{t('类型')}</label>
                  <select value={form.type} onChange={e => setForm(prev => ({ ...prev, type: e.target.value as 'once' | 'cron' }))} style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 'calc(13px * var(--ui-font-scale))', background: 'var(--bg-input)', color: 'var(--ink-deep)' }}>
                    <option value="once">{t('一次性')}</option>
                    <option value="cron">{t('定时 (Cron)')}</option>
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 'calc(12px * var(--ui-font-scale))', color: 'var(--ink-light)', marginBottom: 4, display: 'block' }}>{t('重叠策略')}</label>
                  <select value={form.overlap_policy} onChange={e => setForm(prev => ({ ...prev, overlap_policy: e.target.value as 'skip' | 'queue' }))} style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 'calc(13px * var(--ui-font-scale))', background: 'var(--bg-input)', color: 'var(--ink-deep)' }}>
                    <option value="skip">{t('跳过 (skip)')}</option>
                    <option value="queue">{t('排队 (queue)')}</option>
                  </select>
                </div>
              </div>
              {form.type === 'cron' && (
                <div style={{ display: 'flex', gap: 10 }}>
                  <div style={{ flex: 2 }}>
                    <label style={{ fontSize: 'calc(12px * var(--ui-font-scale))', color: 'var(--ink-light)', marginBottom: 4, display: 'block' }}>{t('Cron 表达式')}</label>
                    <input type="text" value={form.cron_expr} onChange={e => setForm(prev => ({ ...prev, cron_expr: e.target.value }))} placeholder="0 */4 * * *" style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 'calc(13px * var(--ui-font-scale))', background: 'var(--bg-input)', color: 'var(--ink-deep)', fontFamily: 'monospace' }} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: 'calc(12px * var(--ui-font-scale))', color: 'var(--ink-light)', marginBottom: 4, display: 'block' }}>{t('时区')}</label>
                    <select value={form.timezone} onChange={e => setForm(prev => ({ ...prev, timezone: e.target.value }))} style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 'calc(13px * var(--ui-font-scale))', background: 'var(--bg-input)', color: 'var(--ink-deep)' }}>
                      <option value="Asia/Shanghai">Asia/Shanghai</option>
                      <option value="UTC">UTC</option>
                      <option value="America/New_York">America/New_York</option>
                    </select>
                  </div>
                </div>
              )}
            </div>
            {createError && <p style={{ color: 'var(--cinnabar)', fontSize: 'calc(12px * var(--ui-font-scale))', margin: '8px 0' }}>{createError}</p>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button className="btn" onClick={() => setShowCreate(false)}>{t('取消')}</button>
              <button className="btn primary" onClick={handleCreate} disabled={creating}>{creating ? t('创建中...') : t('创建')}</button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
