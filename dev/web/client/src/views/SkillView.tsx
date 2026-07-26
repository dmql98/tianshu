import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchSkills, type SkillMeta } from '@/api/skills'
import { fetchCharacters } from '@/api/characters'

export default function SkillView() {
  const navigate = useNavigate()
  const [skills, setSkills] = useState<SkillMeta[]>([])
  const [charSkillMap, setCharSkillMap] = useState<Record<string, string[]>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([fetchSkills(), fetchCharacters()])
      .then(([skillData, characters]) => {
        setSkills(skillData.skills)
        // reverse lookup: skill name -> character names
        const map: Record<string, string[]> = {}
        for (const char of characters) {
          for (const skillName of char.skills || []) {
            if (!map[skillName]) map[skillName] = []
            map[skillName].push(char.name)
          }
        }
        setCharSkillMap(map)
      })
      .finally(() => setLoading(false))
  }, [])

  const grouped = skills.reduce((acc, s) => {
    const cat = s.category || '其他'
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(s)
    return acc
  }, {} as Record<string, SkillMeta[]>)

  const categoryLabels: Record<string, string> = {
    'low-code-platform': '低代码平台',
    'web': 'Web 工具',
    'xiaohongshu': '小红书',
  }

  const categoryIcons: Record<string, string> = {
    'low-code-platform': '🧩',
    'web': '🌐',
    'xiaohongshu': '📕',
  }

  return (
    <div className="main">
      <div className="page-header">
        <span className="page-title">技能管理</span>
        {!loading && (
          <span style={{ fontSize: 12, color: 'var(--ink-light)' }}>{skills.length} 个技能</span>
        )}
      </div>
      <div className="content">
        {loading ? (
          <div className="empty-state">加载中...</div>
        ) : skills.length === 0 ? (
          <div className="empty-state">
            <div className="empty-title">暂无技能</div>
            <div className="empty-hint">技能由进化引擎自动生成或手动创建</div>
          </div>
        ) : (
          Object.entries(grouped).map(([category, items]) => (
            <div key={category}>
              <div className="group-title">{categoryLabels[category] || category}</div>
              <div className="skill-grid">
                {items.map(skill => {
                  const boundChars = charSkillMap[skill.name] || []
                  return (
                    <div key={`${skill.category}/${skill.name}`} className="skill-card" onClick={() => navigate(`/skills/${skill.category}/${skill.name}`)}>
                      <div className="skill-card-header">
                        <div className="skill-icon" style={{ background: 'rgba(200,150,10,0.08)' }}>
                          {categoryIcons[category] || '⚡'}
                        </div>
                        <div className="skill-name">{skill.name}</div>
                      </div>
                      <div className="skill-desc">{skill.description}</div>
                      <div className="skill-meta">
                        <span className="skill-origin evolved">{categoryLabels[category] || category}</span>
                        {boundChars.length > 0 && (
                          <span>绑定: {boundChars.join(' ')}</span>
                        )}
                        <span>使用 -- 次</span>
                      </div>
                      <div className="skill-foot">
                        <span className="skill-rate">成功率 --</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
