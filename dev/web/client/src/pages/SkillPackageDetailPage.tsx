import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { fetchSkillChild, fetchSkillPackage, type SkillChildDetail, type SkillPackageDetail } from '@/api/skills'

type Tab = 'overview' | 'children' | 'resources' | 'dependencies' | 'bindings' | 'stats'

export default function SkillPackageDetailPage() {
  const { category, packageId, skillId } = useParams<{ category: string; packageId: string; skillId?: string }>()
  const navigate = useNavigate()
  const [detail, setDetail] = useState<SkillPackageDetail | null>(null)
  const [child, setChild] = useState<SkillChildDetail | null>(null)
  const [tab, setTab] = useState<Tab>(skillId ? 'children' : 'overview')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!category || !packageId) return
    setLoading(true)
    Promise.all([
      fetchSkillPackage(category, packageId),
      skillId ? fetchSkillChild(category, packageId, skillId) : Promise.resolve(null),
    ]).then(([pkg, selected]) => {
      setDetail(pkg)
      setChild(selected)
    }).finally(() => setLoading(false))
  }, [category, packageId, skillId])

  if (loading) return <div className="main"><div className="empty-state">加载中...</div></div>
  if (!detail) return <div className="main"><div className="empty-state">技能包未找到</div></div>

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'overview', label: '概览' },
    { id: 'children', label: `子技能 (${detail.childCount})` },
    { id: 'resources', label: '共享资源' },
    { id: 'dependencies', label: '依赖与权限' },
    { id: 'bindings', label: '绑定角色' },
    { id: 'stats', label: '版本与统计' },
  ]

  function openChild(id: string) {
    if (!category || !packageId) return
    setTab('children')
    navigate(`/skills/packages/${encodeURIComponent(category)}/${encodeURIComponent(packageId)}/skills/${encodeURIComponent(id)}`)
  }

  return (
    <div className="main">
      <div className="detail-header">
        <button className="back-btn" onClick={() => navigate('/skills')}>←</button>
        <div className="detail-header-info">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1>{detail.name}</h1>
            <span className="skill-origin evolved">{detail.childCount > 0 ? '层级技能包' : '单技能包'}</span>
          </div>
          <p>{detail.id}{detail.version ? ` · v${detail.version}` : ''}{detail.author ? ` · ${detail.author}` : ''}</p>
        </div>
      </div>
      <div className="detail-body">
        <aside className="detail-side">
          <div className="detail-side-icon" style={{ background: 'rgba(200,150,10,0.08)' }}>📦</div>
          <div className="detail-side-name">{detail.name}</div>
          <div className="detail-side-desc">{detail.description || '暂无描述'}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            <span className="skill-origin evolved">{detail.category}</span>
            <span className="skill-origin evolved">{detail.childCount} 个子技能</span>
            {detail.tags.map(tag => <span key={tag} className="skill-origin evolved">{tag}</span>)}
          </div>
          <div className="detail-actions">
            <button className="detail-btn primary" onClick={() => setTab('children')}>查看子技能</button>
            <button className="detail-btn" disabled title="将在安装/导出阶段接入">导出技能包</button>
          </div>
        </aside>
        <div className="detail-content">
          <div className="detail-tabs">
            {tabs.map(item => <button key={item.id} className={`detail-tab ${tab === item.id ? 'active' : ''}`} onClick={() => setTab(item.id)}>{item.label}</button>)}
          </div>

          {tab === 'overview' && <div className="tab-page active">
            <div className="detail-section"><div className="detail-section-title">根技能 · {detail.root}</div><div className="md-box">{detail.body || '(空)'}</div></div>
            <div className="detail-section"><div className="detail-section-title">包信息</div><div className="info-grid">
              <div className="info-item"><div className="info-item-label">包 ID</div><div className="info-item-value">{detail.id}</div></div>
              <div className="info-item"><div className="info-item-label">版本</div><div className="info-item-value">{detail.version || '--'}</div></div>
            </div></div>
          </div>}

          {tab === 'children' && <div className="tab-page active">
            <div className="detail-section"><div className="detail-section-title">子技能</div>
              {detail.children.length === 0 ? <div className="empty-state" style={{ padding: 20 }}>该技能包只有根技能，无需额外激活子技能</div> : <div className="tool-list">
                {detail.children.map(item => <div key={item.id} className="tool-item" style={{ cursor: 'pointer', background: child?.id === item.id ? 'rgba(42,157,92,0.06)' : undefined }} onClick={() => openChild(item.id)}>
                  <span>⚡</span><div style={{ flex: 1 }}><div className="tool-name">{item.name}</div><div style={{ fontSize: 11, color: 'var(--ink-light)' }}>{item.description}</div></div>
                </div>)}
              </div>}
            </div>
            {child && <div className="detail-section"><div className="detail-section-title">{detail.id}/{child.id}</div><div className="md-box">{child.body}</div></div>}
          </div>}

          {tab === 'resources' && <div className="tab-page active"><div className="detail-section"><div className="detail-section-title">共享资源</div>
            {detail.files.length === 0 ? <div className="empty-state" style={{ padding: 20 }}>暂无共享资源</div> : <div className="tool-list">{detail.files.map(file => <div key={file.path} className="tool-item"><span>📄</span><div className="tool-name">{file.path}</div><span className="skill-origin evolved">{file.type}</span></div>)}</div>}
          </div></div>}

          {tab === 'dependencies' && <div className="tab-page active"><div className="detail-section"><div className="detail-section-title">依赖与权限</div><div className="empty-state" style={{ padding: 20 }}>当前 Manifest 未声明额外依赖或权限</div></div></div>}
          {tab === 'bindings' && <div className="tab-page active"><div className="detail-section"><div className="detail-section-title">绑定角色</div><div className="empty-state" style={{ padding: 20 }}>请在角色详情的“技能”页签绑定或解绑整个技能包</div></div></div>}
          {tab === 'stats' && <div className="tab-page active"><div className="detail-section"><div className="detail-section-title">版本与统计</div><div className="info-grid"><div className="info-item"><div className="info-item-label">版本</div><div className="info-item-value">{detail.version || '--'}</div></div><div className="info-item"><div className="info-item-label">子技能</div><div className="info-item-value">{detail.childCount}</div></div></div></div></div>}
        </div>
      </div>
    </div>
  )
}
