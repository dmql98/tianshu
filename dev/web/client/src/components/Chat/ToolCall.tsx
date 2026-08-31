import { memo, useState } from 'react'
import type { Message } from '@/types'
import { useI18n } from '@/i18n'
import Icon from '@/features/icons/Icon'
import { formatDuration } from '@/features/chat/runStats'
import LiveDuration from './LiveDuration'

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

/**
 * 提取任务摘要（delegate_to_agent → args.task；send_message_to_subagent → args.message），
 * 显示在卡片头，让多张并行子代理卡片一眼可辨（搜科技 / 搜财经 / 搜国际…）。
 */
function taskSummary(raw: string | undefined): string {
  if (!raw) return ''
  try {
    const parsed = JSON.parse(raw) as { args?: { task?: string; message?: string } }
    const text = parsed?.args?.task || parsed?.args?.message || ''
    const oneLine = text.replace(/\s+/g, ' ').trim()
    if (!oneLine) return ''
    return oneLine.length > 24 ? oneLine.slice(0, 24) + '…' : oneLine
  } catch {
    return ''
  }
}

function statusLabel(status: string, t: (k: string) => string): string {
  if (status === 'success') return `✓ ${t('成功')}`
  if (status === 'error' || status === 'denied') return `✗ ${t('失败')}`
  if (status === 'done') return `✓ ${t('已完成')}`
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
  // 子代理卡片显示任务摘要（搜科技新闻…），多张并行卡片可区分
  const subTask = taskSummary(message.tool_input)
  const isSubAgentCard = message.tool_name === 'delegate_to_agent' || message.tool_name === 'send_message_to_subagent'

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
          {/* 耗时：running 显示 live 秒级计时（从卡片创建时刻起算），否则显示后端结算的 duration_ms */}
          {status === 'running' ? (
            <span className="tool-card-time">
              <LiveDuration sinceMs={message.timestamp} />
            </span>
          ) : typeof message.tool_duration_ms === 'number' && message.tool_duration_ms >= 0 ? (
            <span className="tool-card-time">· {formatDuration(message.tool_duration_ms)}</span>
          ) : null}
          {isSubAgentCard && subTask && (
            <span className="tool-card-subtask" title={subTask}>{subTask}</span>
          )}
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
