import { useState } from 'react'
import type { Message } from '@/types'

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
  const status = message.tool_status || 'running'
  const icon = icons[message.tool_name || ''] || '⚙️'

  return (
    <div className="msg-group star">
      <span
        className={`tool-tag ${status === 'success' ? 'success' : status === 'error' ? 'error' : ''} ${expanded ? 'expanded' : ''}`}
        onClick={() => setExpanded(!expanded)}
      >
        <span>{icon}</span>
        {message.tool_name} · {status === 'success' ? '✓ 成功' : status === 'error' ? '✗ 失败' : '执行中...'}
        <span className="expand-icon">▶</span>
      </span>
      <div style={{ fontSize: 11, color: 'var(--ink-light)', marginTop: 2 }}>
        {message.tool_input}
      </div>
      {expanded && message.tool_output && (
        <div className="tool-detail show">{message.tool_output}</div>
      )}
    </div>
  )
}
