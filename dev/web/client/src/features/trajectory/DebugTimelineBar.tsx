import { useCallback, useMemo, useRef, useState } from 'react'
import { useI18n } from '@/i18n'
import type { DebugTurnMeta } from '@/api/debug'
import {
  type DebugTimelineMode,
  type DebugTimelineModel,
  debugTimelineFocusTurns,
} from '@/features/trajectory/debugTrajectory'
import { formatDuration } from '@/features/chat/runStats'

const LANE_COUNT = 3
const LANE_HEIGHT = 16
const LANE_GAP = 6

export interface DebugTimelineBarProps {
  turns: DebugTurnMeta[]
  timeline: DebugTimelineModel | null
  mode: DebugTimelineMode
  onModeChange: (mode: DebugTimelineMode) => void
  /** 焦点 turn 集合；null = 无选区。 */
  focus: ReadonlySet<number> | null
  onFocusChange: (focus: ReadonlySet<number> | null) => void
}

/** 调试详情页的 turn 粒度时间线：三车道（SYSTEM / 助手 / 工具）+ 拖选 → 账本联动。 */
export default function DebugTimelineBar({
  turns, timeline, mode, onModeChange, focus, onFocusChange,
}: DebugTimelineBarProps) {
  const t = useI18n()
  const containerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ startX: number; startPx: number; moved: boolean; lastX: number } | null>(null)
  const [dragRange, setDragRange] = useState<{ start: number; end: number } | null>(null)

  const width = timeline ? timeline.end - timeline.start : 0

  const pxToDomain = useCallback((clientX: number): number => {
    const el = containerRef.current
    if (!el || !timeline || width <= 0) return 0
    const rect = el.getBoundingClientRect()
    const ratio = (clientX - rect.left) / rect.width
    return timeline.start + ratio * width
  }, [timeline, width])

  const onPointerDown = (e: React.PointerEvent) => {
    if (!timeline) return
    e.preventDefault()
    const x = pxToDomain(e.clientX)
    dragRef.current = { startX: x, startPx: e.clientX, moved: false, lastX: x }
    setDragRange({ start: x, end: x })
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current
    if (!drag) return
    const x = pxToDomain(e.clientX)
    drag.lastX = x
    if (Math.abs(e.clientX - drag.startPx) > 2) drag.moved = true
    setDragRange({ start: Math.min(drag.startX, x), end: Math.max(drag.startX, x) })
  }

  const onPointerUp = () => {
    const drag = dragRef.current
    dragRef.current = null
    if (!drag || !timeline) return
    setDragRange(null)
    if (!drag.moved) {
      onFocusChange(null)
      return
    }
    const range = { start: Math.min(drag.startX, drag.lastX), end: Math.max(drag.startX, drag.lastX) }
    onFocusChange(debugTimelineFocusTurns(turns, range, mode))
  }

  const renderedFocus = useMemo(() => {
    if (!timeline) return null
    if (dragRange) return debugTimelineFocusTurns(turns, dragRange, mode)
    return focus
  }, [timeline, dragRange, focus, turns, mode])

  if (!timeline) return null

  const totalMs = timeline.wallMs ?? turns.length * 1000

  return (
    <div className="tjs-timeline-wrap">
      <div className="tjs-timeline-mode">
        <button
          className={`tjs-timeline-mode-btn ${mode === 'sequence' ? 'active' : ''}`}
          onClick={() => onModeChange('sequence')}
        >{t('序列')}</button>
        <button
          className={`tjs-timeline-mode-btn ${mode === 'duration' ? 'active' : ''}`}
          onClick={() => onModeChange('duration')}
        >{t('时长')}</button>
        {mode === 'duration' && totalMs > 0 && (
          <span className="tjs-timeline-total">{t('总耗时')} {formatDuration(totalMs)}</span>
        )}
      </div>
      <div
        ref={containerRef}
        className="tjs-timeline"
        style={{ height: LANE_COUNT * LANE_HEIGHT + (LANE_COUNT - 1) * LANE_GAP }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {timeline.turnBoundaries.map(boundary => (
          <div
            key={boundary.turn}
            className="tjs-timeline-boundary"
            style={{ left: `${((boundary.time - timeline.start) / width) * 100}%` }}
            title={`${t('轮次')} ${boundary.turn}`}
          />
        ))}
        {[0, 1, 2].map(lane => (
          <div
            key={lane}
            className="tjs-timeline-lane"
            style={{ top: lane * (LANE_HEIGHT + LANE_GAP), height: LANE_HEIGHT }}
          >
            {timeline.spans
              .filter(span => span.lane === lane)
              .map(span => {
                const focused = renderedFocus?.has(span.turn)
                const laneClass = lane === 0 ? 'user' : lane === 1 ? 'assistant' : 'tool'
                return (
                  <div
                    key={`${span.turn}-${lane}`}
                    className={`tjs-timeline-span tjs-timeline-span-${laneClass} ${focused ? 'focused' : ''} ${span.isError ? 'is-error' : ''}`}
                    style={{
                      left: `${((span.start - timeline.start) / width) * 100}%`,
                      width: `${Math.max((span.end - span.start) / width * 100, 0.15)}%`,
                    }}
                    title={span.label}
                  />
                )
              })}
          </div>
        ))}
        {dragRange && (
          <div
            className="tjs-timeline-drag"
            style={{
              left: `${((dragRange.start - timeline.start) / width) * 100}%`,
              width: `${Math.max((dragRange.end - dragRange.start) / width * 100, 0.15)}%`,
            }}
          />
        )}
      </div>
    </div>
  )
}
