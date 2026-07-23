import { useChatStore } from '@/stores/chatStore'
import { useUIStore } from '@/stores/uiStore'
import MessageList from './MessageList'
import ChatInput from './ChatInput'
import ApprovalDialog from './ApprovalDialog'

export default function ChatArea() {
  const { sessions, activeSessionId, pendingApproval } = useChatStore()
  const { toggleSidebar, toggleRightPanel, toggleFilePanel } = useUIStore()
  const session = sessions.find(s => s.id === activeSessionId)

  return (
    <div className="main">
      <div className="route-bar" style={{ display: 'none' }}>
        <span className="route-text"></span>
        <div className="meteor"></div>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
        <div className="input-top-bar">
          <button className="menu-btn" onClick={toggleSidebar} title="展开/收起侧栏">☰</button>
          <span className="session-name">{session?.title || '新会话'}</span>
          <button className="top-btn" title="编辑会话名">⋯</button>
          <div style={{ flex: 1 }}></div>
          <button className="top-btn" onClick={toggleRightPanel} title="星官详情">👤</button>
          <button className="top-btn" onClick={toggleFilePanel} title="文件">📁</button>
        </div>
        <MessageList />
        <ChatInput />
      </div>
      {pendingApproval && <ApprovalDialog />}
    </div>
  )
}
