import { useEffect, useState } from 'react'
import { useCharactersStore } from '@/stores/charactersStore'
import type { Character } from '@/types'

export default function RoleView() {
  const { characters, load, loading } = useCharactersStore()
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (characters.length === 0) {
      load()
    }
  }, [])

  const filtered = characters.filter(c =>
    c.name.includes(search) || c.title.includes(search)
  )

  const grouped = filtered.reduce((acc, char) => {
    const group = char.groups?.[0] || '默认'
    if (!acc[group]) acc[group] = []
    acc[group].push(char)
    return acc
  }, {} as Record<string, Character[]>)

  return (
    <div className="main">
      <div className="page-header">
        <span className="page-title">角色管理</span>
        <div className="header-actions">
          <input
            className="search-input"
            placeholder="搜索角色..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <button className="btn primary">+ 新建角色</button>
        </div>
      </div>
      <div className="content">
        {loading ? (
          <div className="empty-state">加载中...</div>
        ) : (
          Object.entries(grouped).map(([group, chars]) => (
            <div key={group}>
              <div className="group-title">{group}</div>
              <div className="star-grid">
                {chars.map(char => (
                  <div key={char.id} className="star-card">
                    <div className="star-art" style={{
                      background: `linear-gradient(135deg, ${char.color}15, ${char.color}08)`
                    }}>
                      {char.icon}
                    </div>
                    <div className="star-info">
                      <div className="star-name">{char.name}</div>
                      <div className="star-title">{char.title}</div>
                      <div className="star-desc">{char.desc}</div>
                      <div className="star-tags">
                        <span className="star-tag jade">已启用</span>
                        <span className="star-tag blue">{char.role === 'both' ? '主/子' : char.role === 'main' ? '主 Agent' : '子 Agent'}</span>
                        <span className="star-tag">{char.model}</span>
                      </div>
                      <div className="star-stats">
                        <div className="star-stat">
                          <div className="star-stat-value">{char.tools.length}</div>
                          <div className="star-stat-label">工具</div>
                        </div>
                        <div className="star-stat">
                          <div className="star-stat-value">{char.skills.length}</div>
                          <div className="star-stat-label">技能</div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
