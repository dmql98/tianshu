import { useState, useEffect } from 'react'
import { fetchCharacterStats, fetchCharacters } from '@/api/characters'
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

  useEffect(() => {
    fetchCharacterStats(char.id).then(setStats).catch(() => {})
    fetchTools().then(d => setAllTools(d.tools)).catch(() => {})
    fetchSkills().then(d => setAllSkills(d.skills)).catch(() => {})
    fetchCharacters().then(setAllChars).catch(() => {})
  }, [char.id])

  const boundToolNames = new Set((char.tools || []).map(t => t.name))
  const boundSkillNames = new Set(char.skills || [])
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
        {char.enabled !== false && (
          <button className="detail-btn" style={{ borderColor: 'var(--jade)', color: 'var(--jade)' }}>已启用</button>
        )}
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
                  <div className="md-box">{char.soul || '(未设置)'}</div>
                </div>
                <div className="detail-col">
                  <div className="detail-section-title">User（用户画像）</div>
                  <div className="md-box">{char.userProfile || '(未设置)'}</div>
                </div>
              </div>
            </div>

            <div className="detail-section">
              <div className="detail-section-title">自定义提示词</div>
              <div className="md-box">{char.customPrompt || '(未设置，将使用默认系统提示词)'}</div>
            </div>
          </div>

          {/* 记忆 */}
          <div className={`tab-page ${activeTab === 'memory' ? 'active' : ''}`}>
            <div className="detail-section">
              <div className="detail-section-title">记忆设置</div>
              <div className="tool-list">
                <div className="tool-item">
                  <div className="tool-name">启用记忆</div>
                  <span style={{ fontSize: 12, color: 'var(--ink-mid)' }}>{char.memory?.enabled ? '是' : '否'}</span>
                </div>
                <div className="tool-item">
                  <div className="tool-name">自我进化</div>
                  <span style={{ fontSize: 12, color: 'var(--ink-mid)' }}>{char.memory?.selfEvolution ? '是' : '否'}</span>
                </div>
                <div className="tool-item">
                  <div className="tool-name">记忆字符上限</div>
                  <span style={{ fontSize: 12, color: 'var(--ink-mid)' }}>{char.memory?.charLimit || '--'}</span>
                </div>
              </div>
            </div>
            <div className="detail-section">
              <div className="detail-section-title">Memory（记忆内容）</div>
              <div className="md-box">{char.memoryContent || '(空)'}</div>
            </div>
          </div>

          {/* 工具 */}
          <div className={`tab-page ${activeTab === 'tools' ? 'active' : ''}`}>
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="detail-section-title">已绑定工具 ({boundToolNames.size})</div>
                <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 8, background: 'rgba(42,157,92,0.02)' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {(char.tools || []).map(t => {
                      const meta = allTools.find(at => at.name === t.name)
                      return (
                        <div key={t.name} className="tool-item" style={{ border: 'none', background: 'transparent' }}>
                          <div className="tool-name">{t.name}</div>
                          <span className="tool-source builtin">内置</span>
                          {meta && <span style={{ fontSize: 11, color: 'var(--ink-light)', marginLeft: 'auto' }}>{meta.description}</span>}
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="detail-section-title">可添加工具</div>
                <div style={{ border: '1px dashed var(--border)', borderRadius: 10, padding: 8, background: 'var(--bg-input)' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {unboundTools.slice(0, 10).map(t => (
                      <div key={t.name} className="tool-item" style={{ border: 'none', background: 'transparent' }}>
                        <div className="tool-name">{t.name}</div>
                        <span className={`tool-source ${t.source}`}>{t.source === 'mcp' ? 'MCP' : '内置'}</span>
                        <button className="tool-swap add" title="绑定" style={{ marginLeft: 'auto' }}>+</button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 技能 */}
          <div className={`tab-page ${activeTab === 'skills' ? 'active' : ''}`}>
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="detail-section-title">已绑定技能 ({char.skills?.length || 0})</div>
                <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 8, background: 'rgba(42,157,92,0.02)' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {(char.skills || []).map(name => {
                      const meta = allSkills.find(s => s.name === name)
                      return (
                        <div key={name} className="skill-item">
                          <div className="skill-name">{name}</div>
                          {meta && <div className="skill-desc">{meta.description}</div>}
                        </div>
                      )
                    })}
                    {(!char.skills || char.skills.length === 0) && (
                      <div style={{ fontSize: 12, color: 'var(--ink-faint)', padding: 8 }}>暂无绑定技能</div>
                    )}
                  </div>
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="detail-section-title">可绑定技能</div>
                <div style={{ border: '1px dashed var(--border)', borderRadius: 10, padding: 8, background: 'var(--bg-input)' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {unboundSkills.slice(0, 10).map(s => (
                      <div key={s.name} className="skill-item">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div className="skill-name">{s.name}</div>
                          <span className="tool-source" style={{ background: 'rgba(124,58,237,0.1)', color: '#7c3aed' }}>{s.category}</span>
                          <button className="skill-swap add" title="绑定" style={{ marginLeft: 'auto' }}>+</button>
                        </div>
                        <div className="skill-desc">{s.description}</div>
                      </div>
                    ))}
                  </div>
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
