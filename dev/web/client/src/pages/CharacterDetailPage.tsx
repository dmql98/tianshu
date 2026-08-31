import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { fetchCharacter, fetchCharacterStats, fetchCharacters, createCharacter, updateCharacter, updateCharacterSkillBinding, deleteCharacter, type CharacterMotion } from '@/api/characters'
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

const previewMotions: Array<{ id: CharacterMotion; label: string }> = [
  { id: 'idle', label: '待机' },
  { id: 'thinking', label: '思考' },
  { id: 'working', label: '工作' },
  { id: 'speaking', label: '说话' },
  { id: 'success', label: '完成' },
  { id: 'error', label: '出错' },
]

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
  const [rpSoft, setRpSoft] = useState<string>('')
  const [rpGrace, setRpGrace] = useState<string>('')
  const [rpAutoContinuation, setRpAutoContinuation] = useState<'inherit' | 'enabled' | 'disabled'>('inherit')
  const [rpMaxAuto, setRpMaxAuto] = useState<string>('')
  const [rpEffective, setRpEffective] = useState<Character['runPolicy'] | undefined>(undefined)
  const [groups, setGroups] = useState<string[]>([])
  const [helpers, setHelpers] = useState<string[]>([])
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
  const [newGroupName, setNewGroupName] = useState('')

  // 动画预览
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewMotion, setPreviewMotion] = useState<CharacterMotion>('idle')

  // Track current ID (may change after rename)
  const [currentId, setCurrentId] = useState(id || '')
  const currentIdRef = useRef(currentId)
  const charIdRef = useRef(charId)
  useEffect(() => { currentIdRef.current = currentId }, [currentId])
  useEffect(() => { charIdRef.current = charId }, [charId])

  // Auto-save for existing characters (stable reference via refs)
  // 串行化保存：同一角色按调用顺序排队写盘，避免快速连续操作（如连续点帮手 tag）
  // 产生并发 PUT 乱序落盘，导致旧值覆盖新值（例如 helpers 被上一次的空数组覆盖）。
  const saveChainRef = useRef<Promise<void>>(Promise.resolve())
  const autoSave = useCallback(async (data: Record<string, unknown>) => {
    const cid = currentIdRef.current
    if (!cid || cid === 'new') return
    const newCharId = charIdRef.current.trim()
    const run = saveChainRef.current.then(async () => {
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
    })
    // 队列中某项失败不阻断后续保存；调用方仍可 await 本次结果。
    saveChainRef.current = run.catch(() => {})
    await run
  }, [navigate])

  // Load character data (edit mode)
  // 竞态保护：切换角色（id 变化）时递增序号，过期响应直接丢弃，
  // 保证帮手列表等表单字段始终反映当前角色的元数据。
  const loadSeqRef = useRef(0)
  useEffect(() => {
    if (isNew || !id) { setLoading(false); return }
    setLoading(true)
    const seq = ++loadSeqRef.current
    fetchCharacter(id).then(c => {
      if (seq !== loadSeqRef.current) return
      setChar(c)
      setCharId(c.id)
      setCurrentId(c.id)
      setName(c.name)
      setDescription(c.description || '')
      setColor(c.color || '#6366f1')
      setEnabled(c.enabled ?? true)
      setRole(c.role || 'both')
      setStrategy(normalizeStrategy(c.default_strategy))
      // Run policy (new) — configured values from the server preview.
      const rp = c.runPolicy?.configured
      setRpSoft(rp?.softTurns != null ? String(rp.softTurns) : '')
      setRpGrace(rp?.graceTurns != null ? String(rp.graceTurns) : '')
      setRpAutoContinuation(rp?.autoContinuation ?? 'inherit')
      setRpMaxAuto(rp?.maxAutoContinuations != null ? String(rp.maxAutoContinuations) : '')
      setRpEffective(c.runPolicy)
      setGroups(c.groups ? [...c.groups] : [])
      // helpers 未配置 = 没有帮手（不兜底显示 worker）。
      setHelpers(c.helpers ? [...c.helpers] : [])
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
    }).catch(() => { if (seq === loadSeqRef.current) setChar(null) }).finally(() => { if (seq === loadSeqRef.current) setLoading(false) })
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
        {isNew ? (
          <div className="chd-avatar" style={{ background: color, color: '#fff', fontWeight: 700, fontSize: 'calc(20px * var(--ui-font-scale))' }}>
            {(name.trim() || '+').slice(0, 1)}
          </div>
        ) : (
          <div className="chd-avatar">
            <CharacterRenderer
              characterId={currentId}
              name={name}
              legacyAvatar={char?.avatar}
              mode="avatar"
              className="character-renderer-card"
            />
          </div>
        )}
        <div className="detail-header-info">
          <h1>
            {isNew ? t('新建角色') : name}
            {!isNew && id && <span className="chd-id">{id}</span>}
          </h1>
          {!isNew && id && (
            <p>
              {t(roleLabels[role] || role)}
              {' · '}{enabled ? t('已启用') : t('已停用')}
              {' · '}{t('分组')} {groups.join(' / ') || '—'}
            </p>
          )}
        </div>
        <div style={{ flex: 1 }}></div>
        {!isNew && (
          <>
            <span className="chd-toggle-label">{t('启用')}</span>
            <div
              className={`toggle ${enabled ? 'on' : ''}`}
              title={enabled ? t('已启用') : t('已停用')}
              onClick={() => { const next = !enabled; setEnabled(next); autoSave({ enabled: next }) }}
            ></div>
            <button className="btn sm" onClick={() => { setPreviewMotion('idle'); setPreviewOpen(true) }}>{t('预览动画')}</button>
            <button className="btn sm" onClick={() => setActiveTab('visual')}>{t('绑定皮肤')}</button>
            <button className="detail-btn danger chd-del" onClick={handleDelete}>{t('删除角色')}</button>
          </>
        )}
      </div>

      <div className="detail-body">
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
            <div className="basic-grid">
              {/* 左列：基本信息 */}
              <section className="form-card">
                <div className="fc-head">{t('基本信息')}<span className="fc-sub">{t('身份、归属与协作策略')}</span></div>
                <div className="fc-body">
                  <div className="field">
                    <label>{t('角色名称')}</label>
                    <input
                      value={name}
                      placeholder={t('输入角色名称')}
                      onChange={e => {
                        const v = e.target.value
                        setName(v)
                        if (isNew && !idEdited) setCharId(toSlug(v))
                      }}
                      onBlur={() => {
                        const trimmed = name.trim()
                        if (!trimmed) return
                        if (trimmed !== name) setName(trimmed)
                        if (!idEdited) setCharId(toSlug(trimmed))
                        autoSave({ name: trimmed })
                      }}
                    />
                  </div>
                  <div className="field">
                    <label>{t('角色 ID')}<span className="label-hint">{isNew ? t('留空按名称生成') : t('修改后将同步重命名')}</span></label>
                    <input
                      className="mono"
                      value={charId}
                      placeholder={t('自定义ID')}
                      onChange={e => setCharId(e.target.value)}
                      onBlur={() => {
                        const trimmed = toSlug(charId)
                        if (trimmed !== charId) setCharId(trimmed)
                        setIdEdited(true)
                        if (trimmed && trimmed !== currentId) autoSave({ id: trimmed })
                      }}
                    />
                  </div>
                  <div className="field full">
                    <label>{t('角色简介')}<span className="label-hint">{t('展示在角色列表与选择器中')}</span></label>
                    <textarea
                      value={description}
                      placeholder={t('简短描述这个角色')}
                      onChange={e => setDescription(e.target.value)}
                      onBlur={() => autoSave({ description })}
                    />
                  </div>
                  <div className="field">
                    <label>{t('角色类型')}</label>
                    <select value={role} onChange={e => { const v = e.target.value as Character['role']; setRole(v); autoSave({ role: v }) }}>
                      <option value="main">{t('主 Agent')}</option>
                      <option value="sub">{t('子 Agent')}</option>
                      <option value="both">{t('主/子 Agent')}</option>
                    </select>
                  </div>
                  <div className="field">
                    <label>{t('默认审批模式')}<span className="label-hint">{t('被委派任务时的审批模式')}</span></label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {STRATEGIES.map(s => (
                        <span key={s} className={`strategy-btn ${strategy === s ? 'active' : ''}`} onClick={() => { setStrategy(s); autoSave({ default_strategy: s }) }}>{t(s)}</span>
                      ))}
                    </div>
                  </div>
                  <div className="field full">
                    <label>{t('主题色')}<span className="label-hint">{t('用于头像、标识与强调色')}</span></label>
                    <div className="color-row">
                      <input
                        type="color"
                        className="swatch"
                        value={color}
                        onChange={e => { setColor(e.target.value); autoSave({ color: e.target.value }) }}
                      />
                      <input
                        className="mono"
                        style={{ width: 110 }}
                        value={color}
                        onChange={e => setColor(e.target.value)}
                        onBlur={() => autoSave({ color })}
                      />
                      <span className="color-preview">
                        <span className="cp-avatar" style={{ background: color }}>{(name.trim() || '?').slice(0, 1)}</span>
                        <span className="cp-tag" style={{ color, borderColor: `${color}66`, background: `${color}14` }}>{charId || 'id'}</span>
                      </span>
                    </div>
                  </div>
                  <div className="field full">
                    <label>{t('分组')}<span className="label-hint">{t('影响记忆共享范围与知识库绑定')}</span></label>
                    <div className="chips">
                      {groups.map(g => (
                        <span key={g} className="chip on">{g}<button title={t('移出分组')} onClick={() => toggleGroup(g)}>×</button></span>
                      ))}
                      {allGroups.filter(g => !groups.includes(g)).map(g => (
                        <span key={g} className="chip dashed" onClick={() => toggleGroup(g)}>+ {g}</span>
                      ))}
                      <input
                        className="chip-input"
                        value={newGroupName}
                        placeholder={t('新分组，回车添加')}
                        onChange={e => setNewGroupName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') addNewGroup(); if (e.key === 'Escape') setNewGroupName('') }}
                        onBlur={() => { if (newGroupName.trim()) addNewGroup() }}
                      />
                    </div>
                  </div>
                  <div className="field full">
                    <label>{t('工作帮手')}<span className="label-hint">{t('该角色新会话默认可委托的角色（可含自己与 worker）。在会话侧边「帮手栏」可再单独调整。')}</span></label>
                    <div className="chips">
                      {allChars.map(c => (
                        <span
                          key={c.id}
                          className={`chip helper ${helpers.includes(c.id) ? 'on' : ''}`}
                          title={c.description}
                          onClick={() => toggleHelper(c.id)}
                        >
                          <span className="chip-av" style={{
                            background: c.color
                              ? `linear-gradient(135deg, ${c.color}20, ${c.color}08)`
                              : 'linear-gradient(135deg, var(--gold-soft), var(--gold-mist))'
                          }}>
                            <CharacterRenderer
                              characterId={c.id}
                              name={c.name}
                              legacyAvatar={c.avatar}
                              mode="avatar"
                              className="character-renderer-card"
                            />
                          </span>
                          {c.name}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </section>

              {/* 右列：人格与提示词 + 运行策略 */}
              <div className="basic-side">
                <section className="form-card">
                  <div className="fc-head">{t('人格与提示词')}<span className="fc-sub">{t('注入系统提示词')}</span></div>
                  <div className="fc-body single">
                    <div className="field">
                      <label>Soul（{t('人格')}）<span className="label-hint">{t('人格与口吻，置于系统提示词最前')}</span></label>
                      <textarea
                        style={{ minHeight: 140 }}
                        value={soul}
                        placeholder={t('(未设置)')}
                        onChange={e => setSoul(e.target.value)}
                        onBlur={() => autoSave({ soul })}
                      />
                    </div>
                    <div className="field">
                      <label>User（{t('用户画像')}）<span className="label-hint">{t('描述服务对象，影响回复视角')}</span></label>
                      <textarea
                        style={{ minHeight: 110 }}
                        value={userProfile}
                        placeholder={t('(未设置)')}
                        onChange={e => setUserProfile(e.target.value)}
                        onBlur={() => autoSave({ userProfile })}
                      />
                    </div>
                    <div className="setting-row">
                      <div className="setting-info">
                        <span className="setting-label">{t('自定义提示词')}</span>
                        <div className="setting-hint">{t('开启后完全替换默认系统提示词')}</div>
                      </div>
                      <div className="setting-control">
                        <div className={`toggle ${customPromptEnabled ? 'on' : ''}`} onClick={() => { setCustomPromptEnabled(!customPromptEnabled); autoSave({ customPrompt: !customPromptEnabled ? customPrompt : '' }) }}></div>
                      </div>
                    </div>
                    {customPromptEnabled && (
                      <div className="field">
                        <textarea
                          style={{ minHeight: 140 }}
                          value={customPrompt}
                          placeholder={t('(输入自定义提示词)')}
                          onChange={e => setCustomPrompt(e.target.value)}
                          onBlur={() => autoSave({ customPrompt })}
                        />
                      </div>
                    )}
                  </div>
                </section>

                <section className="form-card">
                  <div className="fc-head">{t('运行策略')}<span className="fc-sub">{t('留空则继承系统默认')}</span></div>
                  <div className="fc-body single">
                    <div className="setting-row">
                      <div className="setting-info">
                        <span className="setting-label">{t('自我进化')}</span>
                        <div className="setting-hint">{t('允许角色在会话结束后沉淀、更新自身记忆')}</div>
                      </div>
                      <div className="setting-control">
                        <div className={`toggle ${selfEvolution ? 'on' : ''}`} onClick={() => { setSelfEvolution(!selfEvolution); autoSave({ memory: { enabled: memoryEnabled, selfEvolution: !selfEvolution, charLimit } }) }}></div>
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 16px', marginTop: 4 }}>
                      <div className="field">
                        <label>{t('收敛起始轮次')}<span className="label-hint">{t('空=继承')}</span></label>
                        <input
                          type="number" min={1} max={999} value={rpSoft} placeholder={t('继承')}
                          onChange={e => setRpSoft(e.target.value)}
                          onBlur={autoSaveRunPolicy}
                        />
                      </div>
                      <div className="field">
                        <label>{t('宽限轮次')}<span className="label-hint">{t('空=继承')}</span></label>
                        <input
                          type="number" min={0} max={999} value={rpGrace} placeholder={t('继承')}
                          onChange={e => setRpGrace(e.target.value)}
                          onBlur={autoSaveRunPolicy}
                        />
                      </div>
                      <div className="field">
                        <label>{t('自动续跑')}</label>
                        <select
                          value={rpAutoContinuation}
                          onChange={e => { setRpAutoContinuation(e.target.value as any); autoSaveRunPolicy() }}
                        >
                          <option value="inherit">{t('继承系统')}</option>
                          <option value="enabled">{t('允许')}</option>
                          <option value="disabled">{t('禁止')}</option>
                        </select>
                      </div>
                      <div className="field">
                        <label>{t('最多自动续跑')}<span className="label-hint">{t('空=继承')}</span></label>
                        <input
                          type="number" min={0} max={50} value={rpMaxAuto} placeholder={t('继承')}
                          onChange={e => setRpMaxAuto(e.target.value)}
                          onBlur={autoSaveRunPolicy}
                        />
                      </div>
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
                      <div>
                        <button
                          className="btn sm"
                          onClick={() => { setRpSoft(''); setRpGrace(''); setRpAutoContinuation('inherit'); setRpMaxAuto(''); saveRunPolicy(null) }}
                        >
                          {t('恢复继承')}
                        </button>
                      </div>
                    )}
                  </div>
                </section>
              </div>
            </div>

            <div className="form-foot">
              <span className="hint">{isNew ? t('填写名称与 ID 后，点击创建') : t('更改会自动保存')}</span>
              <span className="spacer"></span>
              {isNew && <button className="btn primary" onClick={handleCreate}>{t('创建')}</button>}
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

        </div>
      </div>

      {/* 动画预览弹窗 */}
      {previewOpen && !isNew && (
        <div className="approval-overlay character-preview-overlay" onClick={() => setPreviewOpen(false)}>
          <div
            className="approval-dialog character-preview-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={t('{name} 动画预览', { name })}
            onClick={event => event.stopPropagation()}
          >
            <div className="character-preview-header">
              <div>
                <div className="character-preview-title">{name} · {t('动画预览')}</div>
                <div className="character-preview-subtitle">{t('未配置的动作会自动使用待机动画或立绘')}</div>
              </div>
              <button className="btn sm" onClick={() => setPreviewOpen(false)}>{t('关闭')}</button>
            </div>
            <CharacterRenderer
              key={`${currentId}-${previewMotion}`}
              characterId={currentId}
              name={name}
              legacyAvatar={char?.avatar}
              mode="stage"
              motion={previewMotion}
              className="character-renderer-preview"
            />
            <div className="character-preview-motions" role="group" aria-label={t('选择预览动作')}>
              {previewMotions.map(item => (
                <button
                  key={item.id}
                  className={`btn sm ${previewMotion === item.id ? 'primary' : ''}`}
                  onClick={() => setPreviewMotion(item.id)}
                >
                  {t(item.label)}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
