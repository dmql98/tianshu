import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { fetchSkillDetail, type SkillDetail } from '@/api/skills'

const categoryLabels: Record<string, string> = {
  'low-code-platform': '低代码平台',
  'web': 'Web 工具',
  'xiaohongshu': '小红书',
}

const fileTypeIcons: Record<string, string> = {
  reference: '📄',
  script: '⚙️',
  template: '📋',
  test: '🧪',
  asset: '📦',
  other: '📎',
}

export default function SkillDetailPage() {
  const { category, name: skillName } = useParams<{ category: string; name: string }>()
  const navigate = useNavigate()
  const [detail, setDetail] = useState<SkillDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('overview')
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (!category || !skillName) return
    fetchSkillDetail(category, skillName)
      .then(setDetail)
      .finally(() => setLoading(false))
  }, [category, skillName])

  const toggleFolder = (name: string) => {
    setOpenFolders(prev => ({ ...prev, [name]: !prev[name] }))
  }

  if (loading) {
    return (
      <div className="main">
        <div className="page-header">
          <button className="back-btn" onClick={() => navigate('/skills')}>←</button>
          <span className="page-title">加载中...</span>
        </div>
      </div>
    )
  }

  if (!detail) {
    return (
      <div className="main">
        <div className="page-header">
          <button className="back-btn" onClick={() => navigate('/skills')}>←</button>
          <span className="page-title">技能未找到</span>
        </div>
      </div>
    )
  }

  // group files by their directory type
  const filesByDir = detail.files.reduce((acc, f) => {
    const dir = f.path.split('/')[0] || 'other'
    if (!acc[dir]) acc[dir] = []
    acc[dir].push(f)
    return acc
  }, {} as Record<string, typeof detail.files>)

  return (
    <div className="main">
      <div className="detail-header">
        <button className="back-btn" onClick={() => navigate('/skills')}>←</button>
        <div className="detail-header-info">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1>{detail.name}</h1>
            <span className="skill-origin evolved">{categoryLabels[detail.category] || detail.category}</span>
          </div>
          <p>{detail.version ? `v${detail.version}` : ''}{detail.author ? ` · ${detail.author}` : ''}</p>
        </div>
      </div>

      <div className="detail-body">
        <div className="detail-side">
          <div className="detail-side-icon" style={{ background: 'rgba(200,150,10,0.08)', borderColor: 'rgba(200,150,10,0.2)' }}>⚡</div>
          <div className="detail-side-name">{detail.name}</div>
          <div className="detail-side-author">
            {detail.author ? `by ${detail.author}` : ''}{detail.version ? ` · v${detail.version}` : ''}
          </div>
          <div className="detail-side-desc">{detail.description}</div>
          {detail.tags.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {detail.tags.map(tag => (
                <span key={tag} className="skill-origin evolved">{tag}</span>
              ))}
            </div>
          )}
          <div className="detail-actions">
            <button className="detail-btn primary">测试运行</button>
            <button className="detail-btn">导出配置</button>
          </div>
        </div>

        <div className="detail-content">
          <div className="detail-tabs">
            {['overview', 'tools', 'stats'].map(tab => (
              <button
                key={tab}
                className={`detail-tab ${activeTab === tab ? 'active' : ''}`}
                onClick={() => setActiveTab(tab)}
              >
                {tab === 'overview' ? '概览' : tab === 'tools' ? '依赖工具' : '统计'}
              </button>
            ))}
          </div>

          {/* 概览 */}
          <div className={`tab-page ${activeTab === 'overview' ? 'active' : ''}`}>
            <div className="detail-section">
              <div className="detail-section-title">SKILL.md</div>
              <div className="md-box">{detail.body || '(空)'}</div>
            </div>

            {Object.keys(filesByDir).length > 0 && (
              <div className="detail-section">
                <div className="detail-section-title">附件</div>
                <div className="tool-list">
                  {Object.entries(filesByDir).map(([dir, files]) => (
                    <div key={dir}>
                      <div className="tool-item" style={{ cursor: 'pointer' }} onClick={() => toggleFolder(dir)}>
                        <span style={{ fontSize: 14 }}>📁</span>
                        <div className="tool-name">{dir}</div>
                        <span style={{ fontSize: 10, color: 'var(--ink-faint)', marginLeft: 'auto' }}>{files.length} 个文件</span>
                        <span style={{ fontSize: 10, color: 'var(--ink-faint)' }}>{openFolders[dir] ? '▼' : '▶'}</span>
                      </div>
                      {openFolders[dir] && files.map(file => (
                        <div key={file.path} className="tool-item" style={{ paddingLeft: 44, background: 'var(--bg-input)' }}>
                          <span style={{ fontSize: 12 }}>{fileTypeIcons[file.type] || '📎'}</span>
                          <div className="tool-name">{file.name}</div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="detail-section">
              <div className="detail-section-title">来源信息</div>
              <div className="info-grid">
                <div className="info-item"><div className="info-item-label">分类</div><div className="info-item-value">{categoryLabels[detail.category] || detail.category}</div></div>
                <div className="info-item"><div className="info-item-label">版本</div><div className="info-item-value">{detail.version || '--'}</div></div>
                <div className="info-item"><div className="info-item-label">作者</div><div className="info-item-value">{detail.author || '--'}</div></div>
                <div className="info-item"><div className="info-item-label">标签</div><div className="info-item-value">{detail.tags.join(', ') || '--'}</div></div>
              </div>
            </div>
          </div>

          {/* 依赖工具 */}
          <div className={`tab-page ${activeTab === 'tools' ? 'active' : ''}`}>
            <div className="detail-section">
              <div className="detail-section-title">所需工具</div>
              <div className="empty-state" style={{ padding: 20 }}>
                <div className="empty-hint">工具依赖信息待开发</div>
              </div>
            </div>
          </div>

          {/* 统计 */}
          <div className={`tab-page ${activeTab === 'stats' ? 'active' : ''}`}>
            <div className="detail-section">
              <div className="detail-section-title">使用概览</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
                <div className="info-item"><div className="info-item-label">调用次数</div><div className="info-item-value">--</div></div>
                <div className="info-item"><div className="info-item-label">成功率</div><div className="info-item-value">--</div></div>
                <div className="info-item"><div className="info-item-label">平均耗时</div><div className="info-item-value">--</div></div>
                <div className="info-item"><div className="info-item-label">绑定角色</div><div className="info-item-value">--</div></div>
              </div>
            </div>
            <div className="detail-section">
              <div className="detail-section-title">调用趋势</div>
              <div className="empty-state" style={{ padding: 20 }}>
                <div className="empty-hint">需要后端 skill_usage 打点后展示</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
