import { memo, useState } from 'react'
import type { Message } from '@/types'
import { useI18n } from '@/i18n'
import Icon from '@/features/icons/Icon'

interface Props {
  message: Message
}

const iconByTool: Record<string, string> = {
  read: 'tool-read',
  write: 'tool-write',
  edit: 'tool-edit',
  bash: 'tool-bash',
  grep: 'tool-grep',
  glob: 'tool-glob',
}

export default memo(function ToolCall({ message }: Props) {
  const [expanded, setExpanded] = useState(false)
  const t = useI18n()
  const status = message.tool_status || 'running'
  const icon = iconByTool[message.tool_name || ''] || 'tool-bash'

  return (
    <div className="msg-group star">
      <span
        className={`tool-tag ${status === 'success' ? 'success' : status === 'error' ? 'error' : ''} ${expanded ? 'expanded' : ''}`}
        onClick={() => setExpanded(!expanded)}
      >
        <Icon name={icon} size={13} ariaHidden />
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
})
