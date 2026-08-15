import { useState } from 'react'
import type { Message } from '@/types'
import { useI18n } from '@/i18n'

interface Props {
  message: Message
}

const icons: Record<string, string> = {
  read: '📄',
  write: '✏️',
  edit: '🔧',
  bash: '⚙️',
  grep: '🔍',
  glob: '📂',
}

export default function ToolCall({ message }: Props) {
  const [expanded, setExpanded] = useState(false)
  const t = useI18n()
  const status = message.tool_status || 'running'
  const icon = icons[message.tool_name || ''] || '⚙️'

  return (
    <div className="msg-group star">
      <span
        className={`tool-tag ${status === 'success' ? 'success' : status === 'error' ? 'error' : ''} ${expanded ? 'expanded' : ''}`}
        onClick={() => setExpanded(!expanded)}
      >
        <span>{icon}</span>
        {message.tool_name} · {status === 'success' ? `✓ ${t('成功')}` : status === 'error' ? `✗ ${t('失败')}` : t('执行中...')}
        <span className="expand-icon">▶</span>
      </span>
      <div style={{ fontSize: 'calc(11px * var(--ui-font-scale))', color: 'var(--ink-light)', marginTop: 2 }}>
        {message.tool_input}
      </div>
      {expanded && message.tool_output && (
        <div className="tool-detail show">{message.tool_output}</div>
      )}
    </div>
  )
}
