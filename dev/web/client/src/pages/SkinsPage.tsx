import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchSkins, createSkin, skinFileUrl, type Skin } from '@/api/skins'
import { useI18n } from '@/i18n'

export default function SkinsPage() {
  const t = useI18n()
  const navigate = useNavigate()
  const [skins, setSkins] = useState<Skin[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newId, setNewId] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    fetchSkins()
      .then(setSkins)
      .finally(() => setLoading(false))
  }, [])

  const filtered = skins.filter(s =>
    s.name.includes(search) || (s.description || '').includes(search) || s.id.includes(search)
  )

  const create = async () => {
    if (!newName.trim()) { setError(t('皮肤名称不能为空')); return }
    setError('')
    try {
      const skin = await createSkin({ id: newId.trim() || undefined, name: newName.trim() })
      setNewName('')
      setNewId('')
      setCreating(false)
      setSkins(prev => [...prev, skin])
    } catch (e) {
      setError(e instanceof Error ? e.message : t('创建失败'))
    }
  }

  const preview = (skin: Skin) => {
    // 优先用立绘，否则头像；无图用占位色卡。
    const url = skin.portrait
      ? skinFileUrl(skin.id, skin.portrait.filename)
      : skin.avatar ? skinFileUrl(skin.id, skin.avatar.filename) : null
    return url
      ? <img src={url} alt={skin.name} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      : <span className="visual-slot-empty" style={{ height: '100%', width: '100%' }}>{skin.name}</span>
  }

  return (
    <div className="main">
      <div className="page-header">
        <span className="page-title">{t('皮肤管理')}</span>
        <div className="header-actions">
          <input
            className="search-input"
            placeholder={t('搜索皮肤...')}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <button className="btn primary" onClick={() => setCreating(true)}>+ {t('新建皮肤')}</button>
        </div>
      </div>

      {creating && (
        <div className="approval-overlay" onClick={() => setCreating(false)}>
          <div className="approval-dialog" onClick={e => e.stopPropagation()} style={{ maxWidth: 460 }}>
            <div className="approval-title">{t('新建皮肤')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '8px 0' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label className="visual-slot-name">{t('皮肤名称')} *</label>
                <input className="search-input" autoFocus value={newName} onChange={e => setNewName(e.target.value)} placeholder={t('如：Miku、雷姆')} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label className="visual-slot-name">{t('皮肤 ID')}</label>
                <input className="search-input" value={newId} onChange={e => setNewId(e.target.value)} placeholder={t('可选，留空用名称生成；对应该皮肤目录')} />
              </div>
              {error && <div className="visual-editor-message" style={{ color: 'var(--danger, #e5484d)' }}>{error}</div>}
            </div>
            <div className="approval-actions">
              <button className="btn" onClick={() => setCreating(false)}>{t('取消')}</button>
              <button className="btn primary" onClick={() => void create()}>{t('创建')}</button>
            </div>
          </div>
        </div>
      )}

      <div className="content">
        {loading ? (
          <div className="empty-state">{t('加载中...')}</div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">{t('暂无皮肤，点击右上角「新建皮肤」创建')}</div>
        ) : (
          <div className="star-grid">
            {filtered.map(skin => (
              <div key={skin.id} className="star-card" onClick={() => navigate(`/skins/${skin.id}`)}>
                <div className="star-card-header">
                  <div className="star-avatar" style={{ background: 'linear-gradient(135deg, rgba(120,120,200,0.15), rgba(120,120,200,0.05))' }}>
                    <div style={{ width: '100%', height: '100%', overflow: 'hidden', borderRadius: 8 }}>{preview(skin)}</div>
                  </div>
                  <div className="star-card-heading">
                    <div className="star-name">{skin.name}</div>
                    <div className="star-desc">{skin.description || t('（无描述）')}</div>
                  </div>
                </div>
                <div className="star-info">
                  <div className="star-tags">
                    <span className="star-tag blue">{skin.id}</span>
                    <span className="star-tag">{Object.keys(skin.motions).length}/6 {t('动画')}</span>
                    {skin.boundCharacters && skin.boundCharacters.length > 0 && (
                      <span className="star-tag" style={{ background: 'rgba(200,150,10,0.12)', color: 'var(--ink-mid)' }}>{skin.boundCharacters.length} {t('角色使用')}</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
