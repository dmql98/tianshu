import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Message } from '@/types'
import { useChatStore } from '@/stores/chatStore'
import MessageItem from './MessageItem'
import WorkGroup from './WorkGroup'
import { useI18n } from '@/i18n'

const isCompact = () => localStorage.getItem('tianshu:compact') === 'true'
const BOTTOM_THRESHOLD = 120

function userMessageTip(msg: Message): string {
  const text = msg.content?.trim() || ''
  if (text) return text
  return msg.attachments?.length ? msg.attachments.map(a => a.name).join('、') : ''
}

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
  const [activeMsgId, setActiveMsgId] = useState<string | null>(null)
  const [hoverTip, setHoverTip] = useState<{ text: string; x: number; y: number } | null>(null)

  // 用户消息索引（供左侧快捷跳转条使用）
  const userMessages = messages.filter(m => m.role === 'user')

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
    setActiveMsgId(null)
  }

  const jumpToUserMessage = (msgId: string) => {
    const el = scrollRef.current
    if (!el) return
    const node = el.querySelector(`[data-msg-id="${CSS.escape(msgId)}"]`)
    if (node) {
      node.scrollIntoView({ block: 'start', behavior: 'smooth' })
    } else {
      el.scrollTop = el.scrollHeight
    }
    stickToBottom.current = false
    setShowJumpToBottom(true)
    setActiveMsgId(msgId)
  }

  // 把连续相邻的 tool 消息合并为一个「工具调用」组，其余按单条渲染（对齐 penguin 的
  // Reasoning & Tools 分段）。遇到非 tool 消息即结束当前运行中的组。
  const renderSegments = () => {
    const out: ReactNode[] = []
    let run: Message[] = []
    const flush = () => {
      if (run.length > 0) {
        out.push(<WorkGroup key={`wg-${run[0]!.id}`} items={run.slice()} />)
        run = []
      }
    }
    const msgCount = messages.length
    for (let i = 0; i < msgCount; i++) {
      const msg = messages[i]!
      if (msg.role === 'tool') {
        run.push(msg)
      } else {
        flush()
        out.push(
          <MessageItem
            key={msg.id}
            message={msg}
            characterId={session?.character_id}
            sessionId={session?.id}
          />
        )
      }
    }
    flush()
    return out
  }

  return (
    <div className="chat-scroll-wrap">
      {userMessages.length > 0 && (
        <>
          <div className="msg-jump-strip">
            {userMessages.map((m) => (
              <span
                key={m.id}
                className={`msg-jump-dot${activeMsgId === m.id ? ' active' : ''}`}
                onClick={() => jumpToUserMessage(m.id)}
                onMouseEnter={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect()
                  setHoverTip({ text: userMessageTip(m), x: rect.right + 10, y: rect.top + rect.height / 2 })
                }}
                onMouseLeave={() => setHoverTip(null)}
              />
            ))}
          </div>
          {hoverTip && (
            <div
              className="msg-jump-tip"
              style={{ left: hoverTip.x, top: hoverTip.y }}
            >
              {hoverTip.text}
            </div>
          )}
        </>
      )}
      <div className="chat-scroll-main">
        <div className={`chat-scroll${isCompact() ? ' compact' : ''}`} ref={scrollRef}>
          {renderSegments()}
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
    </div>
  )
}
