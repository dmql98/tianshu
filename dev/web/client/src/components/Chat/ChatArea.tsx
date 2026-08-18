import { useEffect, useRef, useState } from 'react'
import { useChatStore } from '@/stores/chatStore'
import { useUIStore } from '@/stores/uiStore'
import MessageList from './MessageList'
import ChatInput from './ChatInput'
import ApprovalDialog from './ApprovalDialog'
import AskUserDialog from './AskUserDialog'
import TrajectoryView from '@/features/trajectory/TrajectoryView'
import Icon from '@/features/icons/Icon'
import { useI18n } from '@/i18n'
import { useLocation, useNavigate } from 'react-router-dom'

export default function ChatArea() {
  const {
    sessions, activeSessionId, pendingApproval, pendingAskUser,
    socketConnected, isRefreshing, refreshSession, renameSession,
  } = useChatStore()
  const { toggleSidebar, toggleRightPanel, toggleFilePanel } = useUIStore()
  const t = useI18n()
  const location = useLocation()
  const navigate = useNavigate()
  const session = sessions.find(s => s.id === activeSessionId)
  // 视图由 URL 决定：/chat/:id = 对话，/chat/:id/trajectory = 轨迹。
  const isTrajectory = location.pathname.endsWith('/trajectory')

  // 会话名内联编辑（覆盖创建时自动生成的名称）
  const [editingTitle, setEditingTitle] = useState(false)
  const [draftTitle, setDraftTitle] = useState('')
  const titleInputRef = useRef<HTMLInputElement>(null)
  const editingRef = useRef(false)

  // 切换会话时退出编辑态
  useEffect(() => {
    editingRef.current = false
    setEditingTitle(false)
  }, [activeSessionId])

  const startEditTitle = () => {
    if (!session || editingRef.current) return
    setDraftTitle(session.title || '')
    editingRef.current = true
    setEditingTitle(true)
  }

  useEffect(() => {
    if (editingTitle && titleInputRef.current) {
      titleInputRef.current.focus()
      titleInputRef.current.select()
    }
  }, [editingTitle])

  const commitTitle = (cancel = false) => {
    if (!session || !editingRef.current) return
    editingRef.current = false
    setEditingTitle(false)
    if (cancel) return
    const next = draftTitle.trim()
    if (next && next !== session.title) {
      renameSession(session.id, next)
    }
  }

  const goChat = () => {
    if (activeSessionId && isTrajectory) {
      navigate(`/chat/${encodeURIComponent(activeSessionId)}`)
    }
  }
  const goTrajectory = () => {
    if (activeSessionId && !isTrajectory) {
      navigate(`/chat/${encodeURIComponent(activeSessionId)}/trajectory`)
    }
  }

  return (
    <div className="main">
      <div className="route-bar" style={{ display: 'none' }}>
        <span className="route-text"></span>
        <div className="meteor"></div>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
        <div className="input-top-bar">
          <button className="menu-btn" onClick={toggleSidebar} title={t('展开/收起侧栏')}><Icon name="menu" size={16} ariaHidden /></button>
          {editingTitle ? (
            <input
              ref={titleInputRef}
              className="session-name-edit"
              value={draftTitle}
              onChange={e => setDraftTitle(e.target.value)}
              onBlur={() => commitTitle()}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); commitTitle() }
                else if (e.key === 'Escape') commitTitle(true)
              }}
              placeholder={t('新会话')}
              spellCheck={false}
            />
          ) : (
            <span className="session-name">{session?.title || t('新会话')}</span>
          )}
          <button
            className={`top-btn ${editingTitle ? 'active' : ''}`}
            onClick={startEditTitle}
            title={t('编辑会话名')}
            aria-label={t('编辑会话名')}
          ><Icon name="rename" size={15} ariaHidden /></button>
          <div style={{ flex: 1 }}></div>
          {!socketConnected && <span className="connection-state">{t('连接已断开，正在重连…')}</span>}
          <button
            className={`top-btn refresh-btn ${isRefreshing ? 'refreshing' : ''}`}
            onClick={() => void refreshSession().catch(() => {})}
            disabled={isRefreshing}
            title={t('从服务端刷新会话')}
            aria-label={t('从服务端刷新会话')}
          >↻</button>
          <button className="top-btn" onClick={toggleRightPanel} title={t('星官详情')}><Icon name="nav-characters" size={15} ariaHidden /></button>
          <button className="top-btn" onClick={toggleFilePanel} title={t('文件')}><Icon name="folder" size={15} ariaHidden /></button>
        </div>
        {/* 会话视图分页：对话 / 轨迹（视图由 URL 决定，tab 高亮跟随路径） */}
        <div className="chat-tabs" role="tablist" aria-label={t('会话视图')}>
          <button
            type="button"
            role="tab"
            aria-selected={!isTrajectory}
            className={`chat-tab ${!isTrajectory ? 'active' : ''}`}
            onClick={goChat}
          >
            {t('对话')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={isTrajectory}
            className={`chat-tab ${isTrajectory ? 'active' : ''}`}
            onClick={goTrajectory}
          >
            {t('轨迹')}
          </button>
        </div>
        {/* 两个视图都保持挂载：切走再切回不丢聊天滚动位置 / 轨迹选择 */}
        <div className="chat-view-pane" style={{ display: !isTrajectory ? 'flex' : 'none' }}>
          <MessageList />
          <ChatInput />
        </div>
        <div className="chat-view-pane" style={{ display: isTrajectory ? 'flex' : 'none' }}>
          <TrajectoryView sessionId={activeSessionId ?? ''} />
        </div>
      </div>
      {pendingApproval && <ApprovalDialog />}
      {pendingAskUser && <AskUserDialog />}
    </div>
  )
}
