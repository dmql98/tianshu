import { useState, useMemo, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useChatStore } from '@/stores/chatStore'
import { openInFileManager } from '@/api/workspace'
import FolderPicker from './FolderPicker'
import type { Session } from '@/types'
import type { I18nState } from '@/i18n'
import { useI18n } from '@/i18n'
import { motionLabelKey } from '@/features/character-presence/motion'

type T = I18nState['t']

function timeAgo(ts: number, t: T): string {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return t('刚刚')
  if (mins < 60) return t('{mins}分钟前', { mins })
  const hours = Math.floor(mins / 60)
  if (hours < 24) return t('{hours}小时前', { hours })
  const days = Math.floor(hours / 24)
  return t('{days}天前', { days })
}

interface ContextMenu {
  x: number
  y: number
  session: Session
}

interface ProjectContextMenu {
  x: number
  y: number
  workspace: string
}

export default function SessionPanel() {
  const t = useI18n()
  const [search, setSearch] = useState('')
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null)
  const [projectMenu, setProjectMenu] = useState<ProjectContextMenu | null>(null)
  const [showFolderPicker, setShowFolderPicker] = useState(false)
  const navigate = useNavigate()
  const menuRef = useRef<HTMLDivElement>(null)
  const {
    sessions, activeSessionId, sessionMotions,
    collapsedWorkspaces, toggleWorkspaceCollapse,
    createSession, deleteSession, renameSession, toggleSessionStar,
    deleteProject,
    isBatchMode, selectedSessionIds, toggleBatchMode, toggleSessionSelection,
  } = useChatStore()

  // Close context menus on outside click
  useEffect(() => {
    function handleClick() { setContextMenu(null); setProjectMenu(null) }
    if (contextMenu || projectMenu) {
      document.addEventListener('click', handleClick)
      return () => document.removeEventListener('click', handleClick)
    }
  }, [contextMenu, projectMenu])

  // Separate parent sessions and event sessions
  const parentSessions = useMemo(() =>
    sessions.filter(s => !s.parent_id && s.session_type !== 'event'),
    [sessions]
  )
  const eventSessions = useMemo(() =>
    sessions.filter(s => s.session_type === 'event'),
    [sessions]
  )

  // Group parent sessions by project area (session.workspace)
  const workspaceGroups = useMemo(() => {
    const groups = new Map<string, Session[]>()
    parentSessions.forEach(session => {
      const project = session.workspace || 'default'
      if (!groups.has(project)) groups.set(project, [])
      groups.get(project)!.push(session)
    })
    return Array.from(groups.entries())
      .map(([name, sessions]) => ({
        name,
        sessions: sessions.sort((a, b) => b.updated_at - a.updated_at),
        collapsed: collapsedWorkspaces.has(name),
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [parentSessions, collapsedWorkspaces])

  // Filter by search
  const filteredGroups = useMemo(() => {
    if (!search) return workspaceGroups
    const q = search.toLowerCase()
    return workspaceGroups
      .map(g => ({
        ...g,
        sessions: g.sessions.filter(s =>
          s.title?.toLowerCase().includes(q) ||
          s.character_id?.toLowerCase().includes(q)
        ),
      }))
      .filter(g => g.sessions.length > 0)
  }, [workspaceGroups, search])

  const filteredEvents = useMemo(() => {
    if (!search) return eventSessions
    const q = search.toLowerCase()
    return eventSessions.filter(s => s.title?.toLowerCase().includes(q))
  }, [eventSessions, search])

  // Get child sessions for a parent
  function getChildren(parentId: string): Session[] {
    return sessions
      .filter(s => s.parent_id === parentId)
      .sort((a, b) => a.created_at - b.created_at)
  }

  async function handleNewSession() {
    setShowFolderPicker(true)
  }

  async function handleFolderSelect(workspace: string) {
    setShowFolderPicker(false)
    const session = await createSession({ workspace })
    navigate(`/chat/${session.id}`)
  }

  async function handleNewSessionInWorkspace(
    event: React.MouseEvent<HTMLButtonElement>,
    workspace: string,
  ) {
    event.stopPropagation()
    if (collapsedWorkspaces.has(workspace)) {
      toggleWorkspaceCollapse(workspace)
    }
    const session = await createSession(workspace === 'default' ? {} : { workspace })
    navigate(`/chat/${session.id}`)
  }

  function handleContextMenu(e: React.MouseEvent, session: Session) {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, session })
  }

  function handleProjectContextMenu(e: React.MouseEvent, workspace: string) {
    e.preventDefault()
    e.stopPropagation()
    setProjectMenu({ x: e.clientX, y: e.clientY, workspace })
  }

  function handleOpenProjectFolder(workspace: string) {
    openInFileManager(workspace).catch(err => {
      console.error('Failed to open folder:', err)
    })
    setProjectMenu(null)
  }

  function handleDeleteProject(workspace: string) {
    const count = sessions.filter(s => !s.parent_id && (s.workspace || 'default') === workspace).length
    const label = workspace === 'default' ? t('默认') : workspace.split(/[/\\]/).pop() || workspace
    if (!window.confirm(t('删除项目「{label}」？\n将删除该项目下的 {count} 个会话（含子会话），不可恢复。', { label, count }))) return
    deleteProject(workspace)
    if (activeSessionId && sessions.find(s => s.id === activeSessionId && (s.workspace || 'default') === workspace)) {
      navigate('/chat')
    }
    setProjectMenu(null)
  }

  function handleRename(session: Session) {
    const name = prompt(t('输入新名称：'), session.title || '')
    if (name !== null) {
      renameSession(session.id, name)
    }
    setContextMenu(null)
  }

  function handleCopyId(session: Session) {
    navigator.clipboard.writeText(session.id).catch(() => {})
    setContextMenu(null)
  }

  function handleExport(session: Session) {
    const data = JSON.stringify(session, null, 2)
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `session-${session.id}.json`
    a.click()
    URL.revokeObjectURL(url)
    setContextMenu(null)
  }

  function handleDelete(session: Session) {
    deleteSession(session.id)
    if (activeSessionId === session.id) {
      navigate('/chat')
    }
    setContextMenu(null)
  }

  function handleTogglePin(session: Session) {
    toggleSessionStar(session.id)
    setContextMenu(null)
  }

  function renderSessionItem(session: Session, isChild = false) {
    const isActive = session.id === activeSessionId
    const isSelected = selectedSessionIds.has(session.id)
    const children = getChildren(session.id)
    const motion = sessionMotions[session.id] || 'idle'
    const motionLabel = t(motionLabelKey(motion))

    return (
      <div key={session.id}>
        <div
          className={`session-item ${isActive ? 'active' : ''} ${isChild ? 'subsession-item' : ''}`}
          onClick={() => {
            if (isBatchMode) {
              toggleSessionSelection(session.id)
            } else {
              navigate(`/chat/${session.id}`)
            }
          }}
          onContextMenu={e => handleContextMenu(e, session)}
        >
          {isBatchMode && (
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => toggleSessionSelection(session.id)}
              style={{ marginRight: 6 }}
            />
          )}
          <div
            className={`session-dot motion-${motion}`}
            title={motionLabel}
            aria-label={motionLabel}
          ></div>
          <div className="session-info">
            <div className="session-title">
              {session.pinned && <span style={{ marginRight: 4 }}>⭐</span>}
              {session.title || t('新会话')}
            </div>
            <div className="session-meta">
              <span>{timeAgo(session.updated_at, t)}</span>
              {session.current_strategy && (
                <span className="session-badge">{t(session.current_strategy)}</span>
              )}
            </div>
          </div>
        </div>
        {children.map(child => renderSessionItem(child, true))}
      </div>
    )
  }

  return (
    <aside className="ctx-panel">
      <div className="ctx-header">
        <span className="ctx-title">{t('会话')}</span>
        <div className="ctx-actions">
          <button onClick={toggleBatchMode} title={isBatchMode ? t('退出批量') : t('批量操作')}>
            {isBatchMode ? '✓' : '☰'}
          </button>
        </div>
      </div>
      <div className="ctx-search">
        <input
          placeholder={t('搜索会话...')}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>
      <div className="add-btn" onClick={handleNewSession}>+ {t('新建项目')}</div>
      <div className="ctx-body">
        {filteredGroups.map(group => (
          <div key={group.name} className="project-item">
            <div
              className={`project-header ${!group.collapsed ? 'active' : ''}`}
              onClick={() => toggleWorkspaceCollapse(group.name)}
              onContextMenu={e => handleProjectContextMenu(e, group.name)}
            >
              <span className="project-icon">📁</span>
              <span className="project-name">{group.name === 'default' ? t('默认') : group.name.split(/[/\\]/).pop() || group.name}</span>
              <button
                type="button"
                className="project-add-btn"
                title={t('在「{name}」中新建会话', { name: group.name === 'default' ? t('默认') : group.name.split(/[/\\]/).pop() || group.name })}
                aria-label={t('在项目 {name} 中新建会话', { name: group.name })}
                onClick={event => handleNewSessionInWorkspace(event, group.name)}
              >
                +
              </button>
              <span className={`project-arrow ${!group.collapsed ? 'open' : ''}`}>▶</span>
            </div>
            {!group.collapsed && (
              <div className="project-children">
                {group.sessions.map(s => renderSessionItem(s))}
              </div>
            )}
          </div>
        ))}

        {filteredEvents.length > 0 && (
          <>
            <div className="ctx-divider"></div>
            <div className="event-group">
              <div className="event-group-title">{t('事件')}</div>
              {filteredEvents.map(s => renderSessionItem(s))}
            </div>
          </>
        )}

        {filteredGroups.length === 0 && filteredEvents.length === 0 && (
          <div style={{ padding: 20, textAlign: 'center', fontSize: 'calc(12px * var(--ui-font-scale))', color: 'var(--ink-faint)' }}>
            {search ? t('无匹配会话') : t('暂无会话')}
          </div>
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          ref={menuRef}
          style={{
            position: 'fixed',
            left: contextMenu.x,
            top: contextMenu.y,
            zIndex: 1000,
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '4px 0',
            minWidth: 140,
            boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
          }}
          onClick={e => e.stopPropagation()}
        >
          <ContextMenuItem
            icon={contextMenu.session.pinned ? '⭐' : '☆'}
            label={contextMenu.session.pinned ? t('取消收藏') : t('收藏')}
            onClick={() => handleTogglePin(contextMenu.session)}
          />
          <ContextMenuItem icon="✏️" label={t('重命名')} onClick={() => handleRename(contextMenu.session)} />
          <ContextMenuItem icon="📋" label={t('复制 ID')} onClick={() => handleCopyId(contextMenu.session)} />
          <ContextMenuItem icon="📤" label={t('导出')} onClick={() => handleExport(contextMenu.session)} />
          <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
          <ContextMenuItem icon="🗑️" label={t('删除')} danger onClick={() => handleDelete(contextMenu.session)} />
        </div>
      )}

      {/* Project Context Menu */}
      {projectMenu && (
        <div
          style={{
            position: 'fixed',
            left: projectMenu.x,
            top: projectMenu.y,
            zIndex: 1000,
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '4px 0',
            minWidth: 150,
            boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
          }}
          onClick={e => e.stopPropagation()}
        >
          {projectMenu.workspace !== 'default' && (
            <ContextMenuItem
              icon="📂"
              label={t('打开所在文件夹')}
              onClick={() => handleOpenProjectFolder(projectMenu.workspace)}
            />
          )}
          <ContextMenuItem
            icon="🗑️"
            label={t('删除项目')}
            danger
            onClick={() => handleDeleteProject(projectMenu.workspace)}
          />
        </div>
      )}

      {/* Folder Picker */}
      {showFolderPicker && (
        <FolderPicker
          onSelect={handleFolderSelect}
          onClose={() => setShowFolderPicker(false)}
        />
      )}
    </aside>
  )
}

function ContextMenuItem({ icon, label, danger, onClick }: {
  icon: string; label: string; danger?: boolean; onClick: () => void
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 12px', fontSize: 'calc(12px * var(--ui-font-scale))', cursor: 'pointer',
        color: danger ? 'var(--cinnabar)' : 'var(--ink-mid)',
        background: hovered ? (danger ? 'rgba(196,92,60,0.08)' : 'var(--bg-hover)') : 'transparent',
      }}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span style={{ fontSize: 13 }}>{icon}</span>
      {label}
    </div>
  )
}
