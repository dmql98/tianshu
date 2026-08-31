import { useState, useEffect } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { fetchCharacters } from '@/api/characters'
import type { Character } from '@/types'
import CharacterRenderer from '@/features/characters/CharacterRenderer'
import { useI18n } from '@/i18n'
import SkinsPage from './SkinsPage'
import CharacterDetailPage from './CharacterDetailPage'

const roleLabelKeys: Record<string, string> = {
  main: '主 Agent',
  sub: '子 Agent',
  both: '主/子',
}

export default function CharactersPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { id } = useParams<{ id: string }>()
  // `/characters/new` 是静态路由，useParams 没有 id；从 pathname 判断
  const isNew = location.pathname.endsWith('/characters/new')
  const t = useI18n()
  const [tab, setTab] = useState<'characters' | 'skins'>('characters')
  const [characters, setCharacters] = useState<Character[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  // 选中项变化时重新拉列表（覆盖新建/改名/删除后的最新状态）
  useEffect(() => {
    fetchCharacters()
      .then(setCharacters)
      .finally(() => setLoading(false))
  }, [id, isNew])

  // 无选中项时自动选中第一个角色（深链 /characters 也有内容可看）
  useEffect(() => {
    if (!loading && !isNew && !id && characters.length > 0) {
      navigate(`/characters/${characters[0].id}`, { replace: true })
    }
  }, [loading, isNew, id, characters, navigate])

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
      <div className="detail-tabs detail-tabs-page">
        <button className={`detail-tab ${tab === 'characters' ? 'active' : ''}`} onClick={() => setTab('characters')}>{t('角色')}</button>
        <button className={`detail-tab ${tab === 'skins' ? 'active' : ''}`} onClick={() => setTab('skins')}>{t('皮肤')}</button>
      </div>
      {tab === 'skins' ? (
        <SkinsPage />
      ) : (
        <div className="char-md">
          <aside className="char-side">
            <div className="char-side-head">
              <span className="char-side-title">{t('角色')}</span>
              <button className="btn sm primary" onClick={() => navigate('/characters/new')}>+ {t('新建')}</button>
            </div>
            <div className="char-side-search">
              <input
                className="search-input"
                placeholder={t('搜索角色...')}
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <div className="char-side-list">
              {loading ? (
                <div className="empty-state" style={{ padding: 24 }}>{t('加载中...')}</div>
              ) : characters.length === 0 ? (
                <div className="empty-state" style={{ padding: 24 }}>
                  <div className="empty-hint">{t('还没有角色')}</div>
                  <button className="btn primary" onClick={() => navigate('/characters/new')}>+ {t('新建角色')}</button>
                </div>
              ) : filtered.length === 0 ? (
                <div className="empty-state" style={{ padding: 24 }}>
                  <div className="empty-hint">{t('没有匹配的角色')}</div>
                </div>
              ) : (
                Object.entries(grouped).map(([group, chars]) => (
                  <div key={group}>
                    <div className="char-group-title">{group}</div>
                    {chars.map(char => (
                      <div
                        key={char.id}
                        className={`char-card ${!isNew && char.id === id ? 'active' : ''}`}
                        onClick={() => navigate(`/characters/${char.id}`)}
                      >
                        <div className="char-card-avatar" style={{
                          background: char.color
                            ? `linear-gradient(135deg, ${char.color}20, ${char.color}08)`
                            : 'linear-gradient(135deg, var(--gold-soft), var(--gold-mist))'
                        }}>
                          <CharacterRenderer
                            characterId={char.id}
                            name={char.name}
                            legacyAvatar={char.avatar}
                            mode="avatar"
                            className="character-renderer-card"
                          />
                        </div>
                        <div className="char-card-main">
                          <div className="char-card-name">
                            {char.name}
                            {char.enabled === false && <span className="char-off">{t('停用')}</span>}
                          </div>
                          <div className="char-card-sub">
                            {roleLabelKeys[char.role] ? t(roleLabelKeys[char.role]) : char.role}
                            {' · '}{char.tools?.length || 0} {t('工具')}
                            {' · '}{char.skills?.length || 0} {t('技能')}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ))
              )}
            </div>
          </aside>
          <div className="char-detail">
            {isNew || id ? (
              <CharacterDetailPage key={isNew ? 'new' : id} />
            ) : (
              <div className="empty-state">
                <div className="empty-hint">{t('从左侧选择一个角色，或新建角色')}</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
