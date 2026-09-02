import { memo, useState } from 'react'
import type { Message } from '@/types'
import { useChatStore } from '@/stores/chatStore'
import { useI18n, useI18nStore } from '@/i18n'
import ThinkingBlock from './ThinkingBlock'
import ToolCall from './ToolCall'
import MarkdownContent from './MarkdownContent'
import Icon from '@/features/icons/Icon'

const showReasoning = () => localStorage.getItem('tianshu:showReasoning') !== 'false'

interface Props {
  message: Message
  characterId?: string
  sessionId?: string
}

export default memo(function MessageItem({ message, sessionId }: Props) {
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
  const hasAttachments = isUser && (message.attachments?.length ?? 0) > 0
  const hasVisibleContent = message.content.trim().length > 0 || hasAttachments
  const time = new Date(message.timestamp).toLocaleTimeString(locale === 'en' ? 'en-US' : 'zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  })

  if (isTool) {
    return <ToolCall message={message} />
  }

  if (message.notice === 'compacted') {
    return <CompactDivider message={message} />
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
    <div className={`msg-group ${isUser ? 'user' : 'star'}`} data-msg-id={message.id}>
      {!isUser && message.token_speed != null && message.token_speed > 0 && (
        <div className="msg-token-speed" title={message.token_speed_estimated ? t('估算值') : undefined}>
          {message.token_speed_estimated ? '~' : ''}{message.token_speed.toFixed(1)} tok/s
        </div>
      )}
      {!isUser && message.reasoning && (
        <ThinkingBlock
          content={message.reasoning}
          duration={message.reasoning_duration_ms ?? message.reasoning_duration}
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
          {hasAttachments && (
            <div className="msg-attachments">
              {message.attachments!.map((a, i) => (
                <span key={i} className="msg-attachment">
                  {a.dataUrl && a.mime?.startsWith('image/')
                    ? <img src={a.dataUrl} alt={a.name} className="msg-attachment-thumb" />
                    : <Icon name={a.mime?.startsWith('image/') ? 'image' : 'attach'} size={14} ariaHidden />}
                  <span className="msg-attachment-name">{a.name}</span>
                </span>
              ))}
            </div>
          )}
          {message.content.trim().length > 0 && (
            <MarkdownContent content={message.content} streaming={!!message.is_streaming} workspace={sessionWorkspace} />
          )}
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

/** Conversation-flow compaction divider. Click to expand the summary when the
 *  run.compacted event carried one; collapsed otherwise (pure separator). */
function CompactDivider({ message }: { message: Message }) {
  const locale = useI18nStore(s => s.locale)
  const [expanded, setExpanded] = useState(false)
  const summary = message.compact_summary
  const canExpand = !!summary
  return (
    <div className={`msg-compact-divider${expanded ? ' expanded' : ''}`} role="separator" aria-label="上下文已压缩">
      <span className="msg-compact-divider-line" />
      <button
        type="button"
        className="msg-compact-divider-label"
        onClick={() => canExpand && setExpanded(v => !v)}
        aria-expanded={expanded}
        disabled={!canExpand}
        title={canExpand ? (locale === 'en' ? 'Toggle summary' : '展开/收起摘要') : undefined}
      >
        {locale === 'en' ? 'Context compacted' : '上下文已压缩'}
        {canExpand && <span className="msg-compact-divider-caret">{expanded ? '▾' : '▸'}</span>}
      </button>
      <span className="msg-compact-divider-line" />
      {expanded && canExpand && (
        <p className="msg-compact-divider-summary">{summary}</p>
      )}
    </div>
  )
}
