import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchSkillPackages, type SkillPackageMeta } from '@/api/skills'
import { fetchCharacters } from '@/api/characters'

const categoryLabels: Record<string, string> = {
  finance: '金融分析',
  tianshu: '天枢系统',
  web: 'Web 工具',
  xiaohongshu: '小红书',
  'low-code-platform': '低代码平台',
}

export default function SkillView() {
  const navigate = useNavigate()
  const [packages, setPackages] = useState<SkillPackageMeta[]>([])
  const [bindings, setBindings] = useState<Record<string, string[]>>({})
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([fetchSkillPackages(), fetchCharacters()])
      .then(([result, characters]) => {
        setPackages(result.packages)
        const next: Record<string, string[]> = {}
        for (const character of characters) {
          const ids = character.skillBindings?.map(binding => binding.packageId) || character.skills || []
          for (const id of ids) (next[id] ||= []).push(character.name)
        }
        setBindings(next)
      })
      .finally(() => setLoading(false))
  }, [])

  const grouped = packages.reduce((result, pkg) => {
    ;(result[pkg.category] ||= []).push(pkg)
    return result
  }, {} as Record<string, SkillPackageMeta[]>)

  return (
    <div className="main">
      <div className="page-header">
        <span className="page-title">技能管理</span>
        <span style={{ fontSize: 'calc(12px * var(--ui-font-scale))', color: 'var(--ink-light)' }}>{packages.length} 个技能包</span>
        <div style={{ flex: 1 }} />
        <button className="detail-btn primary" onClick={() => navigate('/skills/new')}>+ 新建技能包</button>
      </div>
      <div className="content">
        {loading ? <div className="empty-state">加载中...</div> : packages.length === 0 ? (
          <div className="empty-state"><div className="empty-title">暂无技能包</div></div>
        ) : Object.entries(grouped).map(([category, items]) => (
          <section key={category} style={{ marginBottom: 24 }}>
            <div className="group-title">{categoryLabels[category] || category}</div>
            <div className="skill-grid">
              {items.map(pkg => {
                const isOpen = !!expanded[pkg.id]
                const bound = bindings[pkg.id] || []
                return (
                  <div key={`${category}/${pkg.id}`} className="skill-card" style={{ cursor: 'default' }}>
                    <div className="skill-card-header">
                      <div className="skill-icon" style={{ background: 'rgba(200,150,10,0.08)' }}>📦</div>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="skill-name">{pkg.name}</div>
                        <div style={{ fontSize: 'calc(11px * var(--ui-font-scale))', color: 'var(--ink-faint)' }}>{pkg.id}{pkg.version ? ` · v${pkg.version}` : ''}</div>
                      </div>
                      <span className="skill-origin evolved">{pkg.childCount > 0 ? `${pkg.childCount} 个子技能` : '单技能包'}</span>
                    </div>
                    <div className="skill-desc">{pkg.description || '暂无描述'}</div>
                    <div className="skill-meta">
                      <span>{categoryLabels[category] || category}</span>
                      {bound.length > 0 && <span>绑定：{bound.join('、')}</span>}
                    </div>
                    {pkg.childCount > 0 && isOpen && (
                      <div style={{ borderTop: '1px solid var(--border)', marginTop: 12, paddingTop: 8 }}>
                        {pkg.children.map(child => (
                          <div key={child.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '7px 2px', fontSize: 'calc(12px * var(--ui-font-scale))' }}>
                            <span><b>{child.name}</b><span style={{ color: 'var(--ink-faint)' }}> · {child.description}</span></span>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="skill-foot" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                      {pkg.childCount > 0 && <button className="detail-btn" onClick={() => setExpanded(old => ({ ...old, [pkg.id]: !isOpen }))}>{isOpen ? '收起' : '展开'}</button>}
                      <button className="detail-btn primary" onClick={() => navigate(`/skills/packages/${encodeURIComponent(category)}/${encodeURIComponent(pkg.id)}`)}>详情</button>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
