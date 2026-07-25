import { useState, useEffect } from 'react'
import { fetchCharacterStats, fetchCharacters, updateCharacter } from '@/api/characters'
import { fetchTools } from '@/api/tools'
import { fetchSkills } from '@/api/skills'
import type { Character, CharacterStats } from '@/types'
import type { ToolMeta } from '@/api/tools'
import type { SkillMeta } from '@/api/skills'

const roleLabels: Record<string, string> = { main: '主 Agent', sub: '子 Agent', both: '主 / 子 Agent' }

export default function CharacterDetailPage({
  character: char,
  onBack,
}: {
  character: Character
  onBack: () => void
}) {
  const [activeTab, setActiveTab] = useState('basic')
  const [stats, setStats] = useState<CharacterStats | null>(null)
  const [allTools, setAllTools] = useState<ToolMeta[]>([])
  const [allSkills, setAllSkills] = useState<SkillMeta[]>([])
  const [allChars, setAllChars] = useState<Character[]>([])
  const [role, setRole] = useState(char.role)
  const [strategy, setStrategy] = useState(char.default_strategy)
  const [stepsEnabled, setStepsEnabled] = useState(char.maxSteps > 0 && char.maxSteps < 999)
  const [maxSteps, setMaxSteps] = useState(char.maxSteps > 0 && char.maxSteps < 999 ? char.maxSteps : 20)
  const [memoryEnabled, setMemoryEnabled] = useState(char.memory?.enabled ?? false)
  const [selfEvolution, setSelfEvolution] = useState(char.memory?.selfEvolution ?? false)
  const [charLimit, setCharLimit] = useState(char.memory?.charLimit ?? 2000)
  const [soul, setSoul] = useState(char.soul ?? '')
  const [userProfile, setUserProfile] = useState(char.userProfile ?? '')
  const [memoryContent, setMemoryContent] = useState(char.memoryContent ?? '')
  const [customPromptEnabled, setCustomPromptEnabled] = useState(!!char.customPrompt)
  const [customPrompt, setCustomPrompt] = useState(char.customPrompt ?? '')
  const [boundTools, setBoundTools] = useState<{ name: string }[]>(char.tools || [])
  const [boundSkills, setBoundSkills] = useState<string[]>(char.skills || [])

  useEffect(() => {
    fetchCharacterStats(char.id).then(setStats).catch(() => {})
    fetchTools().then(d => setAllTools(d.tools)).catch(() => {})
    fetchSkills().then(d => setAllSkills(d.skills)).catch(() => {})
    fetchCharacters().then(setAllChars).catch(() => {})
  }, [char.id])

  const boundToolNames = new Set(boundTools.map(t => t.name))
  const boundSkillNames = new Set(boundSkills)
  const unboundTools = allTools.filter(t => !boundToolNames.has(t.name))
  const unboundSkills = allSkills.filter(s => !boundSkillNames.has(s.name))

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

  const tabs = [
    { id: 'basic', label: '基础' },
    { id: 'memory', label: '记忆' },
    { id: 'tools', label: '工具' },
    { id: 'skills', label: '技能' },
    { id: 'stats', label: '统计' },
  ]

  return (
    <div className="main">
      <div className="detail-header">
        <button className="back-btn" onClick={onBack}>←</button>
        <div className="detail-header-info">
          <h1>{char.name}</h1>
          <p>{char.id} · {roleLabels[char.role] || char.role}</p>
        </div>
        <div style={{ flex: 1 }}></div>
      </div>

      <div className="detail-body">
        <div className="detail-art">
          <div className="detail-art-img" style={{
            background: char.color
              ? `linear-gradient(135deg, ${char.color}15, ${char.color}08)`
              : undefined
          }}>
            {char.avatar ? <img src={char.avatar} alt={char.name} /> : <span style={{ fontSize: 64 }}>{char.name[0]}</span>}
          </div>
          <div className="detail-actions">
            <button className="detail-btn primary" onClick={onBack}>开始对话</button>
            <button className="detail-btn danger">删除角色</button>
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
                  <div className="info-item-label">角色简介</div>
                  <div className="info-item-value" style={{ fontWeight: 400, lineHeight: 1.5 }}>{char.description}</div>
                </div>
                <div className="info-item"><div className="info-item-label">角色 ID</div><div className="info-item-value" style={{ fontFamily: 'monospace' }}>{char.id}</div></div>
                <div className="info-item">
                  <div className="info-item-label">角色类型</div>
                  <select value={role} onChange={e => setRole(e.target.value as Character['role'])} style={{ marginTop: 4, width: '100%' }}>
                    <option value="main">主 Agent</option>
                    <option value="sub">子 Agent</option>
                    <option value="both">主/子 Agent</option>
                  </select>
                </div>
                <div className="info-item" style={{ gridColumn: '1/-1' }}>
                  <div className="info-item-label">默认策略</div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                    {(['Plan', 'Ask', 'Bypass'] as const).map(s => (
                      <span key={s} className={`strategy-btn ${strategy === s ? 'active' : ''}`} onClick={() => setStrategy(s)}>{s}</span>
                    ))}
                  </div>
                </div>
              </div>
              <div className="tool-list" style={{ marginTop: 12 }}>
                <div className="tool-item">
                  <div className="tool-name">限定步数</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div className={`toggle ${stepsEnabled ? 'on' : ''}`} onClick={() => setStepsEnabled(!stepsEnabled)}></div>
                    <span style={{ fontSize: 12, color: 'var(--ink-light)' }}>{stepsEnabled ? `${maxSteps} 步` : '不限制 (999)'}</span>
                  </div>
                </div>
                {stepsEnabled && (
                  <div className="tool-item">
                    <div className="tool-name">步数上限</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
                      <input type="range" min={10} max={99} value={maxSteps} onChange={e => setMaxSteps(Number(e.target.value))} style={{ flex: 1, accentColor: 'var(--gold)' }} />
                      <span style={{ fontSize: 12, color: 'var(--ink-deep)', fontWeight: 500, minWidth: 24, textAlign: 'right' }}>{maxSteps}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {char.groups?.length > 0 && (
              <div className="detail-section">
                <div className="detail-section-title">分组</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {char.groups.map(g => (
                    <span key={g} className="star-tag jade">{g}</span>
                  ))}
                </div>
              </div>
            )}

            <div className="detail-section">
              <div className="detail-columns">
                <div className="detail-col">
                  <div className="detail-section-title">Soul（人格）</div>
                  <textarea className="md-box" value={soul} placeholder="(未设置)" onChange={e => { setSoul(e.target.value); updateCharacter(char.id, { soul: e.target.value }) }} style={{ minHeight: 400, width: '100%', resize: 'vertical' }} />
                </div>
                <div className="detail-col">
                  <div className="detail-section-title">User（用户画像）</div>
                  <textarea className="md-box" value={userProfile} placeholder="(未设置)" onChange={e => { setUserProfile(e.target.value); updateCharacter(char.id, { userProfile: e.target.value }) }} style={{ minHeight: 400, width: '100%', resize: 'vertical' }} />
                </div>
              </div>
            </div>

            <div className="detail-section">
              <div className="detail-section-title">自定义提示词</div>
              <div className="tool-item" style={{ border: 'none', padding: '0 0 8px 0' }}>
                <div className="tool-name">启用自定义提示词</div>
                <div className={`toggle ${customPromptEnabled ? 'on' : ''}`} onClick={() => setCustomPromptEnabled(!customPromptEnabled)}></div>
              </div>
              {customPromptEnabled ? (
                <textarea className="md-box" value={customPrompt} placeholder="(输入自定义提示词)" onChange={e => { setCustomPrompt(e.target.value); updateCharacter(char.id, { customPrompt: e.target.value }) }} style={{ minHeight: 250, width: '100%', resize: 'vertical' }} />
              ) : (
                <div className="md-box">{char.customPrompt || '(未设置，将使用默认系统提示词)'}</div>
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
                  <div className={`toggle ${memoryEnabled ? 'on' : ''}`} onClick={() => { setMemoryEnabled(!memoryEnabled); updateCharacter(char.id, { memory: { enabled: !memoryEnabled, selfEvolution, charLimit } }) }}></div>
                </div>
                <div className="tool-item">
                  <div className="tool-name">自我进化</div>
                  <div className={`toggle ${selfEvolution ? 'on' : ''}`} onClick={() => { setSelfEvolution(!selfEvolution); updateCharacter(char.id, { memory: { enabled: memoryEnabled, selfEvolution: !selfEvolution, charLimit } }) }}></div>
                </div>
                <div className="tool-item">
                  <div className="tool-name">记忆字符上限</div>
                  <input type="number" min={0} step={100} value={charLimit} onChange={e => { const v = Number(e.target.value); setCharLimit(v); updateCharacter(char.id, { memory: { enabled: memoryEnabled, selfEvolution, charLimit: v } }) }} style={{ width: 120, marginTop: 4 }} />
                </div>
              </div>
            </div>
            <div className="detail-section">
              <div className="detail-section-title">Memory（记忆内容）</div>
              <textarea className="md-box" value={memoryContent} placeholder="(空)" onChange={e => { setMemoryContent(e.target.value); updateCharacter(char.id, { memoryContent: e.target.value }) }} style={{ minHeight: 450, width: '100%', resize: 'vertical' }} />
            </div>
          </div>

          {/* 工具 */}
          <div className={`tab-page ${activeTab === 'tools' ? 'active' : ''}`}>
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="detail-section-title">已激活工具 ({boundToolNames.size})</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {boundTools.map(t => {
                    const meta = allTools.find(at => at.name === t.name)
                    const remove = () => {
                      const next = boundTools.filter(bt => bt.name !== t.name)
                      setBoundTools(next)
                      updateCharacter(char.id, { tools: next })
                    }
                    return (
                      <div key={t.name} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, background: 'rgba(42,157,92,0.03)', position: 'relative' }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6 }}>
                          <div className="tool-name" style={{ fontSize: 14, fontWeight: 600 }}>{t.name.replace(/^mcp:/, '')}</div>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                            <span className={`tool-source ${t.name.startsWith('mcp:') ? 'mcp' : 'builtin'}`} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4 }}>{t.name.startsWith('mcp:') ? 'MCP' : '内置'}</span>
                            <button onClick={remove} title="移出" style={{ cursor: 'pointer', width: 28, height: 28, borderRadius: 6, border: '1px solid #ef4444', background: 'transparent', fontSize: 18, lineHeight: 1, color: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>×</button>
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
                  {unboundTools.slice(0, 20).map(t => {
                    const activate = () => {
                      const toolName = t.source === 'mcp' ? `mcp:${t.name}` : t.name
                      const next = [...boundTools, { name: toolName }]
                      setBoundTools(next)
                      updateCharacter(char.id, { tools: next })
                    }
                    return (
                      <div key={t.name} style={{ border: '1px dashed var(--border)', borderRadius: 10, padding: 12, background: 'var(--bg-input)' }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6 }}>
                          <div className="tool-name" style={{ fontSize: 14, fontWeight: 600 }}>{t.name}</div>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                            <span className={`tool-source ${t.source}`} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4 }}>{t.source === 'mcp' ? 'MCP' : '内置'}</span>
                            <button onClick={activate} title="激活" style={{ cursor: 'pointer', width: 28, height: 28, borderRadius: 6, border: '1px solid var(--jade)', background: 'transparent', fontSize: 20, lineHeight: 1, color: 'var(--jade)', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>+</button>
                          </div>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--ink-light)', lineHeight: 1.4 }}>{t.description}</div>
                      </div>
                    )
                  })}
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
                    const remove = () => {
                      const next = boundSkills.filter(s => s !== name)
                      setBoundSkills(next)
                      updateCharacter(char.id, { skills: next })
                    }
                    return (
                      <div key={name} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, background: 'rgba(42,157,92,0.03)' }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6 }}>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            <div className="tool-name" style={{ fontSize: 14, fontWeight: 600 }}>{name}</div>
                            {meta && <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: 'rgba(124,58,237,0.1)', color: '#7c3aed' }}>{meta.category}</span>}
                          </div>
                          <button onClick={remove} title="移出" style={{ cursor: 'pointer', width: 28, height: 28, borderRadius: 6, border: '1px solid #ef4444', background: 'transparent', fontSize: 18, lineHeight: 1, color: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>×</button>
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
                  {unboundSkills.slice(0, 20).map(s => {
                    const activate = () => {
                      const next = [...boundSkills, s.name]
                      setBoundSkills(next)
                      updateCharacter(char.id, { skills: next })
                    }
                    return (
                      <div key={s.name} style={{ border: '1px dashed var(--border)', borderRadius: 10, padding: 12, background: 'var(--bg-input)' }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6 }}>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            <div className="tool-name" style={{ fontSize: 14, fontWeight: 600 }}>{s.name}</div>
                            <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: 'rgba(124,58,237,0.1)', color: '#7c3aed' }}>{s.category}</span>
                          </div>
                          <button onClick={activate} title="激活" style={{ cursor: 'pointer', width: 28, height: 28, borderRadius: 6, border: '1px solid var(--jade)', background: 'transparent', fontSize: 20, lineHeight: 1, color: 'var(--jade)', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>+</button>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--ink-light)', lineHeight: 1.4 }}>{s.description}</div>
                      </div>
                    )
                  })}
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
        </div>
      </div>
    </div>
  )
}
