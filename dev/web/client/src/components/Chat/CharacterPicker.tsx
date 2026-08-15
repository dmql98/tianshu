import { useState, useMemo, useEffect } from 'react'
import { fetchCharacters } from '@/api/characters'
import { updateSession } from '@/api/sessions'
import { useChatStore } from '@/stores/chatStore'
import CharacterRenderer from '@/features/characters/CharacterRenderer'
import type { Character } from '@/types'
import { useI18n } from '@/i18n'

interface Props {
  sessionId: string
  onSelect: (character: Character) => void
  onClose: () => void
}

export default function CharacterPicker({ sessionId, onSelect, onClose }: Props) {
  const t = useI18n()
  const [characters, setCharacters] = useState<Character[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [groupView, setGroupView] = useState(false)
  const { sessions } = useChatStore()
  const session = sessions.find(s => s.id === sessionId)

  useEffect(() => {
    fetchCharacters()
      .then(setCharacters)
      .finally(() => setLoading(false))
  }, [])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return characters.filter(c =>
      !q || c.name.toLowerCase().includes(q) || (c.description || '').toLowerCase().includes(q)
    )
  }, [characters, search])

  const grouped = useMemo(() => {
    const groups = new Map<string, Character[]>()
    const uncategorized: Character[] = []
    for (const c of filtered) {
      if (!c.groups || c.groups.length === 0) { uncategorized.push(c); continue }
      for (const grp of c.groups) {
        if (!groups.has(grp)) groups.set(grp, [])
        groups.get(grp)!.push(c)
      }
    }
    const result: { name: string; chars: Character[] }[] = []
    for (const [name, chars] of groups) result.push({ name, chars })
    result.sort((a, b) => a.name.localeCompare(b.name))
    if (uncategorized.length > 0) result.push({ name: t('未分组'), chars: uncategorized })
    return result
  }, [filtered])

  function handleSelect(c: Character) {
    if (c.role === 'sub') return // sub agents can't be primary
    updateSession(sessionId, { character_id: c.id }).catch(() => {})
    useChatStore.setState(state => ({
      sessions: state.sessions.map(s =>
        s.id === sessionId ? { ...s, character_id: c.id } : s
      ),
    }))
    onSelect(c)
    onClose()
  }

  function renderItem(c: Character) {
    const isActive = session?.character_id === c.id
    const isDisabled = c.role === 'sub'
    return (
      <button
        key={c.id}
        className="modal-item"
        style={{
          display: 'flex', alignItems: 'center', gap: 12, width: '100%',
          padding: '10px 12px', border: 'none', borderRadius: 8, background: isActive ? 'rgba(200,150,10,0.08)' : 'transparent',
          cursor: isDisabled ? 'default' : 'pointer', fontSize: 'calc(13px * var(--ui-font-scale))', textAlign: 'left',
          opacity: isDisabled ? 0.45 : 1, transition: 'background 0.12s',
          color: 'var(--ink-deep)',
        }}
        onClick={() => !isDisabled && handleSelect(c)}
        onMouseEnter={e => { if (!isDisabled && !isActive) e.currentTarget.style.background = 'var(--bg-hover)' }}
        onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
      >
        <span style={{
          width: 80, height: 80, borderRadius: '50%', border: `2px solid ${c.color || 'var(--border)'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          background: 'var(--bg-hover)', overflow: 'hidden',
        }}>
          <CharacterRenderer
            characterId={c.id}
            name={c.name}
            legacyAvatar={c.avatar}
            mode="avatar"
            className="character-renderer-picker"
          />
        </span>
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 'calc(14px * var(--ui-font-scale))', fontWeight: 500 }}>{c.name}</span>
          <span style={{ fontSize: 'calc(12px * var(--ui-font-scale))', color: 'var(--ink-light)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.description || ''}</span>
        </span>
        {c.role === 'main' && <span style={{ fontSize: 'calc(11px * var(--ui-font-scale))', padding: '2px 8px', borderRadius: 8, background: 'rgba(37,99,235,0.08)', color: 'var(--blue)', flexShrink: 0 }}>main</span>}
        {c.role === 'sub' && <span style={{ fontSize: 'calc(11px * var(--ui-font-scale))', padding: '2px 8px', borderRadius: 8, background: 'var(--bg-hover)', color: 'var(--ink-faint)', flexShrink: 0 }}>sub</span>}
        {c.role === 'both' && <span style={{ fontSize: 'calc(11px * var(--ui-font-scale))', padding: '2px 8px', borderRadius: 8, background: 'rgba(200,150,10,0.08)', color: 'var(--gold)', flexShrink: 0 }}>{t('主/子')}</span>}
      </button>
    )
  }

  return (
    <div className="approval-overlay" onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg-card)', borderRadius: 12, width: 800, height: 650, maxWidth: '92vw',
          display: 'flex', flexDirection: 'column', boxShadow: '0 8px 32px rgba(0,0,0,0.18)', overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px 0' }}>
          <span style={{ fontSize: 'calc(15px * var(--ui-font-scale))', fontWeight: 600, color: 'var(--ink-deep)' }}>{t('选择角色')}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={() => setGroupView(!groupView)}
              title={groupView ? t('列表视图') : t('分组视图')}
              style={{
                width: 40, height: 40, border: `1px solid ${groupView ? 'var(--gold)' : 'var(--border)'}`,
                borderRadius: 8, background: groupView ? 'rgba(200,150,10,0.08)' : 'var(--bg-input)',
                cursor: 'pointer', color: groupView ? 'var(--gold)' : 'var(--ink-faint)', padding: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 'calc(18px * var(--ui-font-scale))',
              }}
            >▦</button>
            <button
              onClick={onClose}
              style={{ width: 40, height: 40, fontSize: 28, color: 'var(--ink-faint)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 1, borderRadius: 8 }}
            >×</button>
          </div>
        </div>

        {/* Search */}
        <div style={{ padding: '10px 16px' }}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('搜索角色...')}
            autoFocus
            style={{
              width: '100%', padding: '8px 12px', border: '1px solid var(--border)',
              borderRadius: 8, fontSize: 'calc(13px * var(--ui-font-scale))', outline: 'none', boxSizing: 'border-box',
              background: 'var(--bg-input)', color: 'var(--ink-deep)',
            }}
          />
        </div>

        {/* List */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px 12px' }}>
          {loading ? (
            <div style={{ padding: 32, textAlign: 'center', fontSize: 'calc(13px * var(--ui-font-scale))', color: 'var(--ink-faint)' }}>{t('加载中...')}</div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', fontSize: 'calc(13px * var(--ui-font-scale))', color: 'var(--ink-faint)' }}>{t('无角色')}</div>
          ) : groupView ? (
            grouped.map(grp => (
              <div key={grp.name} style={{ marginBottom: 4 }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px 4px',
                  fontSize: 'calc(11px * var(--ui-font-scale))', fontWeight: 600, color: 'var(--ink-faint)', textTransform: 'uppercase', letterSpacing: 0.5,
                }}>
                  {grp.name}
                  <span style={{
                    fontSize: 'calc(10px * var(--ui-font-scale))', color: '#fff', background: 'var(--ink-faint)',
                    borderRadius: 8, padding: '0 6px', lineHeight: '16px', minWidth: 16, textAlign: 'center',
                  }}>{grp.chars.length}</span>
                </div>
                {grp.chars.map(renderItem)}
              </div>
            ))
          ) : (
            filtered.map(renderItem)
          )}
        </div>
      </div>
    </div>
  )
}
