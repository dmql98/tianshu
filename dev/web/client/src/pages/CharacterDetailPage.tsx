import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { fetchCharacter, fetchCharacterStats, fetchCharacters, createCharacter, updateCharacter, updateCharacterSkillBinding, deleteCharacter } from '@/api/characters'
import { fetchTools } from '@/api/tools'
import { fetchSkillPackages } from '@/api/skills'
import { normalizeStrategy, STRATEGIES, type Character, type CharacterStats, type Strategy } from '@/types'
import type { ToolMeta } from '@/api/tools'
import type { SkillPackageMeta } from '@/api/skills'
import CharacterSkinBinder from '@/features/skins/CharacterSkinBinder'
import CharacterRenderer from '@/features/characters/CharacterRenderer'
import { dedupeToolBindings, getUnboundTools, toToolBindingName } from '@/features/characters/toolBindings'
import EditField from '@/components/EditField'
import type { I18nState } from '@/i18n'
import { useI18n } from '@/i18n'

type T = I18nState['t']

const roleLabels: Record<string, string> = { main: '主 Agent', sub: '子 Agent', both: '主 / 子 Agent' }

export default function CharacterDetailPage() {
  const t = useI18n()
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  // `/characters/new` is a static route, so useParams has no `id`; detect it
  // from the pathname instead.
  const isNew = location.pathname.endsWith('/characters/new')
  const navigate = useNavigate()

  const [char, setChar] = useState<Character | null>(null)
  const [loading, setLoading] = useState(!isNew)
  const [activeTab, setActiveTab] = useState('basic')
  const [stats, setStats] = useState<CharacterStats | null>(null)
  const [allTools, setAllTools] = useState<ToolMeta[]>([])
  const [allSkills, setAllSkills] = useState<SkillPackageMeta[]>([])
  const [allChars, setAllChars] = useState<Character[]>([])

  // Basic fields
  const [charId, setCharId] = useState('')
  const [idEdited, setIdEdited] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState('#6366f1')
  const [enabled, setEnabled] = useState(true)
  const [role, setRole] = useState<Character['role']>('both')
  const [strategy, setStrategy] = useState<Strategy>('Ask Risky')
  const [stepsEnabled, setStepsEnabled] = useState(false)
  const [maxSteps, setMaxSteps] = useState(50)
  const [rpSoft, setRpSoft] = useState<string>('')
  const [rpGrace, setRpGrace] = useState<string>('')
  const [rpAutoContinuation, setRpAutoContinuation] = useState<'inherit' | 'enabled' | 'disabled'>('inherit')
  const [rpMaxAuto, setRpMaxAuto] = useState<string>('')
  const [rpEffective, setRpEffective] = useState<Character['runPolicy'] | undefined>(undefined)
  const [groups, setGroups] = useState<string[]>([])
  const [helpers, setHelpers] = useState<string[]>(['worker'])
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
  const boundToolsRef = useRef<{ name: string }[]>([])
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
      alert(t('ID 已存在，请换一个'))
    }
  }, [navigate])

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
      setColor(c.color || '#6366f1')
      setEnabled(c.enabled ?? true)
      setRole(c.role || 'both')
      setStrategy(normalizeStrategy(c.default_strategy))
      setStepsEnabled(!!c.maxSteps && c.maxSteps < 999)
      setMaxSteps(c.maxSteps && c.maxSteps < 999 ? c.maxSteps : 50)
      // Run policy (new) — configured values from the server preview.
      const rp = c.runPolicy?.configured
      setRpSoft(rp?.softTurns != null ? String(rp.softTurns) : '')
      setRpGrace(rp?.graceTurns != null ? String(rp.graceTurns) : '')
      setRpAutoContinuation(rp?.autoContinuation ?? 'inherit')
      setRpMaxAuto(rp?.maxAutoContinuations != null ? String(rp.maxAutoContinuations) : '')
      setRpEffective(c.runPolicy)
      setGroups(c.groups ? [...c.groups] : [])
      setHelpers(c.helpers?.length ? [...c.helpers] : ['worker'])
      setSelfEvolution(c.memory?.selfEvolution ?? false)
      setSoul(c.soul ?? '')
      setUserProfile(c.userProfile ?? '')
      setMemoryContent(c.memoryContent ?? '')
      setCustomPromptEnabled(!!c.customPrompt)
      setCustomPrompt(c.customPrompt ?? '')
      setMemoryEnabled(c.memory?.enabled ?? false)
      setCharLimit(c.memory?.charLimit ?? 2000)
      const tools = dedupeToolBindings(c.tools || [])
      boundToolsRef.current = tools
      setBoundTools(tools)
      setBoundSkills(c.skillBindings?.map(binding => binding.packageId) || c.skills || [])
    }).catch(() => setChar(null)).finally(() => setLoading(false))
  }, [id, isNew])

  // Load stats, tools, skills, characters list
  useEffect(() => {
    fetchTools().then(d => setAllTools(d.tools)).catch(() => {})
    fetchSkillPackages().then(d => setAllSkills(d.packages)).catch(() => {})
    fetchCharacters().then(setAllChars).catch(() => {})
    if (id && !isNew) fetchCharacterStats(id).then(setStats).catch(() => {})
  }, [id, isNew])

  const unboundTools = getUnboundTools(allTools, boundTools)
  const unboundSkills = allSkills.filter(s => !boundSkills.includes(s.id))

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

  function timeAgo(ts: number | null | undefined, t: T): string {
    if (!ts) return '--'
    const diff = Date.now() - ts
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return t('刚刚')
    if (mins < 60) return t('{n} 分钟前', { n: mins })
    const hours = Math.floor(mins / 60)
    if (hours < 24) return t('{n} 小时前', { n: hours })
    return t('{n} 天前', { n: Math.floor(hours / 24) })
  }

  const tabs = isNew
    ? [{ id: 'basic', label: t('基础') }]
    : [
        { id: 'basic', label: t('基础') },
        { id: 'visual', label: t('视觉与动画') },
        { id: 'memory', label: t('记忆') },
        { id: 'tools', label: t('工具') },
        { id: 'skills', label: t('技能') },
        { id: 'stats', label: t('统计') },
      ]

  function collectFormData() {
    const base: Record<string, unknown> = {
      ...(charId.trim() !== (id || '') ? { id: charId.trim() } : {}),
      name: name.trim(),
      description,
      color,
      enabled,
      role,
      default_strategy: strategy,
      groups,
      helpers,
      memory: { enabled: memoryEnabled, selfEvolution, charLimit },
      soul,
      userProfile,
      memoryContent,
      customPrompt: customPromptEnabled ? customPrompt : '',
      tools: boundTools,
      skills: boundSkills,
      skillBindings: boundSkills.map(packageId => ({ packageId, enabled: true, preloadSkills: [] })),
    }
    // Run policy (replaces the legacy maxSteps toggle, §13.2).
    const rp: Record<string, unknown> = { version: 1 }
    if (rpSoft.trim() !== '') rp.softTurns = clampInt(rpSoft, 1, 999)
    if (rpGrace.trim() !== '') rp.graceTurns = clampInt(rpGrace, 0, 999)
    if (rpAutoContinuation !== 'inherit') rp.autoContinuation = rpAutoContinuation
    if (rpMaxAuto.trim() !== '') rp.maxAutoContinuations = clampInt(rpMaxAuto, 0, 50)
    if (Object.keys(rp).length > 1) base.runPolicy = rp
    else base.runPolicy = null
    return base
  }

  function clampInt(v: string, min: number, max: number): number {
    const n = Number(v)
    if (!Number.isFinite(n)) return min
    return Math.min(max, Math.max(min, Math.trunc(n)))
  }

  /** Persist a run-policy override; null clears it ("恢复继承"). */
  async function saveRunPolicy(rp: Record<string, unknown> | null) {
    const cid = currentIdRef.current
    if (!cid || cid === 'new') return
    try {
      const updated = await updateCharacter(cid, { runPolicy: rp as any })
      setRpEffective(updated.runPolicy as Character['runPolicy'])
    } catch {
      alert(t('运行策略保存失败'))
    }
  }

  function autoSaveRunPolicy() {
    const rp: Record<string, unknown> = { version: 1 }
    if (rpSoft.trim() !== '') rp.softTurns = clampInt(rpSoft, 1, 999)
    if (rpGrace.trim() !== '') rp.graceTurns = clampInt(rpGrace, 0, 999)
    if (rpAutoContinuation !== 'inherit') rp.autoContinuation = rpAutoContinuation
    if (rpMaxAuto.trim() !== '') rp.maxAutoContinuations = clampInt(rpMaxAuto, 0, 50)
    saveRunPolicy(Object.keys(rp).length > 1 ? rp : null)
  }

  async function handleCreate() {
    if (!name.trim() || !charId.trim()) return
    const data = collectFormData()
    try {
      const created = await createCharacter(data)
      navigate(`/characters/${created.id}`, { replace: true })
    } catch {
      alert(t('ID 已存在，请换一个'))
    }
  }

  async function handleDelete() {
    if (!id || isNew) return
    if (!confirm(t('确定删除此角色？'))) return
    await deleteCharacter(id)
    navigate('/characters')
  }

  function toggleGroup(grp: string) {
    const next = groups.includes(grp) ? groups.filter(g => g !== grp) : [...groups, grp]
    setGroups(next)
    autoSave({ groups: next })
  }

  function toggleHelper(id: string) {
    const next = helpers.includes(id) ? helpers.filter(h => h !== id) : [...helpers, id]
    setHelpers(next)
    autoSave({ helpers: next })
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

  async function toggleSkill(name: string) {
    const isBound = boundSkills.includes(name)
    const next = isBound ? boundSkills.filter(s => s !== name) : [...boundSkills, name]
    setBoundSkills(next)
    const cid = currentIdRef.current
    if (cid && cid !== 'new') {
      try {
        await updateCharacterSkillBinding(cid, isBound ? 'unbind' : 'bind', name)
      } catch {
        setBoundSkills(boundSkills)
        alert(t('技能包绑定更新失败'))
      }
    }
  }

  function addTool(name: string, source?: string) {
    const toolName = toToolBindingName(name, source)
    const current = dedupeToolBindings(boundToolsRef.current)
    if (current.some(tool => tool.name === toolName)) return
    const next = [...current, { name: toolName }]
    boundToolsRef.current = next
    setBoundTools(next)
    autoSave({ tools: next })
  }

  function removeTool(name: string) {
    const next = dedupeToolBindings(boundToolsRef.current).filter(t => t.name !== name)
    boundToolsRef.current = next
    setBoundTools(next)
    autoSave({ tools: next })
  }

  if (loading) return <div className="main"><div className="empty-state">{t('加载中...')}</div></div>
  if (!isNew && !char) return <div className="main"><div className="empty-state">{t('角色未找到')}</div></div>

  return (
    <div className="main">
      <div className="detail-header">
        <button className="back-btn" onClick={() => navigate('/characters')}>←</button>
        <div className="detail-header-info">
          <h1>{isNew ? t('新建角色') : name}</h1>
          {!isNew && id && <p>{id} · {t(roleLabels[role] || role)}</p>}
        </div>
        <div style={{ flex: 1 }}></div>
      </div>

      <div className="detail-body">
        <div className="detail-art">
          <div className="detail-art-img">
            <CharacterRenderer
              characterId={currentId}
              name={name}
              mode="portrait"
              className="character-renderer-detail"
            />
          </div>
          <div className="detail-actions">
            {!isNew && <button className="detail-btn primary" onClick={() => navigate('/chat')}>{t('开始对话')}</button>}
            {!isNew && <button className="detail-btn danger" onClick={handleDelete}>{t('删除角色')}</button>}
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
              <div className="detail-section-title">{t('基本信息')}</div>
              <div className="info-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <div className="info-item" style={{ gridColumn: '1/-1' }}>
                  <EditField
                    label={t('角色名称')}
                    value={name}
                    onSave={v => {
                      const trimmed = v.trim()
                      setName(trimmed)
                      if (!idEdited) setCharId(toSlug(trimmed))
                      autoSave({ name: trimmed })
                    }}
                    renderInput={(v, onChange) => (
                      <input value={v} onChange={e => onChange(e.target.value)} placeholder={t('输入角色名称')} style={{ flex: 1, padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 'calc(13px * var(--ui-font-scale))', background: 'var(--bg-input)', color: 'var(--ink-deep)', outline: 'none', width: '100%', boxSizing: 'border-box' }} />
                    )}
                  />
                </div>
                <div className="info-item" style={{ gridColumn: '1/-1' }}>
                  <EditField
                    label={t('角色颜色')}
                    value={color}
                    onSave={v => { setColor(v); autoSave({ color: v }) }}
                    renderInput={(v, onChange) => (
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input type="color" value={v} onChange={e => onChange(e.target.value)} style={{ width: 36, height: 32, border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', padding: 2, background: 'var(--bg-input)' }} />
                        <input value={v} onChange={e => onChange(e.target.value)} style={{ flex: 1, padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 'calc(13px * var(--ui-font-scale))', background: 'var(--bg-input)', color: 'var(--ink-deep)', outline: 'none' }} />
                      </div>
                    )}
                    display={<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 20, height: 20, borderRadius: 4, background: color, border: '1px solid var(--border)', display: 'inline-block' }} />
                      <span style={{ fontSize: 'calc(13px * var(--ui-font-scale))', color: 'var(--ink-mid)', fontFamily: 'monospace' }}>{color}</span>
                    </div>}
                  />
                </div>
                <div className="info-item" style={{ gridColumn: '1/-1' }}>
                  <EditField
                    label={t('角色简介')}
                    value={description}
                    onSave={v => { setDescription(v); autoSave({ description: v }) }}
                    renderInput={(v, onChange) => (
                      <textarea value={v} onChange={e => onChange(e.target.value)} placeholder={t('简短描述这个角色')} rows={2} style={{ marginTop: 4, width: '100%', padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 'calc(13px * var(--ui-font-scale))', background: 'var(--bg-input)', color: 'var(--ink-deep)', outline: 'none', resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' }} />
                    )}
                  />
                </div>
                <div style={{ display: 'flex', gap: 8, gridColumn: '1/-1' }}>
                  <div className="info-item" style={{ flex: 1 }}>
                    <EditField
                      label={t('角色 ID')}
                      value={charId}
                      onSave={v => {
                        const trimmed = toSlug(v)
                        setCharId(trimmed)
                        setIdEdited(true)
                        if (trimmed && trimmed !== currentId) autoSave({ id: trimmed })
                      }}
                      renderInput={(v, onChange) => (
                        <input value={v} onChange={e => onChange(e.target.value)} placeholder={t('自定义ID')} style={{ marginTop: 4, width: '100%', padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 'calc(13px * var(--ui-font-scale))', fontFamily: 'monospace', background: 'var(--bg-input)', color: 'var(--ink-deep)', outline: 'none', boxSizing: 'border-box' }} />
                      )}
                    />
                  </div>
                  <div className="info-item" style={{ flex: 1 }}>
                    <EditField
                      label={t('角色类型')}
                      value={role}
                      onSave={v => { setRole(v as Character['role']); autoSave({ role: v }) }}
                      renderInput={(v, onChange) => (
                        <select value={v} onChange={e => onChange(e.target.value)} style={{ marginTop: 4, width: '100%', padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 'calc(13px * var(--ui-font-scale))', background: 'var(--bg-input)', color: 'var(--ink-deep)', outline: 'none', fontFamily: 'inherit' }}>
                          <option value="main">{t('主 Agent')}</option>
                          <option value="sub">{t('子 Agent')}</option>
                          <option value="both">{t('主/子 Agent')}</option>
                        </select>
                      )}
                      display={<div style={{ marginTop: 4, fontSize: 'calc(13px * var(--ui-font-scale))', color: 'var(--ink-mid)' }}>{t(roleLabels[role] || role)}</div>}
                    />
                  </div>
                  <div className="info-item" style={{ flex: 1 }}>
                    <div className="info-item-label">{t('默认审批模式')}</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                      {STRATEGIES.map(s => (
                        <span key={s} className={`strategy-btn ${strategy === s ? 'active' : ''}`} onClick={() => { setStrategy(s); autoSave({ default_strategy: s }) }}>{t(s)}</span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              <div className="tool-list" style={{ marginTop: 12 }}>
                <div className="tool-item">
                  <div className="tool-name">{t('自我进化')}</div>
                  <div className={`toggle ${selfEvolution ? 'on' : ''}`} onClick={() => { setSelfEvolution(!selfEvolution); autoSave({ memory: { enabled: memoryEnabled, selfEvolution: !selfEvolution, charLimit } }) }}></div>
                </div>
                <div className="tool-item" style={{ alignItems: 'flex-start', flexDirection: 'column', gap: 8, padding: '12px 0' }}>
                  <div className="tool-name">{t('运行策略')}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, width: '100%' }}>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 'calc(11px * var(--ui-font-scale))', color: 'var(--ink-light)' }}>
                      {t('收敛起始轮次（空=继承）')}
                      <input
                        type="number" min={1} max={999} value={rpSoft} placeholder={t('继承')}
                        onChange={e => setRpSoft(e.target.value)}
                        onBlur={autoSaveRunPolicy}
                        style={{ padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-input)', color: 'var(--ink-deep)', fontSize: 'calc(12px * var(--ui-font-scale))' }}
                      />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 'calc(11px * var(--ui-font-scale))', color: 'var(--ink-light)' }}>
                      {t('宽限轮次（空=继承）')}
                      <input
                        type="number" min={0} max={999} value={rpGrace} placeholder={t('继承')}
                        onChange={e => setRpGrace(e.target.value)}
                        onBlur={autoSaveRunPolicy}
                        style={{ padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-input)', color: 'var(--ink-deep)', fontSize: 'calc(12px * var(--ui-font-scale))' }}
                      />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 'calc(11px * var(--ui-font-scale))', color: 'var(--ink-light)' }}>
                      {t('自动续跑')}
                      <select
                        value={rpAutoContinuation}
                        onChange={e => { setRpAutoContinuation(e.target.value as any); autoSaveRunPolicy() }}
                        style={{ padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-input)', color: 'var(--ink-deep)', fontSize: 'calc(12px * var(--ui-font-scale))', fontFamily: 'inherit' }}
                      >
                        <option value="inherit">{t('继承系统')}</option>
                        <option value="enabled">{t('允许')}</option>
                        <option value="disabled">{t('禁止')}</option>
                      </select>
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 'calc(11px * var(--ui-font-scale))', color: 'var(--ink-light)' }}>
                      {t('最多自动续跑（空=继承）')}
                      <input
                        type="number" min={0} max={50} value={rpMaxAuto} placeholder={t('继承')}
                        onChange={e => setRpMaxAuto(e.target.value)}
                        onBlur={autoSaveRunPolicy}
                        style={{ padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-input)', color: 'var(--ink-deep)', fontSize: 'calc(12px * var(--ui-font-scale))' }}
                      />
                    </label>
                  </div>
                  {rpEffective?.effectivePreview && (
                    <div style={{ fontSize: 'calc(11px * var(--ui-font-scale))', color: 'var(--ink-mid)', background: 'rgba(42,157,92,0.05)', border: '1px solid rgba(42,157,92,0.15)', borderRadius: 8, padding: '6px 10px', width: '100%', boxSizing: 'border-box' }}>
                      {t('当前有效')}：{rpEffective.effectivePreview.softTurns} + {rpEffective.effectivePreview.graceTurns} {t('轮宽限')} · {t('自动续跑')} {rpEffective.effectivePreview.autoContinuation ? t('开') : t('关')}
                      {rpEffective.constrainedFields && rpEffective.constrainedFields.length > 0 && (
                        <div style={{ color: 'var(--cinnabar)', marginTop: 2 }}>{t('受限字段')}：{rpEffective.constrainedFields.join('、')}（{t('被系统上限约束')}）</div>
                      )}
                    </div>
                  )}
                  {rpEffective?.configured == null && (
                    <button
                      className="btn sm"
                      onClick={() => { setRpSoft(''); setRpGrace(''); setRpAutoContinuation('inherit'); setRpMaxAuto(''); saveRunPolicy(null) }}
                      style={{ fontSize: 'calc(11px * var(--ui-font-scale))' }}
                    >
                      {t('恢复继承')}
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="detail-section">
              <div className="detail-section-title">{t('分组')}</div>
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
                    placeholder={t('新分组名')}
                    autoFocus
                    style={{ width: 80, padding: '3px 10px', fontSize: 'calc(11px * var(--ui-font-scale))', border: '1px solid var(--gold)', borderRadius: 6, outline: 'none', background: 'var(--bg-input)', color: 'var(--ink-deep)' }}
                  />
                ) : (
                  <span className="tag" style={{ borderStyle: 'dashed', borderColor: 'var(--border)' }} onClick={() => setShowNewGroupInput(true)}>+</span>
                )}
              </div>
            </div>

            <div className="detail-section">
              <div className="detail-section-title">{t('工作帮手')}</div>
              <div style={{ fontSize: 'calc(11px * var(--ui-font-scale))', color: 'var(--ink-light)', marginBottom: 8 }}>
                {t('该角色新会话默认可委托的角色（可含自己与 worker）。在会话侧边「帮手栏」可再单独调整。')}
              </div>
              <div className="tag-list">
                {allChars.map(c => (
                  <span
                    key={c.id}
                    className={`tag ${helpers.includes(c.id) ? 'on' : ''}`}
                    title={c.description}
                    onClick={() => toggleHelper(c.id)}
                  >
                    {c.name}
                  </span>
                ))}
              </div>
            </div>

            <div className="detail-section">
              <div className="detail-columns">
                <div className="detail-col">
                  <EditField
                    label="Soul（人格）"
                    value={soul}
                    onSave={v => { setSoul(v); autoSave({ soul: v }) }}
                    renderInput={(v, onChange) => (
                      <textarea className="md-box" value={v} placeholder={t('(未设置)')} onChange={e => onChange(e.target.value)} style={{ minHeight: 400, width: '100%', resize: 'vertical' }} />
                    )}
                    display={<div className="md-box" style={{ minHeight: 400, color: soul ? 'var(--ink-mid)' : 'var(--ink-faint)' }}>{soul || t('(未设置)')}</div>}
                  />
                </div>
                <div className="detail-col">
                  <EditField
                    label="User（用户画像）"
                    value={userProfile}
                    onSave={v => { setUserProfile(v); autoSave({ userProfile: v }) }}
                    renderInput={(v, onChange) => (
                      <textarea className="md-box" value={v} placeholder={t('(未设置)')} onChange={e => onChange(e.target.value)} style={{ minHeight: 400, width: '100%', resize: 'vertical' }} />
                    )}
                    display={<div className="md-box" style={{ minHeight: 400, color: userProfile ? 'var(--ink-mid)' : 'var(--ink-faint)' }}>{userProfile || t('(未设置)')}</div>}
                  />
                </div>
              </div>
            </div>

            <div className="detail-section">
              <div className="detail-section-title">{t('自定义提示词')}</div>
              <div className="tool-item" style={{ border: 'none', padding: '0 0 8px 0' }}>
                <div className="tool-name">{t('启用自定义提示词')}</div>
                <div className={`toggle ${customPromptEnabled ? 'on' : ''}`} onClick={() => { setCustomPromptEnabled(!customPromptEnabled); autoSave({ customPrompt: !customPromptEnabled ? customPrompt : '' }) }}></div>
              </div>
              {customPromptEnabled ? (
                <EditField
                  label={t('自定义提示词内容')}
                  value={customPrompt}
                  onSave={v => { setCustomPrompt(v); autoSave({ customPrompt: v }) }}
                  renderInput={(v, onChange) => (
                    <textarea className="md-box" value={v} placeholder={t('(输入自定义提示词)')} onChange={e => onChange(e.target.value)} style={{ minHeight: 250, width: '100%', resize: 'vertical' }} />
                  )}
                  display={<div className="md-box" style={{ minHeight: 250, color: customPrompt ? 'var(--ink-mid)' : 'var(--ink-faint)' }}>{customPrompt || t('(未设置)')}</div>}
                />
              ) : (
                <div className="md-box" style={{ color: 'var(--ink-faint)' }}>{t('(未设置，将使用默认系统提示词)')}</div>
              )}
            </div>
          </div>

          {/* 视觉与动画（绑定皮肤） */}
          <div className={`tab-page ${activeTab === 'visual' ? 'active' : ''}`}>
            {char && (
              <CharacterSkinBinder
                characterId={char.id}
                skinId={char.skinId}
                name={char.name}
              />
            )}
          </div>

          {/* 记忆 */}
          <div className={`tab-page ${activeTab === 'memory' ? 'active' : ''}`}>
            <div className="detail-section">
              <div className="detail-section-title">{t('记忆设置')}</div>
              <div className="tool-list">
                <div className="tool-item">
                  <div className="tool-name">{t('启用记忆')}</div>
                  <div className={`toggle ${memoryEnabled ? 'on' : ''}`} onClick={() => { setMemoryEnabled(!memoryEnabled); autoSave({ memory: { enabled: !memoryEnabled, selfEvolution, charLimit } }) }}></div>
                </div>
                <div className="tool-item">
                  <div className="tool-name">{t('记忆字符上限')}</div>
                  <EditField
                    value={String(charLimit)}
                    onSave={v => { const n = Number(v); const limit = Number.isFinite(n) && n >= 0 ? n : 0; setCharLimit(limit); autoSave({ memory: { enabled: memoryEnabled, selfEvolution, charLimit: limit } }) }}
                    renderInput={(v, onChange) => (
                      <input type="number" min={0} step={100} value={v} onChange={e => onChange(e.target.value)} style={{ width: 120, marginTop: 4, padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 'calc(13px * var(--ui-font-scale))', background: 'var(--bg-input)', color: 'var(--ink-deep)', outline: 'none' }} />
                    )}
                    display={<div style={{ fontSize: 'calc(13px * var(--ui-font-scale))', color: 'var(--ink-mid)' }}>{charLimit}</div>}
                  />
                </div>
              </div>
            </div>
            <div className="detail-section">
              <EditField
                label="Memory（记忆内容）"
                value={memoryContent}
                onSave={v => { setMemoryContent(v); autoSave({ memoryContent: v }) }}
                renderInput={(v, onChange) => (
                  <textarea className="md-box" value={v} placeholder={t('(空)')} onChange={e => onChange(e.target.value)} style={{ minHeight: 450, width: '100%', resize: 'vertical' }} />
                )}
                display={<div className="md-box" style={{ minHeight: 450, color: memoryContent ? 'var(--ink-mid)' : 'var(--ink-faint)' }}>{memoryContent || t('(空)')}</div>}
              />
            </div>
          </div>

          {/* 工具 */}
          <div className={`tab-page ${activeTab === 'tools' ? 'active' : ''}`}>
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="detail-section-title">{t('已激活工具')} ({boundTools.length})</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {boundTools.map(tool => {
                    const meta = allTools.find(at => toToolBindingName(at.name, at.source) === tool.name)
                    return (
                      <div key={tool.name} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, background: 'rgba(42,157,92,0.03)' }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6 }}>
                          <div className="tool-name" style={{ fontSize: 'calc(14px * var(--ui-font-scale))', fontWeight: 600 }}>{tool.name.replace(/^mcp:/, '')}</div>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                            <span className={`tool-source ${tool.name.startsWith('mcp:') ? 'mcp' : 'builtin'}`} style={{ fontSize: 'calc(11px * var(--ui-font-scale))', padding: '2px 8px', borderRadius: 4 }}>{tool.name.startsWith('mcp:') ? 'MCP' : t('内置')}</span>
                            <button onClick={() => removeTool(tool.name)} title={t('移出')} style={{ cursor: 'pointer', width: 28, height: 28, borderRadius: 6, border: '1px solid #ef4444', background: 'transparent', fontSize: 18, lineHeight: 1, color: 'var(--cinnabar)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>×</button>
                          </div>
                        </div>
                        {meta && <div style={{ fontSize: 'calc(12px * var(--ui-font-scale))', color: 'var(--ink-light)', lineHeight: 1.4 }}>{meta.description}</div>}
                      </div>
                    )
                  })}
                  {boundTools.length === 0 && (
                    <div style={{ fontSize: 'calc(12px * var(--ui-font-scale))', color: 'var(--ink-faint)', padding: 8 }}>{t('暂无已激活工具')}</div>
                  )}
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="detail-section-title">{t('未激活工具')} ({unboundTools.length})</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {unboundTools.slice(0, 20).map(tool => (
                    <div key={tool.name} style={{ border: '1px dashed var(--border)', borderRadius: 10, padding: 12, background: 'var(--bg-input)' }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6 }}>
                        <div className="tool-name" style={{ fontSize: 'calc(14px * var(--ui-font-scale))', fontWeight: 600 }}>{tool.name}</div>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <span className={`tool-source ${tool.source}`} style={{ fontSize: 'calc(11px * var(--ui-font-scale))', padding: '2px 8px', borderRadius: 4 }}>{tool.source === 'mcp' ? 'MCP' : t('内置')}</span>
                          <button onClick={() => addTool(tool.name, tool.source)} title={t('激活')} style={{ cursor: 'pointer', width: 28, height: 28, borderRadius: 6, border: '1px solid var(--jade)', background: 'transparent', fontSize: 20, lineHeight: 1, color: 'var(--jade)', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>+</button>
                        </div>
                      </div>
                      <div style={{ fontSize: 'calc(12px * var(--ui-font-scale))', color: 'var(--ink-light)', lineHeight: 1.4 }}>{tool.description}</div>
                    </div>
                  ))}
                  {unboundTools.length === 0 && (
                    <div style={{ fontSize: 'calc(12px * var(--ui-font-scale))', color: 'var(--ink-faint)', padding: 8 }}>{t('所有工具已激活')}</div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* 技能 */}
          <div className={`tab-page ${activeTab === 'skills' ? 'active' : ''}`}>
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="detail-section-title">{t('已绑定技能包')} ({boundSkills.length})</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {boundSkills.map(name => {
                    const meta = allSkills.find(s => s.id === name)
                    return (
                      <div key={name} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, background: 'rgba(42,157,92,0.03)' }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6 }}>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            <div className="tool-name" style={{ fontSize: 'calc(14px * var(--ui-font-scale))', fontWeight: 600 }}>{meta?.name || name}</div>
                            {meta && <span style={{ fontSize: 'calc(11px * var(--ui-font-scale))', padding: '2px 8px', borderRadius: 4, background: 'rgba(124,58,237,0.1)', color: 'var(--star-ziwei)' }}>{meta.category}</span>}
                          </div>
                          <button onClick={() => toggleSkill(name)} title={t('移出')} style={{ cursor: 'pointer', width: 28, height: 28, borderRadius: 6, border: '1px solid #ef4444', background: 'transparent', fontSize: 18, lineHeight: 1, color: 'var(--cinnabar)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>×</button>
                        </div>
                        {meta && <>
                          <div style={{ fontSize: 'calc(12px * var(--ui-font-scale))', color: 'var(--ink-light)', lineHeight: 1.4 }}>{meta.description}</div>
                          {meta.children.length > 0 && <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {meta.children.map(child => <div key={child.id} style={{ fontSize: 'calc(11px * var(--ui-font-scale))' }}>↳ {child.name}</div>)}
                          </div>}
                        </>}
                      </div>
                    )
                  })}
                  {boundSkills.length === 0 && (
                    <div style={{ fontSize: 'calc(12px * var(--ui-font-scale))', color: 'var(--ink-faint)', padding: 8 }}>{t('暂无已绑定技能包')}</div>
                  )}
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="detail-section-title">{t('可绑定技能包')} ({unboundSkills.length})</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {unboundSkills.slice(0, 20).map(s => (
                    <div key={s.id} style={{ border: '1px dashed var(--border)', borderRadius: 10, padding: 12, background: 'var(--bg-input)' }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6 }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <div className="tool-name" style={{ fontSize: 'calc(14px * var(--ui-font-scale))', fontWeight: 600 }}>{s.name}</div>
                          <span style={{ fontSize: 'calc(11px * var(--ui-font-scale))', padding: '2px 8px', borderRadius: 4, background: 'rgba(124,58,237,0.1)', color: 'var(--star-ziwei)' }}>{s.category}</span>
                        </div>
                        <button onClick={() => toggleSkill(s.id)} title={t('绑定技能包')} style={{ cursor: 'pointer', width: 28, height: 28, borderRadius: 6, border: '1px solid var(--jade)', background: 'transparent', fontSize: 20, lineHeight: 1, color: 'var(--jade)', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>+</button>
                      </div>
                      <div style={{ fontSize: 'calc(12px * var(--ui-font-scale))', color: 'var(--ink-light)', lineHeight: 1.4 }}>{s.description}</div>
                    </div>
                  ))}
                  {unboundSkills.length === 0 && (
                    <div style={{ fontSize: 'calc(12px * var(--ui-font-scale))', color: 'var(--ink-faint)', padding: 8 }}>{t('所有技能包均已绑定')}</div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* 统计 */}
          <div className={`tab-page ${activeTab === 'stats' ? 'active' : ''}`}>
            <div className="detail-section">
              <div className="detail-section-title">{t('使用概览')}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <div className="info-item"><div className="info-item-label">{t('会话数')}</div><div className="info-item-value">{stats?.sessionCount ?? '--'}</div></div>
                <div className="info-item"><div className="info-item-label">{t('成功率')}</div><div className="info-item-value">--</div></div>
                <div className="info-item"><div className="info-item-label">{t('最近活跃')}</div><div className="info-item-value">{stats?.lastActive ? timeAgo(stats.lastActive, t) : '--'}</div></div>
              </div>
            </div>
            <div className="detail-section">
              <div className="detail-section-title">{t('调用趋势')}</div>
              <div className="empty-state" style={{ padding: 20 }}>
                <div className="empty-hint">{t('需要后端打点后展示')}</div>
              </div>
            </div>
          </div>

          {/* 新建角色时显示创建按钮 */}
          {isNew && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '16px 0', borderTop: '1px solid var(--border)', marginTop: 16 }}>
              <button className="detail-btn primary" onClick={handleCreate}>{t('创建')}</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
