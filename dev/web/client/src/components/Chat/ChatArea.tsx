import { useChatStore } from '@/stores/chatStore'
import { useUIStore } from '@/stores/uiStore'
import MessageList from './MessageList'
import ChatInput from './ChatInput'
import ApprovalDialog from './ApprovalDialog'
import AskUserDialog from './AskUserDialog'
import { useI18n } from '@/i18n'

export default function ChatArea() {
  const { sessions, activeSessionId, pendingApproval, pendingAskUser } = useChatStore()
  const { toggleSidebar, toggleRightPanel, toggleFilePanel } = useUIStore()
  const t = useI18n()
  const session = sessions.find(s => s.id === activeSessionId)

  return (
    <div className="main">
      <div className="route-bar" style={{ display: 'none' }}>
        <span className="route-text"></span>
        <div className="meteor"></div>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
        <div className="input-top-bar">
          <button className="menu-btn" onClick={toggleSidebar} title={t('展开/收起侧栏')}>☰</button>
          <span className="session-name">{session?.title || t('新会话')}</span>
          <button className="top-btn" title={t('编辑会话名')}>⋯</button>
          <div style={{ flex: 1 }}></div>
          <button className="top-btn" onClick={toggleRightPanel} title={t('星官详情')}>👤</button>
          <button className="top-btn" onClick={toggleFilePanel} title={t('文件')}>📁</button>
        </div>
        <MessageList />
        <ChatInput />
      </div>
      {pendingApproval && <ApprovalDialog />}
      {pendingAskUser && <AskUserDialog />}
    </div>
  )
}
