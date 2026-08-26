import { useState, useEffect, useRef } from 'react'
import { useChatStore } from '@/stores/chatStore'
import { useUIStore } from '@/stores/uiStore'
import { fetchCharacters } from '@/api/characters'
import CharacterPicker from './CharacterPicker'
import FolderPicker from './FolderPicker'
import Icon from '@/features/icons/Icon'
import GoalPanel from './GoalPanel'
import CharacterRenderer from '@/features/characters/CharacterRenderer'
import { useSessionStats } from '@/features/chat/useSessionStats'
import { buildStatsCards } from '@/features/chat/runStats'
import type { Character } from '@/types'
import { useI18n } from '@/i18n'

async function openWorkspaceDir(path: string): Promise<void> {
  const api = window.tianshuDesktop
  if (api?.openPath) {
    try {
      const ok = await api.openPath(path)
      if (ok) return
    } catch {
      // fall through to the server route
    }
  }
  try {
    await fetch('/api/workspace/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    })
  } catch {
    // filesystem open is best-effort; ignore network/OS failures
  }
}

export default function RightPanel() {
  const { sessions, activeSessionId, addWorkspace, removeWorkspace, updateSessionTargets } = useChatStore()
  const { toggleRightPanel } = useUIStore()
  const t = useI18n()
  const [showFolderPicker, setShowFolderPicker] = useState(false)

  // 桌面端用系统原生文件夹选择框；无桥（纯网页端）时回退到 in-app FolderPicker。
  const handleAddWorkspace = async () => {
    const api = window.tianshuDesktop
    if (api?.openDirectoryDialog) {
      try {
        const dir = await api.openDirectoryDialog(session?.workspace ?? undefined, t('选择授权工作区目录'))
        if (dir) addWorkspace(dir)
      } catch {
        // 原生框异常时静默失败；桌面端不回退到 in-app 选择器
      }
      return
    }
    setShowFolderPicker(true)
  }
  const session = sessions.find(s => s.id === activeSessionId)
  const stats = useSessionStats(activeSessionId)
  const [character, setCharacter] = useState<Character | null>(null)
  const [showPicker, setShowPicker] = useState(false)
  const [allChars, setAllChars] = useState<Character[]>([])
  const [showHelperPicker, setShowHelperPicker] = useState(false)
  const charCache = useRef<Map<string, Character>>(new Map())

  useEffect(() => {
    fetchCharacters().then(setAllChars).catch(() => {})
  }, [])

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

  // 帮手（本会话可委托角色白名单 targets；无配置则为空，不默认 worker）
  let targets: string[] = []
  if (session.targets) {
    try { const p = JSON.parse(session.targets); targets = Array.isArray(p) ? p : [] } catch { targets = [] }
  }
  const targetChars = allChars.filter(c => targets.includes(c.id))
  const helperCandidates = allChars.filter(c => (c.role === 'sub' || c.role === 'both') && !targets.includes(c.id))

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
              <button
                className="rp-ws-open"
                type="button"
                title={t('打开所在目录')}
                onClick={() => void openWorkspaceDir(session.workspace!)}
              >
                <Icon name="folder-open" size={13} ariaHidden />
              </button>
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
              title={t('添加授权工作区')}
              onClick={() => void handleAddWorkspace()}
            >+</button>
          </div>
          {authorizedWorkspaces.length === 0 ? (
            <div style={{ fontSize: 'calc(11px * var(--ui-font-scale))', color: 'var(--ink-faint)' }}>{t('无授权工作区')}</div>
          ) : authorizedWorkspaces.map((ws, i) => (
            <div key={i} className="rp-ws-item">
              <span className="rp-ws-path">{ws}</span>
              <button
                className="rp-ws-open"
                type="button"
                title={t('打开所在目录')}
                onClick={() => void openWorkspaceDir(ws)}
              >
                <Icon name="folder-open" size={13} ariaHidden />
              </button>
              <button
                className="rp-ws-del"
                type="button"
                title={t('删除')}
                onClick={() => removeWorkspace(ws)}
              >✕</button>
            </div>
          ))}
        </div>

        {/* 帮手：本会话可委托角色（工作帮手） */}
        <div className="rp-section">
          <div className="rp-section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            {t('帮手')}
            <button
              style={{ background: 'none', border: 'none', color: 'var(--gold)', cursor: 'pointer', fontSize: 'calc(14px * var(--ui-font-scale))', lineHeight: 1 }}
              title={t('添加帮手')}
              onClick={() => setShowHelperPicker(v => !v)}
            >+</button>
          </div>
          {targets.length === 0 ? (
            <div style={{ fontSize: 'calc(11px * var(--ui-font-scale))', color: 'var(--ink-faint)' }}>{t('无帮手，无法拉起子 agent')}</div>
          ) : (
            <div className="helper-grid">
              {targetChars.map(c => (
                <div key={c.id} className="helper-item" title={c.name}>
                  <span className="helper-avatar">
                    <CharacterRenderer characterId={c.id} name={c.name} legacyAvatar={c.avatar} mode="avatar" className="character-renderer-helper" />
                  </span>
                  <span className="helper-name">{c.name}</span>
                  <span
                    className="helper-del"
                    onClick={() => updateSessionTargets(session.id, targets.filter(id => id !== c.id))}
                    title={t('移除')}
                  >×</span>
                </div>
              ))}
            </div>
          )}
          {showHelperPicker && (
            <div className="helper-pick">
              {helperCandidates.length === 0 ? (
                <span style={{ fontSize: 'calc(11px * var(--ui-font-scale))', color: 'var(--ink-faint)' }}>{t('无更多可添加角色')}</span>
              ) : helperCandidates.map(c => (
                <span
                  key={c.id}
                  className="tag"
                  onClick={() => updateSessionTargets(session.id, [...targets, c.id])}
                >{c.name}</span>
              ))}
            </div>
          )}
        </div>

        {/* Goal / Plan: goal 与 plan 由 Agent 自主创建，实时展示（无需选择执行模式） */}
        <GoalPanel sessionId={session.id} />

        {/* Session stats */}
        <div className="rp-section">
          <div className="rp-section-title">{t('会话统计')}</div>
          {session.compacted && (
            <div style={{ fontSize: 'calc(10px * var(--ui-font-scale))', color: 'var(--gold)', marginTop: 4 }}>⚠ {t('会话已压缩')}</div>
          )}
          <div className="rp-stats">
            {(stats ? buildStatsCards(stats) : []).map(card => (
              <div key={card.key} className="rp-stat">
                <div className="rp-stat-value">{card.value}</div>
                <div className="rp-stat-label">{t(card.key)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {showFolderPicker && (
        <FolderPicker
          onSelect={(path) => {
            setShowFolderPicker(false)
            addWorkspace(path)
          }}
          onClose={() => setShowFolderPicker(false)}
        />
      )}
    </aside>
  )
}
