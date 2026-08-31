import { memo, useEffect, useRef, useState } from 'react'
import type { Message } from '@/types'
import { useI18n } from '@/i18n'
import ToolCall from './ToolCall'
import LiveDuration from './LiveDuration'
import { formatDuration } from '@/features/chat/runStats'

interface Props {
  /** 连续的 tool 消息（至少一条）。 */
  items: Message[]
}

/** 组头：任一工具仍在运行 → Running；全部完成 → Done。 */
function groupStatus(items: Message[]): 'running' | 'done' {
  return items.some(it => it.tool_status === 'running') ? 'running' : 'done'
}

/** 已知耗时的工具数（用于偶发缺 duration_ms 时兜底显示紧凑时长）。 */
function knownDurationMs(items: Message[]): number {
  let total = 0
  for (const it of items) {
    if (typeof it.tool_duration_ms === 'number' && it.tool_duration_ms >= 0) total += it.tool_duration_ms
  }
  return total
}

/**
 * 把同轮连续调用的多个工具合并为一个可折叠的「工具调用」组（对齐 penguin-harness 的
 * Reasoning & Tools 组）：组头显示 Running/Done + 步数 + 总耗时，点击整体折叠/展开；
 * 组内逐条复用 ToolCall 紧凑行（状态 + 可展开参数/结果）。
 *
 * 展开策略：运行中的组默认展开（看过程）；完成后自动折叠（仍可手动展开）；
 * 用户手动切换后记住选择，不再被状态变化覆盖。
 */
export default memo(function WorkGroup({ items }: Props) {
  const t = useI18n()
  const status = groupStatus(items)
  const running = status === 'running'
  const [open, setOpen] = useState(running)
  const userToggled = useRef(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!userToggled.current) setOpen(running)
  }, [running])

  // 运行中的组：从第一条工具的创建时刻起算 live 总时长。
  const firstTs = items[0]?.timestamp

  return (
    <div className="work-group" ref={rootRef}>
      <div className={`work-group-header ${status}`}>
        <button
          type="button"
          className="work-group-toggle"
          aria-expanded={open}
          onClick={() => {
            userToggled.current = true
            const willClose = open
            setOpen(v => !v)
            if (willClose) {
              requestAnimationFrame(() => rootRef.current?.scrollIntoView({ block: 'nearest' }))
            }
          }}
        >
          <span className={`work-group-status ${status}`}>
            {running ? t('进行中') : t('已完成')}
          </span>
          <span className="work-group-steps">
            {items.length > 0 ? t('{count} 次工具调用', { count: items.length }) : ''}
          </span>
          <span className="work-group-time">
            {running ? (
              <LiveDuration sinceMs={firstTs} />
            ) : knownDurationMs(items) > 0 ? (
              formatDuration(knownDurationMs(items))
            ) : null}
          </span>
          <span className="work-group-caret">{open ? '▾' : '▸'}</span>
        </button>
      </div>
      {open && (
        <div className="work-group-body">
          {items.map(it => (
            <ToolCall key={it.id} message={it} />
          ))}
        </div>
      )}
    </div>
  )
})
