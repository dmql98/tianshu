import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchCharacters } from '@/api/characters'
import type { Character } from '@/types'

const roleLabels: Record<string, string> = {
  main: '主 Agent',
  sub: '子 Agent',
  both: '主/子',
}

function timeAgo(ts: number | undefined): string {
  if (!ts) return ''
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return '刚刚活跃'
  if (mins < 60) return `${mins} 分钟前活跃`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} 小时前活跃`
  const days = Math.floor(hours / 24)
  return `${days} 天前活跃`
}

export default function CharactersPage() {
  const navigate = useNavigate()
  const [characters, setCharacters] = useState<Character[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    fetchCharacters()
      .then(setCharacters)
      .finally(() => setLoading(false))
  }, [])

  const filtered = characters.filter(c =>
    c.name.includes(search) || c.description.includes(search)
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
          <button className="btn primary" onClick={() => navigate('/characters/new')}>+ 新建角色</button>
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
                  <div key={char.id} className="star-card" onClick={() => navigate(`/characters/${char.id}`)}>
                    <div className="star-art" style={{
                      background: char.color
                        ? `linear-gradient(135deg, ${char.color}15, ${char.color}08)`
                        : 'linear-gradient(135deg, rgba(200,150,10,0.08), rgba(200,150,10,0.03))'
                    }}>
                      {char.avatar
                        ? <img src={char.avatar} alt={char.name} />
                        : <span style={{ fontSize: 56 }}>{char.name[0]}</span>
                      }
                    </div>
                    <div className="star-info">
                      <div className="star-name">{char.name}</div>
                      <div className="star-desc">{char.description}</div>
                      <div className="star-tags">
                        {char.enabled !== false && <span className="star-tag jade">已启用</span>}
                        <span className="star-tag blue">{roleLabels[char.role] || char.role}</span>
                        <span className="star-tag">{char.default_strategy}</span>
                        {char.model && <span className="star-tag">{char.model}</span>}
                      </div>
                      <div className="star-stats">
                        <div className="star-stat">
                          <div className="star-stat-value">{char.tools?.length || 0}</div>
                          <div className="star-stat-label">工具</div>
                        </div>
                        <div className="star-stat">
                          <div className="star-stat-value">{char.skills?.length || 0}</div>
                          <div className="star-stat-label">技能</div>
                        </div>
                        <div className="star-stat">
                          <div className="star-stat-value">--</div>
                          <div className="star-stat-label">会话</div>
                        </div>
                      </div>
                      {char.updatedAt && (
                        <div className="star-foot">
                          <span className="star-active">{timeAgo(char.updatedAt)}</span>
                        </div>
                      )}
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
