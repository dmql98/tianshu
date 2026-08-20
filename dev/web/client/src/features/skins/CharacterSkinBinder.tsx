import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchSkins, skinFileUrl, type Skin } from '@/api/skins'
import { updateCharacter } from '@/api/characters'
import { invalidateCharacterVisual } from '@/features/characters/CharacterRenderer'
import type { Character } from '@/types'
import { useI18n } from '@/i18n'

interface Props {
  characterId: string
  skinId?: string
  name: string
}

/**
 * 角色详情页「视觉与动画」：角色绑定皮肤。
 *
 * 以皮肤立绘卡片网格展示所有皮肤；每张卡片下方一个激活/取消激活按钮，
 * 单选互斥：激活一个皮肤时其它皮肤自动回到未激活；取消激活当前皮肤回到未绑定。
 */
export default function CharacterSkinBinder({ characterId, skinId, name }: Props) {
  const t = useI18n()
  const navigate = useNavigate()
  const [skins, setSkins] = useState<Skin[]>([])
  const [loading, setLoading] = useState(true)
  // 当前激活的皮肤 id（与角色 skinId 同步；互斥单选的基准）。
  const [activeId, setActiveId] = useState<string>(skinId || '')
  const [message, setMessage] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)

  useEffect(() => {
    fetchSkins()
      .then(list => setSkins(list))
      .catch(() => setMessage(t('皮肤列表加载失败')))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { setActiveId(skinId || '') }, [skinId])

  // 皮肤立绘（无则用头像）URL，用于卡片展示。
  const previewUrlOf = (skin: Skin): string | null => {
    if (skin.portrait) return skinFileUrl(skin.id, skin.portrait.filename)
    if (skin.avatar) return skinFileUrl(skin.id, skin.avatar.filename)
    return null
  }

  // 保存激活状态：next 为空表示取消激活（回到未绑定）。
  const save = async (next: string) => {
    setSavingId(next)
    setMessage('')
    try {
      const updated: Character = await updateCharacter(characterId, { skinId: next || undefined })
      setActiveId(updated.skinId || '')
      // 皮肤变更后使角色视觉缓存失效，让卡片/侧边栏/详情页/舞台各点位刷新。
      invalidateCharacterVisual(characterId)
      setMessage(next
        ? t('已激活皮肤「{name}」', { name: (skins.find(s => s.id === next)?.name) || next })
        : t('已取消激活皮肤'))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('绑定失败'))
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div>
      <div className="detail-section" style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 16 }}>
        <div className="detail-section-title">{t('绑定皮肤')}</div>
        <div className="visual-slot-file" style={{ marginBottom: 12 }}>
          {activeId
            ? t('已激活：{name}', { name: (skins.find(s => s.id === activeId)?.name) || activeId })
            : t('未绑定皮肤 · 该角色将回退使用默认占位视觉')}
        </div>

        {loading ? (
          <div className="empty-state" style={{ padding: 12 }}>{t('加载中...')}</div>
        ) : skins.length === 0 ? (
          <div className="empty-state" style={{ padding: 12 }}>
            <span>{t('暂无皮肤，请先创建')}</span>
            <button className="btn primary" onClick={() => navigate('/skins')}>{t('去皮肤管理')}</button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
            {skins.map(skin => {
              const url = previewUrlOf(skin)
              const isActive = activeId === skin.id
              const busy = savingId === skin.id
              return (
                <div key={skin.id} className="star-card" style={{ width: 300, display: 'flex', flexDirection: 'column' }}>
                  <div
                    className="star-card-header"
                    style={{ cursor: 'default', flex: 1 }}
                    onClick={() => navigate(`/skins/${skin.id}`)}
                  >
                    <div
                      className="star-avatar"
                      style={{
                        width: 84,
                        height: 112,
                        border: isActive ? '2px solid var(--gold, #d4a017)' : '1px solid var(--border)',
                        borderRadius: 8,
                        overflow: 'hidden',
                        background: 'linear-gradient(135deg, rgba(120,120,200,0.15), rgba(120,120,200,0.05))',
                      }}
                    >
                      {url
                        ? <img src={url} alt={skin.name} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : <span className="visual-slot-empty" style={{ height: '100%', width: '100%' }}>{skin.name}</span>}
                    </div>
                    <div className="star-card-heading">
                      <div className="star-name">{skin.name}</div>
                      <div className="star-desc">{skin.description || skin.id}</div>
                    </div>
                  </div>
                  <div className="star-foot" style={{ borderTop: '1px solid var(--border)', padding: '8px 12px' }}>
                    {isActive ? (
                      <button
                        className="btn sm"
                        disabled={busy}
                        style={{ width: '100%', color: 'var(--danger, #e5484d)' }}
                        onClick={() => void save('')}
                      >
                        {busy ? t('保存中...') : t('取消激活')}
                      </button>
                    ) : (
                      <button
                        className="btn sm primary"
                        disabled={busy}
                        style={{ width: '100%' }}
                        onClick={() => void save(skin.id)}
                      >
                        {busy ? t('保存中...') : t('激活')}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {message && <div className="visual-editor-message">{message}</div>}
      </div>
    </div>
  )
}
