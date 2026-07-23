import { useState } from 'react'
import { useChatStore } from '@/stores/chatStore'
import { useNavigate } from 'react-router-dom'
import type { Session } from '@/types'

export default function Sidebar() {
  const navigate = useNavigate()
  const { sessions, activeSessionId, switchSession, createSession, collapsedWorkspaces, toggleWorkspaceCollapse } = useChatStore()
  const [search, setSearch] = useState('')

  const filteredSessions = sessions.filter(s =>
    !s.parent_id && s.title.toLowerCase().includes(search.toLowerCase())
  )

  const workspaceGroups = filteredSessions.reduce((acc, session) => {
    const ws = session.workspace || 'default'
    if (!acc[ws]) acc[ws] = []
    acc[ws].push(session)
    return acc
  }, {} as Record<string, Session[]>)

  const handleNewSession = async () => {
    const session = await createSession()
    navigate(`/c/${session.id}`)
  }

  const handleSelectSession = async (id: string) => {
    await switchSession(id)
    navigate(`/c/${id}`)
  }

  return (
    <aside className="ctx-panel">
      <div className="ctx-header">
        <span className="ctx-title">会话</span>
      </div>
      <div className="ctx-search">
        <input
          placeholder="搜索会话..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>
      <button className="add-btn" onClick={handleNewSession}>
        + 新建会话
      </button>
      <div className="ctx-body">
        {Object.entries(workspaceGroups).map(([workspace, wsSessions]) => (
          <div key={workspace} className="project-item">
            <div
              className="project-header"
              onClick={() => toggleWorkspaceCollapse(workspace)}
            >
              <span className="project-icon">📁</span>
              <span className="project-name">{workspace}</span>
              <span className={`project-arrow ${!collapsedWorkspaces.has(workspace) ? 'open' : ''}`}>▶</span>
            </div>
            {!collapsedWorkspaces.has(workspace) && (
              <div className="project-children">
                {wsSessions.map(session => (
                  <div
                    key={session.id}
                    className={`session-item ${session.id === activeSessionId ? 'active' : ''}`}
                    onClick={() => handleSelectSession(session.id)}
                  >
                    <div className={`session-dot ${session.session_type === 'event' ? 'event' : 'chat'}`} />
                    <div className="session-info">
                      <div className="session-title">{session.title || '新会话'}</div>
                      <div className="session-meta">
                        <span>{new Date(session.updated_at).toLocaleDateString()}</span>
                        {session.current_strategy && (
                          <span className="session-badge">{session.current_strategy}</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </aside>
  )
}
