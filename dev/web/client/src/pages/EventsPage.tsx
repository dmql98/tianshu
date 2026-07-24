import { useState, useEffect } from 'react'
import { useProvidersStore } from '@/stores/providersStore'
import { fetchCharacters } from '@/api/characters'
import { fetchEvents, createEvent, updateEventStatus, deleteEvent, archiveEvent, type EventRecord, type CreateEventInput } from '@/api/events'
import type { Character } from '@/types'

const statusColors: Record<string, string> = {
  pending: 'var(--gold)', running: 'var(--blue)',
  completed: 'var(--jade)', failed: 'var(--cinnabar)', archived: 'var(--ink-faint)',
}

const statusLabels: Record<string, string> = {
  pending: '待处理', running: '运行中', completed: '已完成', failed: '失败', archived: '已归档',
}

const statusIcons: Record<string, string> = {
  pending: '⏳', running: '▶', completed: '✓', failed: '✗', archived: '📦',
}

const sourceColors: Record<string, string> = {
  user: 'var(--blue)', agent: 'var(--purple)', system: 'var(--ink-faint)',
}

const sourceLabels: Record<string, string> = {
  user: '用户', agent: 'Agent', system: '系统',
}

const typeLabels: Record<string, string> = {
  once: '一次性', cron: '定时',
}

