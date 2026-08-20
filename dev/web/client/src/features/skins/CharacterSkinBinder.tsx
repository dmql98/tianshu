import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchSkins, skinFileUrl, type Skin } from '@/api/skins'
import { updateCharacter } from '@/api/characters'
import type { Character } from '@/types'
import { useI18n } from '@/i18n'

interface Props {
  characterId: string
  skinId?: string
  name: string
}

/**
 * 角色详情页「视觉与动画」：角色绑定皮肤。
 * 展示当前绑定皮肤、可切换皮肤、跳转皮肤编辑。
 */
export default function CharacterSkinBinder({ characterId, skinId, name }: Props) {
  const t = useI18n()
  const navigate = useNavigate()
  const [skins, setSkins] = useState<Skin[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string>(skinId || '')
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetchSkins()
      .then(list => { setSkins(list) })
      .catch(() => setMessage(t('皮肤列表加载失败')))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { setSelected(skinId || '') }, [skinId])

  const current = skins.find(s => s.id === selected) || null
  const previewUrl = current
    ? current.portrait
      ? skinFileUrl(current.id, current.portrait.filename)
      : current.avatar ? skinFileUrl(current.id, current.avatar.filename) : null
    : null

  const save = async (next: string) => {
    setSaving(true)
    setMessage('')
    try {
      const updated: Character = await updateCharacter(characterId, { skinId: next || undefined })
      setSelected(updated.skinId || '')
      setMessage(t('已绑定皮肤「{name}」', { name: (skins.find(s => s.id === next)?.name) || next || t('无') }))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('绑定失败'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="character-visual-editor">
      <div className="detail-section" style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 16 }}>
        <div className="detail-section-title">{t('绑定皮肤')}</div>
        <div className="visual-slot" style={{ alignItems: 'flex-start' }}>
          <div className="visual-slot-preview" style={{ width: 120, height: 160 }}>
            {previewUrl
              ? <img src={previewUrl} alt={current?.name || ''} style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'none' }} />
              : <span className="visual-slot-empty">{t('立绘')}</span>}
          </div>
          <div className="visual-slot-info" style={{ flex: 1 }}>
            <div className="visual-slot-name">
              {current ? current.name : selected ? selected : t('未绑定皮肤')}
            </div>
            <div className="visual-slot-file">
              {current?.description || (selected ? `${selected} · dataDir/skin/${selected}` : t('该角色将回退使用默认占位视觉'))}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
              <select
                className="search-input"
                style={{ width: 240 }}
                value={selected}
                disabled={saving}
                onChange={e => setSelected(e.target.value)}
              >
                <option value="">{t('（不绑定）')}</option>
                {skins.map(s => (
                  <option key={s.id} value={s.id}>{s.name}（{s.id}）</option>
                ))}
              </select>
              <button className="btn primary" disabled={saving || !loading && selected === (skinId || '')} onClick={() => { if (selected !== (skinId || '')) void save(selected) }}>
                {t('保存绑定')}
              </button>
              {current && (
                <button className="btn" onClick={() => navigate(`/skins/${current.id}`)}>{t('编辑皮肤')}</button>
              )}
              <button className="btn" onClick={() => navigate('/skins')}>{t('去皮肤管理')}</button>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          {skins.map(s => (
            <button
              key={s.id}
              className={`btn sm ${selected === s.id ? 'primary' : ''}`}
              onClick={() => { setSelected(s.id); if (s.id !== (skinId || '')) void save(s.id) }}
            >
              {s.name}
            </button>
          ))}
        </div>
        {message && <div className="visual-editor-message">{message}</div>}
        {loading && <div className="empty-state" style={{ padding: 12 }}>{t('加载中...')}</div>}
      </div>
    </div>
  )
}
