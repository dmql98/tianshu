import { useState, useEffect, useRef } from 'react'
import { useChatStore } from '@/stores/chatStore'
import { useUIStore } from '@/stores/uiStore'
import { fetchCharacters } from '@/api/characters'
import CharacterPicker from './CharacterPicker'
import GoalPanel from './GoalPanel'
import CharacterRenderer from '@/features/characters/CharacterRenderer'
import type { Character } from '@/types'
import { useI18n } from '@/i18n'

export default function RightPanel() {
  const { sessions, activeSessionId, addWorkspace, removeWorkspace, tokenUsage } = useChatStore()
  const { toggleRightPanel } = useUIStore()
  const t = useI18n()
  const session = sessions.find(s => s.id === activeSessionId)
  const [character, setCharacter] = useState<Character | null>(null)
  const [showPicker, setShowPicker] = useState(false)
  const charCache = useRef<Map<string, Character>>(new Map())

  useEffect(() => {
    if (!session?.character_id) { setCharacter(null); return }
    const cached = charCache.current.get(session.character_id)
    if (cached) { setCharacter(cached); return }
    fetchCharacters()
      .then(chars => {
        for (const c of chars) charCache.current.set(c.id, c)
        setCharacter(chars.find(c => c.id === session.character_id) || null)
      })
      .catch(() => setCharacter(null))
  }, [session?.character_id])

  if (!session) {
    return (
      <aside className="right-panel">
        <div className="rp-header"><span className="rp-title">{t('详情')}</span><span className="rp-close" onClick={toggleRightPanel}>✕</span></div>
        <div className="rp-body" style={{ padding: 20, textAlign: 'center', color: 'var(--ink-faint)', fontSize: 'calc(12px * var(--ui-font-scale))' }}>
          {t('选择一个会话查看详情')}
        </div>
      </aside>
    )
  }

  const starColor = character?.color || 'var(--gold)'
  const starName = character?.name || session.character_id || t('未分配')
  const starTitle = character?.description || ''
  const messages = session.messages || []
  const toolCalls = messages.filter(m => m.role === 'tool').length

  // Parse workspaces
  let workspaces: string[] = []
  if (session.workspaces) {
    try {
      workspaces = typeof session.workspaces === 'string'
        ? JSON.parse(session.workspaces) : session.workspaces
    } catch { /* ignore */ }
  } else if (session.workspace) {
    workspaces = [session.workspace]
  }
  // 授权工作区 = all workspaces except the project area
  const authorizedWorkspaces = workspaces.filter(ws => ws !== session.workspace)

  // Context usage estimate (match old frontend logic)
  let totalChars = 0
  for (const m of messages) {
    if (m.role === 'tool') {
      if (m.tool_output) totalChars += m.tool_output.length
    } else {
      if (m.content) totalChars += m.content.length
    }
    if (m.reasoning) totalChars += m.reasoning.length
    totalChars += 16
  }
  const tokenEst = Math.ceil(totalChars / 4)
  const totalTokens = tokenUsage.total || ((session.input_tokens || 0) + (session.output_tokens || 0))

  function formatTokens(n: number): string {
    if (n >= 1000000) return `${(n / 1000000).toFixed(n % 1000000 === 0 ? 0 : 1)}M`
    if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K`
    return String(n)
  }

  return (
    <aside className="right-panel">
      <div className="rp-header">
        <span className="rp-title">详情</span>
        <span className="rp-close" onClick={toggleRightPanel}>✕</span>
      </div>
      <div className="rp-body">
        {/* Character art or add button */}
        {character ? (
          <div className="rp-art-card">
            <div className="rp-art" style={{ background: `linear-gradient(135deg, ${starColor}15, ${starColor}08)` }}>
              <CharacterRenderer
                characterId={character.id}
                name={starName}
                legacyAvatar={character.avatar}
                mode="portrait"
                className="character-renderer-right-panel"
              />
            </div>
            <div className="rp-art-info">
              <div className="rp-art-name">{starName}</div>
              <div className="rp-art-title">{starTitle}</div>
            </div>
          </div>
        ) : (
          <div
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              padding: 24, gap: 8,
            }}
          >
            <div style={{
              width: 64, height: 64, borderRadius: 16, border: '2px dashed var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 28, color: 'var(--ink-faint)', background: 'var(--bg-input)',
              transition: 'all 0.15s',
            }}
            >+</div>
            <span style={{ fontSize: 'calc(12px * var(--ui-font-scale))', color: 'var(--ink-faint)' }}>{t('尚未选择角色')}</span>
          </div>
        )}

        <div className="rp-character-actions">
          <button className="btn rp-switch-character" onClick={() => setShowPicker(true)}>
            {character ? t('切换人物') : t('选择人物')}
          </button>
        </div>

        {/* Character picker modal */}
        {showPicker && activeSessionId && (
          <CharacterPicker
            sessionId={activeSessionId}
            onSelect={c => setCharacter(c)}
            onClose={() => setShowPicker(false)}
          />
        )}

        {/* 项目区 — bound at creation, read-only */}
        <div className="rp-section">
          <div className="rp-section-title">{t('项目区')}</div>
          {session.workspace ? (
            <div className="rp-ws-item">
              <span className="rp-ws-path">{session.workspace}</span>
            </div>
          ) : (
            <div style={{ fontSize: 'calc(11px * var(--ui-font-scale))', color: 'var(--ink-faint)' }}>{t('未设置项目')}</div>
          )}
        </div>

        {/* 授权工作区 — add/remove freely */}
        <div className="rp-section">
          <div className="rp-section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            {t('授权工作区')}
            <button
              style={{ background: 'none', border: 'none', color: 'var(--gold)', cursor: 'pointer', fontSize: 'calc(14px * var(--ui-font-scale))', lineHeight: 1 }}
              title={t('添加路径')}
              onClick={() => {
                const path = prompt(t('输入工作区路径：'))
                if (path) addWorkspace(path)
              }}
            >+</button>
          </div>
          {authorizedWorkspaces.length === 0 ? (
            <div style={{ fontSize: 'calc(11px * var(--ui-font-scale))', color: 'var(--ink-faint)' }}>{t('无授权工作区')}</div>
          ) : authorizedWorkspaces.map((ws, i) => (
            <div key={i} className="rp-ws-item">
              <span className="rp-ws-path">{ws}</span>
              <button className="rp-ws-del" title={t('删除')} onClick={() => removeWorkspace(ws)}>✕</button>
            </div>
          ))}
        </div>

        {/* Goal / Plan (goal mode disabled; existing 'goal' sessions show as plan_first) */}
        <GoalPanel sessionId={session.id} mode={((session as any).execution_mode === 'goal' ? 'plan_first' : (session as any).execution_mode) || 'direct'} />

        {/* Session stats */}
        <div className="rp-section">
          <div className="rp-section-title">{t('会话统计')}</div>
          {session.compacted && (
            <div style={{ fontSize: 'calc(10px * var(--ui-font-scale))', color: 'var(--gold)', marginTop: 4 }}>⚠ {t('会话已压缩')}</div>
          )}
          <div className="rp-stats">
            <div className="rp-stat"><div className="rp-stat-value">{messages.length}</div><div className="rp-stat-label">{t('消息')}</div></div>
            <div className="rp-stat"><div className="rp-stat-value">{formatTokens(totalTokens || tokenEst)}</div><div className="rp-stat-label">Tokens</div></div>
            <div className="rp-stat"><div className="rp-stat-value">{toolCalls}</div><div className="rp-stat-label">{t('工具调用')}</div></div>
            <div className="rp-stat"><div className="rp-stat-value">{session.cacheStats?.hitRatio || session.cache_hit_ratio || '--'}</div><div className="rp-stat-label">{t('缓存命中')}</div></div>
          </div>
        </div>
      </div>
    </aside>
  )
}
