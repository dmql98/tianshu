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

/** Pretty-print a tool argument: parse JSON when possible, else show raw text. */
function formatArg(raw: string | undefined): string {
  if (!raw) return ''
  const trimmed = raw.trim()
  if (!trimmed) return ''
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2)
  } catch {
    return trimmed
  }
}

function statusLabel(status: string, t: (k: string) => string): string {
  if (status === 'success') return `✓ ${t('成功')}`
  if (status === 'error') return `✗ ${t('失败')}`
  return t('执行中...')
}

export default memo(function ToolCall({ message }: Props) {
  const [expanded, setExpanded] = useState(false)
  const t = useI18n()
  const status = message.tool_status || 'running'
  const icon = iconByTool[message.tool_name || ''] || 'tool-bash'
  const inputText = formatArg(message.tool_input)
  const hasInput = inputText.length > 0
  const hasOutput = !!message.tool_output

  return (
    <div className="msg-group star">
      <div className={`tool-invoke ${status}${expanded ? ' expanded' : ''}`}>
        <button
          type="button"
          className="tool-card-head"
          onClick={() => setExpanded(v => !v)}
          aria-expanded={expanded}
        >
          <Icon name={icon} size={14} ariaHidden />
          <span className="tool-card-name">{message.tool_name}</span>
          <span className="tool-card-dot">·</span>
          <span className={`tool-card-status ${status}`}>{statusLabel(status, t)}</span>
          <span className="tool-card-caret">{expanded ? '▾' : '▸'}</span>
        </button>

        {expanded && (
          <>
            {hasInput && (
              <div className="tool-card-section">
                <span className="tool-card-label">{t('参数')}</span>
                <pre className="tool-card-code">{inputText}</pre>
              </div>
            )}
            {hasOutput && (
              <div className="tool-card-section">
                <span className="tool-card-label">{t('结果')}</span>
                <pre className="tool-card-code tool-card-output">{message.tool_output}</pre>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
})
