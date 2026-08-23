import { memo, useState } from 'react'
import type { Message } from '@/types'
import { useChatStore } from '@/stores/chatStore'
import { useI18n, useI18nStore } from '@/i18n'
import ThinkingBlock from './ThinkingBlock'
import ToolCall from './ToolCall'
import MarkdownContent from './MarkdownContent'

const showReasoning = () => localStorage.getItem('tianshu:showReasoning') !== 'false'

interface Props {
  message: Message
  characterId?: string
  sessionId?: string
}

export default memo(function MessageItem({ message, characterId, sessionId }: Props) {
  const editMessage = useChatStore(s => s.editMessage)
  const forkFromMessage = useChatStore(s => s.forkFromMessage)
  const sessionWorkspace = useChatStore(s => s.sessions.find(x => x.id === sessionId)?.workspace ?? undefined)
  const isStreaming = useChatStore(s => s.isStreaming)
  const t = useI18n()
  const locale = useI18nStore(s => s.locale)
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState(message.content)
  const [copied, setCopied] = useState(false)
  const [actionError, setActionError] = useState('')
  const [isForking, setIsForking] = useState(false)
  const isUser = message.role === 'user'
  const isTool = message.role === 'tool'
  const hasVisibleContent = message.content.trim().length > 0
  const time = new Date(message.timestamp).toLocaleTimeString(locale === 'en' ? 'en-US' : 'zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  })

  if (isTool) {
    return <ToolCall message={message} />
  }

  const copyMessage = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(message.content)
      } else {
        const textarea = document.createElement('textarea')
        textarea.value = message.content
        textarea.style.position = 'fixed'
        textarea.style.opacity = '0'
        document.body.appendChild(textarea)
        textarea.select()
        const copied = document.execCommand('copy')
        textarea.remove()
        if (!copied) throw new Error('copy failed')
      }
      setCopied(true)
      setActionError('')
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      setActionError(t('复制失败'))
    }
  }

  const saveEdit = async () => {
    if (!editContent.trim() || editContent.trim() === message.content.trim()) {
      setIsEditing(false)
      setEditContent(message.content)
      return
    }
    try {
      setActionError('')
      await editMessage(message.id, editContent)
      setIsEditing(false)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : t('编辑失败'))
    }
  }

  const createFork = async () => {
    try {
      setIsForking(true)
      setActionError('')
      await forkFromMessage(message.id)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : t('创建分支失败'))
    } finally {
      setIsForking(false)
    }
  }

  return (
    <div className={`msg-group ${isUser ? 'user' : 'star'}`}>
      {!isUser && message.token_speed != null && message.token_speed > 0 && (
        <div className="msg-token-speed">{message.token_speed.toFixed(1)} token/s</div>
      )}
      {!isUser && message.reasoning && (
        <ThinkingBlock
          content={message.reasoning}
          duration={message.reasoning_duration}
          defaultExpanded={showReasoning()}
          streaming={!!message.is_streaming}
        />
      )}
      {isEditing ? (
        <div className="msg-edit-panel">
          <textarea
            className="msg-edit-input"
            value={editContent}
            onChange={event => setEditContent(event.target.value)}
            onKeyDown={event => {
              if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') void saveEdit()
              if (event.key === 'Escape') {
                setIsEditing(false)
                setEditContent(message.content)
              }
            }}
            autoFocus
          />
          <div className="msg-edit-actions">
            <button type="button" onClick={() => {
              setIsEditing(false)
              setEditContent(message.content)
              setActionError('')
            }}>{t('取消')}</button>
            <button type="button" className="primary" onClick={() => void saveEdit()}>{t('保存并重新发送')}</button>
          </div>
        </div>
      ) : hasVisibleContent ? (
        <div className="msg-bubble">
          <MarkdownContent content={message.content} streaming={!!message.is_streaming} workspace={sessionWorkspace} />
        </div>
      ) : null}
      {(hasVisibleContent || isEditing) && (
        <>
          <div className="msg-meta">
            <span className="msg-time">{time}</span>
            {!isEditing && (
              <div className="msg-actions">
                <button type="button" onClick={() => void copyMessage()}>{copied ? t('已复制') : t('复制')}</button>
                {isUser ? (
                  <button
                    type="button"
                    disabled={isStreaming}
                    title={isStreaming ? t('请先停止当前运行') : t('编辑这条消息')}
                    onClick={() => {
                      setEditContent(message.content)
                      setIsEditing(true)
                      setActionError('')
                    }}
                  >{t('编辑')}</button>
                ) : (
                  <button
                    type="button"
                    disabled={message.is_streaming || isForking}
                    title={message.is_streaming ? t('请等待 Agent 回复完成') : t('从这条回复创建新会话')}
                    onClick={() => void createFork()}
                  >{isForking ? t('创建中…') : t('分支')}</button>
                )}
              </div>
            )}
          </div>
          {actionError && <div className="msg-action-error">{actionError}</div>}
        </>
      )}
    </div>
  )
})
