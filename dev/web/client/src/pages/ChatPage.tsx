import { useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useChatStore } from '@/stores/chatStore'
import { useUIStore } from '@/stores/uiStore'
import { useProvidersStore } from '@/stores/providersStore'
import SessionPanel from '@/components/Chat/SessionPanel'
import ChatArea from '@/components/Chat/ChatArea'
import RightPanel from '@/components/Chat/RightPanel'
import FilePanel from '@/components/Chat/FilePanel'

export default function ChatPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()
  const { loadSessions, switchSession, activeSessionId, createSession } = useChatStore()
  const { sidebarOpen, rightPanelOpen, filePanelOpen } = useUIStore()
  const { load: loadProviders } = useProvidersStore()

  // Load data on mount
  useEffect(() => {
    loadSessions()
    loadProviders()
  }, [loadSessions, loadProviders])

  // Switch session when URL param changes
  useEffect(() => {
    if (sessionId && sessionId !== activeSessionId) {
      switchSession(sessionId)
    }
  }, [sessionId, activeSessionId, switchSession])

  async function handleNewSession() {
    const session = await createSession()
    navigate(`/chat/${session.id}`)
  }

  // No sessionId — show placeholder
  if (!sessionId) {
    return (
      <>
        {sidebarOpen && <SessionPanel />}
        <main className="main" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20 }}>
          <div style={{ fontSize: 48, opacity: 0.3 }}>💬</div>
          <div style={{ fontSize: 16, color: 'var(--ink-mid)', fontWeight: 500 }}>选择一个会话开始对话</div>
        </main>
      </>
    )
  }

  // Has sessionId — show full chat layout
  return (
    <>
      {sidebarOpen && <SessionPanel />}
      <ChatArea />
      {rightPanelOpen && <RightPanel />}
      {filePanelOpen && <FilePanel />}
    </>
  )
}
