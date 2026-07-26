import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { fetchCharacter, fetchCharacterStats, fetchCharacters, createCharacter, updateCharacter, deleteCharacter } from '@/api/characters'
import { fetchTools } from '@/api/tools'
import { fetchSkills } from '@/api/skills'
import type { Character, CharacterStats } from '@/types'
import type { ToolMeta } from '@/api/tools'
import type { SkillMeta } from '@/api/skills'

const roleLabels: Record<string, string> = { main: '主 Agent', sub: '子 Agent', both: '主 / 子 Agent' }

export default function CharacterDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const isNew = id === 'new'

  const [char, setChar] = useState<Character | null>(null)
  const [loading, setLoading] = useState(!isNew)
  const [activeTab, setActiveTab] = useState('basic')
  const [stats, setStats] = useState<CharacterStats | null>(null)
  const [allTools, setAllTools] = useState<ToolMeta[]>([])
  const [allSkills, setAllSkills] = useState<SkillMeta[]>([])
  const [allChars, setAllChars] = useState<Character[]>([])

  // Basic fields
  const [charId, setCharId] = useState('')
  const [idEdited, setIdEdited] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [avatar, setAvatar] = useState('')
  const [color, setColor] = useState('#6366f1')
  const [enabled, setEnabled] = useState(true)
  const [role, setRole] = useState<Character['role']>('both')
  const [strategy, setStrategy] = useState<'Plan' | 'Ask' | 'Bypass'>('Ask')
  const [stepsEnabled, setStepsEnabled] = useState(false)
  const [maxSteps, setMaxSteps] = useState(10)
  const [groups, setGroups] = useState<string[]>([])
  const [selfEvolution, setSelfEvolution] = useState(false)

  // Content fields
  const [soul, setSoul] = useState('')
  const [userProfile, setUserProfile] = useState('')
  const [memoryContent, setMemoryContent] = useState('')
  const [customPromptEnabled, setCustomPromptEnabled] = useState(false)
  const [customPrompt, setCustomPrompt] = useState('')

  // Memory
  const [memoryEnabled, setMemoryEnabled] = useState(false)
  const [charLimit, setCharLimit] = useState(2000)

  // Tools & Skills
  const [boundTools, setBoundTools] = useState<{ name: string }[]>([])
  const [boundSkills, setBoundSkills] = useState<string[]>([])

  // Groups UI
  const [showNewGroupInput, setShowNewGroupInput] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')

  // Track current ID (may change after rename)
  const [currentId, setCurrentId] = useState(id || '')
  const currentIdRef = useRef(currentId)
  const charIdRef = useRef(charId)
  useEffect(() => { currentIdRef.current = currentId }, [currentId])
  useEffect(() => { charIdRef.current = charId }, [charId])

  // Debounce timer
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Auto-save for existing characters (stable reference via refs)
  const autoSave = useCallback(async (data: Record<string, unknown>) => {
    const cid = currentIdRef.current
    if (!cid || cid === 'new') return
    const newCharId = charIdRef.current.trim()
    try {
      await updateCharacter(cid, data)
      if (newCharId && newCharId !== cid) {
        currentIdRef.current = newCharId
        setCurrentId(newCharId)
        navigate(`/characters/${newCharId}`, { replace: true })
      }
    } catch {
      alert('ID 已存在，请换一个')
    }
  }, [navigate])

  // Debounced version for text fields
  const debouncedAutoSave = useCallback((data: Record<string, unknown>) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => autoSave(data), 500)
  }, [autoSave])

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [])

  // Load character data (edit mode)
  useEffect(() => {
    if (isNew || !id) { setLoading(false); return }
    setLoading(true)
    fetchCharacter(id).then(c => {
      setChar(c)
      setCharId(c.id)
      setCurrentId(c.id)
      setName(c.name)
      setDescription(c.description || '')
      setAvatar(c.avatar || '')
      setColor(c.color || '#6366f1')
      setEnabled(c.enabled ?? true)
      setRole(c.role || 'both')
      setStrategy(c.default_strategy || 'Ask')
      setStepsEnabled(!!c.maxSteps && c.maxSteps < 999)
      setMaxSteps(c.maxSteps && c.maxSteps < 999 ? c.maxSteps : 10)
      setGroups(c.groups ? [...c.groups] : [])
      setSelfEvolution(c.memory?.selfEvolution ?? false)
      setSoul(c.soul ?? '')
      setUserProfile(c.userProfile ?? '')
      setMemoryContent(c.memoryContent ?? '')
      setCustomPromptEnabled(!!c.customPrompt)
      setCustomPrompt(c.customPrompt ?? '')
      setMemoryEnabled(c.memory?.enabled ?? false)
      setCharLimit(c.memory?.charLimit ?? 2000)
      setBoundTools(c.tools || [])
      setBoundSkills(c.skills || [])
    }).catch(() => setChar(null)).finally(() => setLoading(false))
  }, [id, isNew])

  // Load stats, tools, skills, characters list
  useEffect(() => {
    fetchTools().then(d => setAllTools(d.tools)).catch(() => {})
    fetchSkills().then(d => setAllSkills(d.skills)).catch(() => {})
    fetchCharacters().then(setAllChars).catch(() => {})
    if (id && !isNew) fetchCharacterStats(id).then(setStats).catch(() => {})
  }, [id, isNew])

  const boundToolNames = new Set(boundTools.map(t => t.name))
  const unboundTools = allTools.filter(t => !boundToolNames.has(t.name))
  const unboundSkills = allSkills.filter(s => !boundSkills.includes(s.name))

  // Collect all existing groups from all characters
  const allGroups = (() => {
    const g = new Set<string>()
    for (const c of allChars) { if (c.groups) c.groups.forEach(gr => g.add(gr)) }
    groups.forEach(gr => g.add(gr))
    return [...g].sort()
  })()

  function toSlug(text: string): string {
    return text.trim().toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32)
  }

  function timeAgo(ts: number | null | undefined): string {
    if (!ts) return '--'
    const diff = Date.now() - ts
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return '刚刚'
    if (mins < 60) return `${mins} 分钟前`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours} 小时前`
    return `${Math.floor(hours / 24)} 天前`
  }

  const tabs = isNew
    ? [{ id: 'basic', label: '基础' }]
    : [
        { id: 'basic', label: '基础' },
        { id: 'memory', label: '记忆' },
        { id: 'tools', label: '工具' },
        { id: 'skills', label: '技能' },
        { id: 'stats', label: '统计' },
      ]

  function collectFormData() {
    const base: Record<string, unknown> = {
      ...(charId.trim() !== (id || '') ? { id: charId.trim() } : {}),
      name: name.trim(),
      description,
      avatar,
      color,
      enabled,
      role,
      default_strategy: strategy,
      maxSteps: stepsEnabled ? maxSteps : 999,
      groups,
      memory: { enabled: memoryEnabled, selfEvolution, charLimit },
      soul,
      userProfile,
      memoryContent,
      customPrompt: customPromptEnabled ? customPrompt : '',
      tools: boundTools,
      skills: boundSkills,
    }
    return base
  }

  async function handleCreate() {
    if (!name.trim() || !charId.trim()) return
    const data = collectFormData()
    try {
      const created = await createCharacter(data)
      navigate(`/characters/${created.id}`, { replace: true })
    } catch {
      alert('ID 已存在，请换一个')
    }
  }

  async function handleDelete() {
    if (!id || isNew) return
    if (!confirm('确定删除此角色？')) return
    await deleteCharacter(id)
    navigate('/characters')
  }

  function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const dataUrl = ev.target?.result as string
      setAvatar(dataUrl)
      autoSave({ avatar: dataUrl })
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  function toggleGroup(grp: string) {
    const next = groups.includes(grp) ? groups.filter(g => g !== grp) : [...groups, grp]
    setGroups(next)
    autoSave({ groups: next })
  }

  function addNewGroup() {
    const g = newGroupName.trim()
    if (g && !groups.includes(g)) {
      const next = [...groups, g]
      setGroups(next)
      autoSave({ groups: next })
    }
    setNewGroupName('')
    setShowNewGroupInput(false)
  }

  function toggleSkill(name: string) {
    const next = boundSkills.includes(name) ? boundSkills.filter(s => s !== name) : [...boundSkills, name]
    setBoundSkills(next)
    autoSave({ skills: next })
  }

  function addTool(name: string, source?: string) {
    const toolName = source === 'mcp' ? `mcp:${name}` : name
    const next = [...boundTools, { name: toolName }]
    setBoundTools(next)
    autoSave({ tools: next })
  }

  function removeTool(name: string) {
    const next = boundTools.filter(t => t.name !== name)
    setBoundTools(next)
    autoSave({ tools: next })
  }

  if (loading) return <div className="main"><div className="empty-state">加载中...</div></div>
  if (!isNew && !char) return <div className="main"><div className="empty-state">角色未找到</div></div>

  return (
    <div className="main">
      <div className="detail-header">
        <button className="back-btn" onClick={() => navigate('/characters')}>←</button>
        <div className="detail-header-info">
          <h1>{isNew ? '新建角色' : name}</h1>
          {!isNew && id && <p>{id} · {roleLabels[role] || role}</p>}
        </div>
        <div style={{ flex: 1 }}></div>
      </div>

      <div className="detail-body">
        <div className="detail-art">
          <div className="detail-art-img">
            {avatar
              ? <img src={avatar} alt={name} />
              : <span style={{ fontSize: 64 }}>{name?.[0] || '?'}</span>
            }
          </div>
          <div className="detail-actions">
            {!isNew && <button className="detail-btn primary" onClick={() => navigate('/chat')}>开始对话</button>}
            <label className="detail-btn" style={{ cursor: 'pointer' }}>
              上传头像
              <input type="file" accept="image/*" hidden onChange={handleAvatarUpload} />
            </label>
            {!isNew && <button className="detail-btn danger" onClick={handleDelete}>删除角色</button>}
          </div>
        </div>

        <div className="detail-content">
          <div className="detail-tabs">
            {tabs.map(tab => (
              <button
                key={tab.id}
                className={`detail-tab ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* 基础 */}
          <div className={`tab-page ${activeTab === 'basic' ? 'active' : ''}`}>
            <div className="detail-section">
              <div className="detail-section-title">基本信息</div>
              <div className="info-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <div className="info-item" style={{ gridColumn: '1/-1' }}>
                  <div className="info-item-label">角色名称</div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
                    <input value={name} onChange={e => { setName(e.target.value); if (!idEdited) setCharId(toSlug(e.target.value)); debouncedAutoSave({ name: e.target.value }) }} placeholder="输入角色名称" style={{ flex: 1, padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, background: 'var(--bg-input)', color: 'var(--ink-deep)', outline: 'none' }} />
                    <input type="color" value={color} onChange={e => { setColor(e.target.value); autoSave({ color: e.target.value }) }} style={{ width: 32, height: 32, border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', padding: 2, background: 'var(--bg-input)' }} />
                  </div>
                </div>
                <div className="info-item" style={{ gridColumn: '1/-1' }}>
                  <div className="info-item-label">角色简介</div>
                  <textarea value={description} onChange={e => { setDescription(e.target.value); debouncedAutoSave({ description: e.target.value }) }} placeholder="简短描述这个角色" rows={2} style={{ marginTop: 4, width: '100%', padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, background: 'var(--bg-input)', color: 'var(--ink-deep)', outline: 'none', resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' }} />
                </div>
                <div style={{ display: 'flex', gap: 8, gridColumn: '1/-1' }}>
                  <div className="info-item" style={{ flex: 1 }}>
                    <div className="info-item-label">角色 ID</div>
                    <input value={charId} onChange={e => { setCharId(toSlug(e.target.value)); setIdEdited(true) }} onBlur={() => { const trimmed = charId.trim(); if (trimmed && trimmed !== currentId) autoSave({ id: trimmed }) }} placeholder="自定义ID" style={{ marginTop: 4, width: '100%', padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, fontFamily: 'monospace', background: 'var(--bg-input)', color: 'var(--ink-deep)', outline: 'none', boxSizing: 'border-box' }} />
                  </div>
                  <div className="info-item" style={{ flex: 1 }}>
                    <div className="info-item-label">角色类型</div>
                    <select value={role} onChange={e => { setRole(e.target.value as Character['role']); autoSave({ role: e.target.value }) }} style={{ marginTop: 4, width: '100%' }}>
                      <option value="main">主 Agent</option>
                      <option value="sub">子 Agent</option>
                      <option value="both">主/子 Agent</option>
                    </select>
                  </div>
                  <div className="info-item" style={{ flex: 1 }}>
                    <div className="info-item-label">默认策略</div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                      {(['Plan', 'Ask', 'Bypass'] as const).map(s => (
                        <span key={s} className={`strategy-btn ${strategy === s ? 'active' : ''}`} onClick={() => { setStrategy(s); autoSave({ default_strategy: s }) }}>{s}</span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              <div className="tool-list" style={{ marginTop: 12 }}>
                <div className="tool-item">
                  <div className="tool-name">自我进化</div>
                  <div className={`toggle ${selfEvolution ? 'on' : ''}`} onClick={() => { setSelfEvolution(!selfEvolution); autoSave({ memory: { enabled: memoryEnabled, selfEvolution: !selfEvolution, charLimit } }) }}></div>
                </div>
                <div className="tool-item">
                  <div className="tool-name">限制最大步数</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div className={`toggle ${stepsEnabled ? 'on' : ''}`} onClick={() => { setStepsEnabled(!stepsEnabled); autoSave({ maxSteps: !stepsEnabled ? maxSteps : 999 }) }}></div>
                    <span style={{ fontSize: 12, color: 'var(--ink-light)' }}>{stepsEnabled ? `${maxSteps} 步` : '不限制'}</span>
                  </div>
                </div>
                {stepsEnabled && (
                  <div className="tool-item">
                    <div className="tool-name">步数上限</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
                      <input type="range" min={1} max={999} value={maxSteps} onChange={e => { const v = Number(e.target.value); setMaxSteps(v); debouncedAutoSave({ maxSteps: v }) }} style={{ flex: 1, accentColor: 'var(--gold)' }} />
                      <span style={{ fontSize: 12, color: 'var(--ink-deep)', fontWeight: 500, minWidth: 24, textAlign: 'right' }}>{maxSteps}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="detail-section">
              <div className="detail-section-title">分组</div>
              <div className="tag-list">
                {allGroups.map(grp => (
                  <span
                    key={grp}
                    className={`tag ${groups.includes(grp) ? 'on' : ''}`}
                    onClick={() => toggleGroup(grp)}
                  >
                    {grp}
                  </span>
                ))}
                {showNewGroupInput ? (
                  <input
                    value={newGroupName}
                    onChange={e => setNewGroupName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') addNewGroup(); if (e.key === 'Escape') { setShowNewGroupInput(false); setNewGroupName('') } }}
                    onBlur={addNewGroup}
                    placeholder="新分组名"
                    autoFocus
                    style={{ width: 80, padding: '3px 10px', fontSize: 11, border: '1px solid var(--gold)', borderRadius: 6, outline: 'none', background: 'var(--bg-input)', color: 'var(--ink-deep)' }}
                  />
                ) : (
                  <span className="tag" style={{ borderStyle: 'dashed', borderColor: 'var(--border)' }} onClick={() => setShowNewGroupInput(true)}>+</span>
                )}
              </div>
            </div>

            <div className="detail-section">
              <div className="detail-columns">
                <div className="detail-col">
                  <div className="detail-section-title">Soul（人格）</div>
                  <textarea className="md-box" value={soul} placeholder="(未设置)" onChange={e => { setSoul(e.target.value); debouncedAutoSave({ soul: e.target.value }) }} style={{ minHeight: 400, width: '100%', resize: 'vertical' }} />
                </div>
                <div className="detail-col">
                  <div className="detail-section-title">User（用户画像）</div>
                  <textarea className="md-box" value={userProfile} placeholder="(未设置)" onChange={e => { setUserProfile(e.target.value); debouncedAutoSave({ userProfile: e.target.value }) }} style={{ minHeight: 400, width: '100%', resize: 'vertical' }} />
                </div>
              </div>
            </div>

            <div className="detail-section">
              <div className="detail-section-title">自定义提示词</div>
              <div className="tool-item" style={{ border: 'none', padding: '0 0 8px 0' }}>
                <div className="tool-name">启用自定义提示词</div>
                <div className={`toggle ${customPromptEnabled ? 'on' : ''}`} onClick={() => { setCustomPromptEnabled(!customPromptEnabled); autoSave({ customPrompt: !customPromptEnabled ? customPrompt : '' }) }}></div>
              </div>
              {customPromptEnabled ? (
                <textarea className="md-box" value={customPrompt} placeholder="(输入自定义提示词)" onChange={e => { setCustomPrompt(e.target.value); debouncedAutoSave({ customPrompt: e.target.value }) }} style={{ minHeight: 250, width: '100%', resize: 'vertical' }} />
              ) : (
                <div className="md-box" style={{ color: 'var(--ink-faint)' }}>(未设置，将使用默认系统提示词)</div>
              )}
            </div>
          </div>

          {/* 记忆 */}
          <div className={`tab-page ${activeTab === 'memory' ? 'active' : ''}`}>
            <div className="detail-section">
              <div className="detail-section-title">记忆设置</div>
              <div className="tool-list">
                <div className="tool-item">
                  <div className="tool-name">启用记忆</div>
                  <div className={`toggle ${memoryEnabled ? 'on' : ''}`} onClick={() => { setMemoryEnabled(!memoryEnabled); autoSave({ memory: { enabled: !memoryEnabled, selfEvolution, charLimit } }) }}></div>
                </div>
                <div className="tool-item">
                  <div className="tool-name">记忆字符上限</div>
                  <input type="number" min={0} step={100} value={charLimit} onChange={e => { const v = Number(e.target.value); setCharLimit(v); autoSave({ memory: { enabled: memoryEnabled, selfEvolution, charLimit: v } }) }} style={{ width: 120, marginTop: 4 }} />
                </div>
              </div>
            </div>
            <div className="detail-section">
              <div className="detail-section-title">Memory（记忆内容）</div>
              <textarea className="md-box" value={memoryContent} placeholder="(空)" onChange={e => { setMemoryContent(e.target.value); debouncedAutoSave({ memoryContent: e.target.value }) }} style={{ minHeight: 450, width: '100%', resize: 'vertical' }} />
            </div>
          </div>

          {/* 工具 */}
          <div className={`tab-page ${activeTab === 'tools' ? 'active' : ''}`}>
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="detail-section-title">已激活工具 ({boundTools.length})</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {boundTools.map(t => {
                    const meta = allTools.find(at => at.name === t.name)
                    return (
                      <div key={t.name} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, background: 'rgba(42,157,92,0.03)' }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6 }}>
                          <div className="tool-name" style={{ fontSize: 14, fontWeight: 600 }}>{t.name.replace(/^mcp:/, '')}</div>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                            <span className={`tool-source ${t.name.startsWith('mcp:') ? 'mcp' : 'builtin'}`} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4 }}>{t.name.startsWith('mcp:') ? 'MCP' : '内置'}</span>
                            <button onClick={() => removeTool(t.name)} title="移出" style={{ cursor: 'pointer', width: 28, height: 28, borderRadius: 6, border: '1px solid #ef4444', background: 'transparent', fontSize: 18, lineHeight: 1, color: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>×</button>
                          </div>
                        </div>
                        {meta && <div style={{ fontSize: 12, color: 'var(--ink-light)', lineHeight: 1.4 }}>{meta.description}</div>}
                      </div>
                    )
                  })}
                  {boundTools.length === 0 && (
                    <div style={{ fontSize: 12, color: 'var(--ink-faint)', padding: 8 }}>暂无已激活工具</div>
                  )}
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="detail-section-title">未激活工具 ({unboundTools.length})</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {unboundTools.slice(0, 20).map(t => (
                    <div key={t.name} style={{ border: '1px dashed var(--border)', borderRadius: 10, padding: 12, background: 'var(--bg-input)' }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6 }}>
                        <div className="tool-name" style={{ fontSize: 14, fontWeight: 600 }}>{t.name}</div>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <span className={`tool-source ${t.source}`} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4 }}>{t.source === 'mcp' ? 'MCP' : '内置'}</span>
                          <button onClick={() => addTool(t.name, t.source)} title="激活" style={{ cursor: 'pointer', width: 28, height: 28, borderRadius: 6, border: '1px solid var(--jade)', background: 'transparent', fontSize: 20, lineHeight: 1, color: 'var(--jade)', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>+</button>
                        </div>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--ink-light)', lineHeight: 1.4 }}>{t.description}</div>
                    </div>
                  ))}
                  {unboundTools.length === 0 && (
                    <div style={{ fontSize: 12, color: 'var(--ink-faint)', padding: 8 }}>所有工具已激活</div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* 技能 */}
          <div className={`tab-page ${activeTab === 'skills' ? 'active' : ''}`}>
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="detail-section-title">已激活技能 ({boundSkills.length})</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {boundSkills.map(name => {
                    const meta = allSkills.find(s => s.name === name)
                    return (
                      <div key={name} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, background: 'rgba(42,157,92,0.03)' }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6 }}>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            <div className="tool-name" style={{ fontSize: 14, fontWeight: 600 }}>{name}</div>
                            {meta && <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: 'rgba(124,58,237,0.1)', color: '#7c3aed' }}>{meta.category}</span>}
                          </div>
                          <button onClick={() => toggleSkill(name)} title="移出" style={{ cursor: 'pointer', width: 28, height: 28, borderRadius: 6, border: '1px solid #ef4444', background: 'transparent', fontSize: 18, lineHeight: 1, color: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>×</button>
                        </div>
                        {meta && <div style={{ fontSize: 12, color: 'var(--ink-light)', lineHeight: 1.4 }}>{meta.description}</div>}
                      </div>
                    )
                  })}
                  {boundSkills.length === 0 && (
                    <div style={{ fontSize: 12, color: 'var(--ink-faint)', padding: 8 }}>暂无已激活技能</div>
                  )}
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="detail-section-title">未激活技能 ({unboundSkills.length})</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {unboundSkills.slice(0, 20).map(s => (
                    <div key={s.name} style={{ border: '1px dashed var(--border)', borderRadius: 10, padding: 12, background: 'var(--bg-input)' }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6 }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <div className="tool-name" style={{ fontSize: 14, fontWeight: 600 }}>{s.name}</div>
                          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: 'rgba(124,58,237,0.1)', color: '#7c3aed' }}>{s.category}</span>
                        </div>
                        <button onClick={() => toggleSkill(s.name)} title="激活" style={{ cursor: 'pointer', width: 28, height: 28, borderRadius: 6, border: '1px solid var(--jade)', background: 'transparent', fontSize: 20, lineHeight: 1, color: 'var(--jade)', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>+</button>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--ink-light)', lineHeight: 1.4 }}>{s.description}</div>
                    </div>
                  ))}
                  {unboundSkills.length === 0 && (
                    <div style={{ fontSize: 12, color: 'var(--ink-faint)', padding: 8 }}>所有技能已激活</div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* 统计 */}
          <div className={`tab-page ${activeTab === 'stats' ? 'active' : ''}`}>
            <div className="detail-section">
              <div className="detail-section-title">使用概览</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <div className="info-item"><div className="info-item-label">会话数</div><div className="info-item-value">{stats?.sessionCount ?? '--'}</div></div>
                <div className="info-item"><div className="info-item-label">成功率</div><div className="info-item-value">--</div></div>
                <div className="info-item"><div className="info-item-label">最近活跃</div><div className="info-item-value">{stats?.lastActive ? timeAgo(stats.lastActive) : '--'}</div></div>
              </div>
            </div>
            <div className="detail-section">
              <div className="detail-section-title">调用趋势</div>
              <div className="empty-state" style={{ padding: 20 }}>
                <div className="empty-hint">需要后端打点后展示</div>
              </div>
            </div>
          </div>

          {/* 新建角色时显示创建按钮 */}
          {isNew && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '16px 0', borderTop: '1px solid var(--border)', marginTop: 16 }}>
              <button className="detail-btn primary" onClick={handleCreate}>创建</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
