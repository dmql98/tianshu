import { useEffect, useRef, useState } from 'react'
import { useChatStore } from '@/stores/chatStore'
import MessageItem from './MessageItem'
import { useI18n } from '@/i18n'

const isCompact = () => localStorage.getItem('tianshu:compact') === 'true'
const BOTTOM_THRESHOLD = 120

export default function MessageList() {
  const scrollRef = useRef<HTMLDivElement>(null)
  const sessions = useChatStore(s => s.sessions)
  const activeSessionId = useChatStore(s => s.activeSessionId)
  const t = useI18n()
  const session = sessions.find(s => s.id === activeSessionId)
  const messages = session?.messages || []
  const stickToBottom = useRef(true)
  const lastLenRef = useRef(messages.length)
  const [showJumpToBottom, setShowJumpToBottom] = useState(false)
  const [unread, setUnread] = useState(0)

  // 监听用户滚动：滚到底部附近则恢复自动跟随，否则显示「到底部」按钮
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = () => {
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD
      stickToBottom.current = nearBottom
      if (nearBottom) {
        setShowJumpToBottom(false)
        setUnread(0)
      } else {
        setShowJumpToBottom(true)
      }
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  // 消息变化：跟随模式滚到底；否则累计未读新消息数
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (stickToBottom.current) {
      el.scrollTop = el.scrollHeight
    } else {
      const added = Math.max(0, messages.length - lastLenRef.current)
      if (added > 0) setUnread(u => u + added)
    }
    lastLenRef.current = messages.length
  }, [messages])

  const jumpToBottom = () => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    stickToBottom.current = true
    setShowJumpToBottom(false)
    setUnread(0)
  }

  return (
    <div className="chat-scroll-wrap">
      <div className={`chat-scroll${isCompact() ? ' compact' : ''}`} ref={scrollRef}>
        {messages.map(msg => (
          <MessageItem
            key={msg.id}
            message={msg}
            characterId={session?.character_id}
            sessionId={session?.id}
          />
        ))}
      </div>
      {showJumpToBottom && (
        <button
          type="button"
          className="jump-to-bottom"
          onClick={jumpToBottom}
          title={t('回到底部')}
        >
          {unread > 0 ? `↓ ${t('{count} 条新消息', { count: unread })}` : '↓'}
        </button>
      )}
    </div>
  )
}
