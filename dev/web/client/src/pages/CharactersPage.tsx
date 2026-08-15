import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchCharacters, type CharacterMotion } from '@/api/characters'
import type { Character } from '@/types'
import CharacterRenderer from '@/features/characters/CharacterRenderer'
import type { I18nState } from '@/i18n'
import { useI18n } from '@/i18n'

type T = I18nState['t']

const roleLabelKeys: Record<string, string> = {
  main: '主 Agent',
  sub: '子 Agent',
  both: '主/子',
}

const previewMotions: Array<{ id: CharacterMotion; label: string }> = [
  { id: 'idle', label: '待机' },
  { id: 'thinking', label: '思考' },
  { id: 'working', label: '工作' },
  { id: 'speaking', label: '说话' },
  { id: 'success', label: '完成' },
  { id: 'error', label: '出错' },
]

function timeAgo(ts: number | undefined, t: T): string {
  if (!ts) return ''
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return t('刚刚活跃')
  if (mins < 60) return t('{n} 分钟前活跃', { n: mins })
  const hours = Math.floor(mins / 60)
  if (hours < 24) return t('{n} 小时前活跃', { n: hours })
  const days = Math.floor(hours / 24)
  return t('{n} 天前活跃', { n: days })
}

export default function CharactersPage() {
  const navigate = useNavigate()
  const t = useI18n()
  const [characters, setCharacters] = useState<Character[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [previewCharacter, setPreviewCharacter] = useState<Character | null>(null)
  const [previewMotion, setPreviewMotion] = useState<CharacterMotion>('idle')

  useEffect(() => {
    fetchCharacters()
      .then(setCharacters)
      .finally(() => setLoading(false))
  }, [])

  const filtered = characters.filter(c =>
    c.name.includes(search) || (c.description || '').includes(search)
  )

  const grouped = filtered.reduce((acc, char) => {
    const group = char.groups?.[0] || t('默认')
    if (!acc[group]) acc[group] = []
    acc[group].push(char)
    return acc
  }, {} as Record<string, Character[]>)

  return (
    <div className="main">
      <div className="page-header">
        <span className="page-title">{t('角色管理')}</span>
        <div className="header-actions">
          <input
            className="search-input"
            placeholder={t('搜索角色...')}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <button className="btn primary" onClick={() => navigate('/characters/new')}>+ {t('新建角色')}</button>
        </div>
      </div>
      <div className="content">
        {loading ? (
          <div className="empty-state">{t('加载中...')}</div>
        ) : (
          Object.entries(grouped).map(([group, chars]) => (
            <div key={group}>
              <div className="group-title">{group}</div>
              <div className="star-grid">
                {chars.map(char => (
                  <div key={char.id} className="star-card" onClick={() => navigate(`/characters/${char.id}`)}>
                    <div className="star-card-header">
                      <div className="star-avatar" style={{
                        background: char.color
                          ? `linear-gradient(135deg, ${char.color}20, ${char.color}08)`
                          : 'linear-gradient(135deg, rgba(200,150,10,0.12), rgba(200,150,10,0.04))'
                      }}>
                        <CharacterRenderer
                          characterId={char.id}
                          name={char.name}
                          legacyAvatar={char.avatar}
                          mode="avatar"
                          className="character-renderer-card"
                        />
                      </div>
                      <div className="star-card-heading">
                        <div className="star-name">{char.name}</div>
                        <div className="star-desc">{char.description || t('暂无角色简介')}</div>
                      </div>
                    </div>
                    <div className="star-info">
                      <div className="star-tags">
                        <span className="star-tag blue">{roleLabelKeys[char.role] ? t(roleLabelKeys[char.role]) : char.role}</span>
                        <span className="star-tag">{char.default_strategy}</span>
                        {char.model && <span className="star-tag">{char.model}</span>}
                        {char.source === 'builtin' && <span className="star-tag" style={{ background: 'rgba(120,120,200,0.15)', color: 'var(--ink-mid)' }}>{t('内置')}</span>}
                        {char.source === 'user' && char.overridesBuiltin && <span className="star-tag" style={{ background: 'rgba(40,160,120,0.15)', color: 'var(--ink-mid)' }}>{t('已自定义')}</span>}
                        {char.source === 'user' && !char.overridesBuiltin && <span className="star-tag" style={{ background: 'rgba(40,160,120,0.12)', color: 'var(--ink-mid)' }}>{t('我的')}</span>}
                      </div>
                    </div>
                    <div className="star-stats">
                        <div className="star-stat">
                          <div className="star-stat-value">{char.tools?.length || 0}</div>
                          <div className="star-stat-label">{t('工具')}</div>
                        </div>
                        <div className="star-stat">
                          <div className="star-stat-value">{char.skills?.length || 0}</div>
                          <div className="star-stat-label">{t('技能')}</div>
                        </div>
                        <div className="star-stat">
                          <div className="star-stat-value">--</div>
                          <div className="star-stat-label">{t('会话')}</div>
                        </div>
                      </div>
                      {char.updatedAt && (
                        <div className="star-foot">
                          <span className="star-active">{timeAgo(char.updatedAt, t)}</span>
                          <button
                            className="btn sm star-preview-btn"
                            onClick={event => {
                              event.stopPropagation()
                              setPreviewMotion('idle')
                              setPreviewCharacter(char)
                            }}
                          >
                            {t('预览动画')}
                          </button>
                        </div>
                      )}
                      {!char.updatedAt && (
                        <div className="star-foot star-foot-actions">
                          <button
                            className="btn sm star-preview-btn"
                            onClick={event => {
                              event.stopPropagation()
                              setPreviewMotion('idle')
                              setPreviewCharacter(char)
                            }}
                          >
                            {t('预览动画')}
                          </button>
                        </div>
                      )}
                    </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
      {previewCharacter && (
        <div className="approval-overlay character-preview-overlay" onClick={() => setPreviewCharacter(null)}>
          <div
            className="approval-dialog character-preview-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={t('{name} 动画预览', { name: previewCharacter.name })}
            onClick={event => event.stopPropagation()}
          >
            <div className="character-preview-header">
              <div>
                <div className="character-preview-title">{previewCharacter.name} · {t('动画预览')}</div>
                <div className="character-preview-subtitle">{t('未配置的动作会自动使用待机动画或立绘')}</div>
              </div>
              <button className="btn sm" onClick={() => setPreviewCharacter(null)}>{t('关闭')}</button>
            </div>
            <CharacterRenderer
              key={`${previewCharacter.id}-${previewMotion}`}
              characterId={previewCharacter.id}
              name={previewCharacter.name}
              legacyAvatar={previewCharacter.avatar}
              mode="stage"
              motion={previewMotion}
              className="character-renderer-preview"
            />
            <div className="character-preview-motions" role="group" aria-label={t('选择预览动作')}>
              {previewMotions.map(item => (
                <button
                  key={item.id}
                  className={`btn sm ${previewMotion === item.id ? 'primary' : ''}`}
                  onClick={() => setPreviewMotion(item.id)}
                >
                  {t(item.label)}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
