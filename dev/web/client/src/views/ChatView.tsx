import { useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { useChatStore } from '@/stores/chatStore'
import ChatArea from '@/components/Chat/ChatArea'
import SidePanel from '@/components/Panels/SidePanel'

export default function ChatView() {
  const { id } = useParams<{ id: string }>()
  const { switchSession, loadSessions, sessions } = useChatStore()

  useEffect(() => {
    if (sessions.length === 0) {
      loadSessions()
    }
  }, [])

  useEffect(() => {
    if (id) {
      switchSession(id)
    }
  }, [id])

  return (
    <div className="chat-view">
      <ChatArea />
      <SidePanel />
    </div>
  )
}
