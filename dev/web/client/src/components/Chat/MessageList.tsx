import { useEffect, useRef } from 'react'
import { useChatStore } from '@/stores/chatStore'
import MessageItem from './MessageItem'

export default function MessageList() {
  const scrollRef = useRef<HTMLDivElement>(null)
  const { sessions, activeSessionId } = useChatStore()
  const session = sessions.find(s => s.id === activeSessionId)
  const messages = session?.messages || []

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  return (
    <div className="chat-scroll" ref={scrollRef}>
      {messages.map(msg => (
        <MessageItem key={msg.id} message={msg} />
      ))}
    </div>
  )
}
