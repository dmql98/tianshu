import { useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useChatStore } from '@/stores/chatStore'
import { useUIStore } from '@/stores/uiStore'
import { useProvidersStore } from '@/stores/providersStore'
import SessionPanel from '@/components/Chat/SessionPanel'
import ChatArea from '@/components/Chat/ChatArea'
import RightPanel from '@/components/Chat/RightPanel'
import Icon from '@/features/icons/Icon'
import FilePanel from '@/components/Chat/FilePanel'
import { useI18n } from '@/i18n'

export default function ChatPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()
  const t = useI18n()
  const { loadSessions, switchSession, refreshSession, activeSessionId, createSession } = useChatStore()
  const { sidebarOpen, rightPanelOpen, filePanelOpen } = useUIStore()
  const { load: loadProviders } = useProvidersStore()

  // Load data on mount
  useEffect(() => {
    loadSessions()
    loadProviders()
  }, [loadSessions, loadProviders])

  // Reconcile ephemeral session-tree updates after the desktop window returns
  // to the foreground or the browser reports network recovery. This covers a
  // suspended renderer where the transport's reconnect event happened before React
  // resumed processing UI updates.
  useEffect(() => {
    const refreshSessions = () => void loadSessions()
    const reconcileDesktop = () => {
      void (async () => {
        await loadSessions()
        const currentId = useChatStore.getState().activeSessionId
        if (currentId) await refreshSession(currentId)
      })()
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshSessions()
    }
    const removeDesktopListener = window.tianshuDesktop?.onResumeSync(reconcileDesktop)
    window.addEventListener('focus', refreshSessions)
    window.addEventListener('online', refreshSessions)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.removeEventListener('focus', refreshSessions)
      window.removeEventListener('online', refreshSessions)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      removeDesktopListener?.()
    }
  }, [loadSessions, refreshSession])

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
          <div style={{ opacity: 0.3 }}><Icon name="nav-chat" size={48} ariaHidden /></div>
          <div style={{ fontSize: 'calc(16px * var(--ui-font-scale))', color: 'var(--ink-mid)', fontWeight: 500 }}>{t('选择一个会话开始对话')}</div>
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