export default function EventsPage() {
  const { providers, load: loadProviders } = useProvidersStore()
  const [events, setEvents] = useState<EventRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [filterStatus, setFilterStatus] = useState('')
  const [characters, setCharacters] = useState<Character[]>([])
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')

  const [form, setForm] = useState<CreateEventInput & { model?: string; provider_id?: string; workspace?: string; assigned_group_id?: string; once_mode?: string; scheduled_at_str?: string }>({
    assigned_agent_id: '',
    type: 'once',
    payload: { instruction: '' },
    cron_expr: '',
    source_type: 'user',
    model: '',
    provider_id: '',
    workspace: '',
    assigned_group_id: '',
    once_mode: 'immediate',
    scheduled_at_str: '',
  })

  useEffect(() => {
    loadProviders()
    fetchCharacters().then(setCharacters).catch(() => {})
    loadEvents()
  }, [])

  const loadEvents = async () => {
    setLoading(true)
    try {
      const data = await fetchEvents(filterStatus ? { status: filterStatus } : undefined)
      setEvents(data)
    } catch (err) {
      console.error('Failed to load events:', err)
    } finally {
      setLoading(false)
    }
  }

  const selectedCharGroups = form.assigned_agent_id
    ? characters.find(c => c.id === form.assigned_agent_id)?.groups?.filter(g => g.trim()) || []
    : []

  const selectedProviderModels = form.provider_id
    ? providers.find(p => p.id === form.provider_id)?.models?.filter((m: any) => m.enabled !== false) || []
    : []

  const handleCreate = async () => {
    setCreateError('')
    if (!form.assigned_agent_id) { setCreateError('请选择执行角色'); return }
    if (!form.payload.instruction.trim()) { setCreateError('请输入指令'); return }
    if (form.type === 'cron' && !form.cron_expr?.trim()) { setCreateError('请输入 Cron 表达式'); return }

    setCreating(true)
    try {
      const scheduled_at = form.type === 'once' && form.once_mode === 'custom' && form.scheduled_at_str
        ? new Date(form.scheduled_at_str).getTime()
        : Date.now()

      const evt = await createEvent({
        assigned_agent_id: form.assigned_agent_id,
        assigned_group_id: form.assigned_group_id || undefined,
        model: form.model || undefined,
        provider_id: form.provider_id || undefined,
        workspace: form.workspace || undefined,
        type: form.type,
        cron_expr: form.cron_expr || undefined,
        source_type: 'user',
        payload: { instruction: form.payload.instruction.trim() },
        scheduled_at,
      })
      setEvents(prev => [evt, ...prev])
      setShowCreate(false)
      resetForm()
    } catch (err: any) {
      setCreateError(err.message || '创建失败')
    } finally {
      setCreating(false)
    }
  }

  const resetForm = () => {
    setForm({
      assigned_agent_id: '', type: 'once', payload: { instruction: '' }, cron_expr: '',
      source_type: 'user', model: '', provider_id: '', workspace: '', assigned_group_id: '',
      once_mode: 'immediate', scheduled_at_str: '',
    })
    setCreateError('')
  }

  const handleTrigger = async (evt: EventRecord) => {
    try {
      await updateEventStatus(evt.id, 'running')
      setEvents(prev => prev.map(e => e.id === evt.id ? { ...e, status: 'running' } : e))
    } catch (err) {
      console.error('Failed to trigger event:', err)
    }
  }

  const handleDelete = async (evt: EventRecord) => {
    try {
      await deleteEvent(evt.id)
      setEvents(prev => prev.filter(e => e.id !== evt.id))
    } catch (err) {
      console.error('Failed to delete event:', err)
    }
  }

  const handleRetry = async (evt: EventRecord) => {
    try {
      const updated = await updateEventStatus(evt.id, 'pending', { scheduled_at: Date.now() })
      setEvents(prev => prev.map(e => e.id === evt.id ? updated : e))
    } catch (err) {
      console.error('Failed to retry event:', err)
    }
  }

  const handleArchive = async (evt: EventRecord) => {
    try {
      await archiveEvent(evt.id)
      setEvents(prev => prev.map(e => e.id === evt.id ? { ...e, status: 'archived' } : e))
    } catch (err) {
      console.error('Failed to archive event:', err)
    }
  }

  const payloadPreview = (payload: string): string => {
    try {
      const p = JSON.parse(payload)
      return p.instruction?.slice(0, 80) || payload.slice(0, 80)
    } catch {
      return payload.slice(0, 80)
    }
  }

  const fullPayload = (payload: string): string => {
    try {
      const p = JSON.parse(payload)
      return p.instruction || payload
    } catch {
      return payload
    }
  }

  const timeAgo = (ts: number | null): string => {
    if (!ts) return '-'
    const diff = Date.now() - ts
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return '刚刚'
    if (mins < 60) return `${mins}分钟前`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}小时前`
    const days = Math.floor(hours / 24)
    return `${days}天前`
  }

  const copyId = (id: string) => {
    navigator.clipboard.writeText(id)
  }

  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set())

  const toggleExpand = (id: string) => {
    setExpandedCards(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const statusColumns = ['pending', 'running', 'completed', 'failed', 'archived']

  const groupedByStatus = statusColumns.reduce((acc, status) => {
    acc[status] = events.filter(e => e.status === status)
    return acc
  }, {} as Record<string, EventRecord[]>)

  return (
    <main className="main">
      <div className="page-header">
        <div className="page-header-left">
          <span className="page-title">事件中心</span>
          <span className="page-desc">{events.length} 个事件 · {events.filter(e => e.status === 'running').length} 个正在执行</span>
        </div>
        <div className="header-actions">
          <select value={filterStatus} onChange={e => { setFilterStatus(e.target.value); loadEvents() }} style={{padding:'6px 10px',border:'1px solid var(--border)',borderRadius:6,fontSize:12,background:'var(--bg-input)',color:'var(--ink-deep)'}}>
            <option value="">全部状态</option>
            <option value="pending">待处理</option>
            <option value="running">运行中</option>
            <option value="completed">完成</option>
            <option value="failed">失败</option>
            <option value="archived">已归档</option>
          </select>
          <button className="btn primary" onClick={() => setShowCreate(true)}>+ 新建事件</button>
        </div>
      </div>

      <div className="content">
        {loading ? (
          <div style={{textAlign:'center',padding:'60px 0',color:'var(--ink-faint)'}}>加载中...</div>
        ) : events.length === 0 ? (
          <div style={{textAlign:'center',padding:'60px 0',color:'var(--ink-faint)'}}>暂无事件</div>
        ) : (
          <div className="event-lanes">
            {statusColumns.map(status => (
              <div key={status} className={`lane ${status}`}>
                <div className="lane-header">
                  {statusIcons[status]} {statusLabels[status]} ({groupedByStatus[status]?.length || 0})
                </div>
                <div className="lane-body">
                  {groupedByStatus[status]?.length === 0 ? (
                    <div style={{textAlign:'center',padding:'24px 0',fontSize:12,color:'var(--ink-faint)'}}>暂无</div>
                  ) : (
                    groupedByStatus[status]?.map(evt => {
                      const isExpanded = expandedCards.has(evt.id)
                      return (
                        <div key={evt.id} className={`event-card ${isExpanded ? 'expanded' : ''}`}>
                          <div className="card-header">
                            <span className="source-tag" style={{background: sourceColors[evt.source_type] || 'var(--ink-faint)'}}>
                              {sourceLabels[evt.source_type] || evt.source_type}
                            </span>
                            <span className="type-tag">{typeLabels[evt.type] || evt.type}</span>
                            <button className="btn-expand" onClick={() => toggleExpand(evt.id)}>
                              {isExpanded ? '收起' : '展开'}
                            </button>
                          </div>
                          <div className="event-card-agent">
                            {(() => {
                              const char = characters.find(c => c.id === evt.assigned_agent_id)
                              return (
                                <>
                                  <span className="agent-icon">{char?.icon || '👤'}</span>
                                  <span className="agent-name">{char?.name || evt.assigned_agent_id}</span>
                                </>
                              )
                            })()}
                          </div>
                          <div className={`card-payload ${isExpanded ? 'card-payload-expanded' : ''}`}>
                            {isExpanded ? fullPayload(evt.payload) : payloadPreview(evt.payload)}
                          </div>
                          <div className="card-meta">
                            <span className="time-cell">{timeAgo(evt.created_at)}</span>
                            <button className="btn-copy-id" onClick={() => copyId(evt.id)} title="复制事件 ID">复制 ID</button>
                          </div>
                          {evt.result_summary && evt.status !== 'failed' && (
                            <div className="card-summary">
                              {isExpanded ? evt.result_summary : evt.result_summary.slice(0, 60)}
                            </div>
                          )}
                          {evt.status === 'failed' && evt.error_log && (
                            <div className="card-error">
                              {isExpanded ? evt.error_log : evt.error_log.slice(0, 120)}
                            </div>
                          )}
                          {evt.cron_expr && <div className="event-cron">cron: {evt.cron_expr}</div>}
                          <div className="card-actions">
                            {evt.status === 'pending' && (
                              <>
                                <button className="btn sm primary" onClick={() => handleTrigger(evt)}>▶ 触发</button>
                                <button className="btn sm danger" onClick={() => handleDelete(evt)}>放弃</button>
                              </>
                            )}
                            {evt.status === 'failed' && (
                              <button className="btn sm" onClick={() => handleRetry(evt)}>重试</button>
                            )}
                            {evt.status === 'running' && (
                              <button className="btn sm" onClick={() => {}}>查看</button>
                            )}
                            {(evt.status === 'completed' || evt.status === 'failed') && (
                              <button className="btn sm" onClick={() => handleArchive(evt)}>归档</button>
                            )}
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 创建事件弹窗 */}
      {showCreate && (
        <div className="approval-overlay" onClick={() => setShowCreate(false)}>
          <div className="approval-dialog" style={{maxWidth:560,width:'100%'}} onClick={e => e.stopPropagation()}>
            <h2 style={{fontSize:18,fontWeight:600,marginBottom:16}}>新建事件</h2>
            <div style={{display:'flex',flexDirection:'column',gap:12}}>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                <div>
                  <label style={{fontSize:12,color:'var(--ink-light)',marginBottom:4,display:'block'}}>执行角色 *</label>
                  <select value={form.assigned_agent_id} onChange={e => setForm(prev => ({...prev, assigned_agent_id: e.target.value}))} style={{width:'100%',padding:'7px 10px',border:'1px solid var(--border)',borderRadius:6,fontSize:13,background:'var(--bg-input)',color:'var(--ink-deep)'}}>
                    <option value="">请选择...</option>
                    {characters.map(c => <option key={c.id} value={c.id}>{c.name} ({c.id})</option>)}
                  </select>
                </div>
                <div>
                  <label style={{fontSize:12,color:'var(--ink-light)',marginBottom:4,display:'block'}}>分组</label>
                  <select value={form.assigned_group_id || ''} onChange={e => setForm(prev => ({...prev, assigned_group_id: e.target.value}))} disabled={selectedCharGroups.length === 0} style={{width:'100%',padding:'7px 10px',border:'1px solid var(--border)',borderRadius:6,fontSize:13,background:'var(--bg-input)',color:'var(--ink-deep)',opacity:selectedCharGroups.length === 0 ? 0.5 : 1}}>
                    <option value="">无</option>
                    {selectedCharGroups.map(g => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{fontSize:12,color:'var(--ink-light)',marginBottom:4,display:'block'}}>提供商</label>
                  <select value={form.provider_id || ''} onChange={e => setForm(prev => ({...prev, provider_id: e.target.value, model: ''}))} style={{width:'100%',padding:'7px 10px',border:'1px solid var(--border)',borderRadius:6,fontSize:13,background:'var(--bg-input)',color:'var(--ink-deep)'}}>
                    <option value="">默认</option>
                    {providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{fontSize:12,color:'var(--ink-light)',marginBottom:4,display:'block'}}>模型</label>
                  <select value={form.model || ''} onChange={e => setForm(prev => ({...prev, model: e.target.value}))} disabled={!form.provider_id} style={{width:'100%',padding:'7px 10px',border:'1px solid var(--border)',borderRadius:6,fontSize:13,background:'var(--bg-input)',color:'var(--ink-deep)',opacity:!form.provider_id ? 0.5 : 1}}>
                    <option value="">默认</option>
                    {selectedProviderModels.map(m => <option key={m.id} value={m.id}>{m.name || m.id}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label style={{fontSize:12,color:'var(--ink-light)',marginBottom:4,display:'block'}}>工作区</label>
                <input type="text" value={form.workspace || ''} onChange={e => setForm(prev => ({...prev, workspace: e.target.value}))} placeholder="工作目录路径" style={{width:'100%',padding:'7px 10px',border:'1px solid var(--border)',borderRadius:6,fontSize:13,background:'var(--bg-input)',color:'var(--ink-deep)'}} />
              </div>
              <div>
                <label style={{fontSize:12,color:'var(--ink-light)',marginBottom:4,display:'block'}}>指令 *</label>
                <textarea value={form.payload.instruction} onChange={e => setForm(prev => ({...prev, payload: { instruction: e.target.value }}))} rows={4} placeholder="描述要执行的任务..." style={{width:'100%',padding:'8px 10px',border:'1px solid var(--border)',borderRadius:6,fontSize:13,background:'var(--bg-input)',color:'var(--ink-deep)',resize:'vertical',fontFamily:'inherit'}} />
              </div>
              <div style={{display:'flex',gap:12,alignItems:'flex-end'}}>
                <div style={{flex:1}}>
                  <label style={{fontSize:12,color:'var(--ink-light)',marginBottom:4,display:'block'}}>类型</label>
                  <select value={form.type} onChange={e => setForm(prev => ({...prev, type: e.target.value as 'once' | 'cron' }))} style={{width:'100%',padding:'7px 10px',border:'1px solid var(--border)',borderRadius:6,fontSize:13,background:'var(--bg-input)',color:'var(--ink-deep)'}}>
                    <option value="once">一次性</option>
                    <option value="cron">定时 (Cron)</option>
                  </select>
                </div>
                {form.type === 'once' && (
                  <div>
                    <label style={{fontSize:12,color:'var(--ink-light)',marginBottom:4,display:'block'}}>执行时间</label>
                    <div style={{display:'flex',gap:8}}>
                      <button className={`btn sm ${form.once_mode === 'immediate' ? 'primary' : ''}`} onClick={() => setForm(prev => ({...prev, once_mode: 'immediate'}))}>立即</button>
                      <button className={`btn sm ${form.once_mode === 'custom' ? 'primary' : ''}`} onClick={() => setForm(prev => ({...prev, once_mode: 'custom'}))}>定制</button>
                    </div>
                  </div>
                )}
              </div>
              {form.type === 'once' && form.once_mode === 'custom' && (
                <div>
                  <label style={{fontSize:12,color:'var(--ink-light)',marginBottom:4,display:'block'}}>预约时间</label>
                  <input type="datetime-local" value={form.scheduled_at_str || ''} onChange={e => setForm(prev => ({...prev, scheduled_at_str: e.target.value}))} style={{width:'100%',padding:'7px 10px',border:'1px solid var(--border)',borderRadius:6,fontSize:13,background:'var(--bg-input)',color:'var(--ink-deep)'}} />
                </div>
              )}
              {form.type === 'cron' && (
                <div>
                  <label style={{fontSize:12,color:'var(--ink-light)',marginBottom:4,display:'block'}}>Cron 表达式</label>
                  <input type="text" value={form.cron_expr || ''} onChange={e => setForm(prev => ({...prev, cron_expr: e.target.value}))} placeholder="0 */4 * * *" style={{width:'100%',padding:'7px 10px',border:'1px solid var(--border)',borderRadius:6,fontSize:13,background:'var(--bg-input)',color:'var(--ink-deep)',fontFamily:'monospace'}} />
                </div>
              )}
            </div>
            {createError && <p style={{color:'var(--cinnabar)',fontSize:12,margin:'8px 0'}}>{createError}</p>}
            <div style={{display:'flex',justifyContent:'flex-end',gap:8,marginTop:16}}>
              <button className="btn" onClick={() => setShowCreate(false)}>取消</button>
              <button className="btn primary" onClick={handleCreate} disabled={creating}>{creating ? '创建中...' : '创建'}</button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
