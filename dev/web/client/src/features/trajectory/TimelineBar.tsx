import { useCallback, useMemo, useRef, useState } from 'react'
import { useI18n } from '@/i18n'
import {
  type TrajectoryTimelineModel,
  type TrajectoryTimelineMode,
  trajectoryTimelineFocusIndexes,
} from '@/features/trajectory/timeline'
import type { TrajectoryModel } from '@/features/trajectory/trajectory'
import { formatDuration } from '@/features/chat/runStats'

const LANE_COUNT = 3
const LANE_HEIGHT = 16
const LANE_GAP = 6

export interface TimelineBarProps {
  model: TrajectoryModel
  timeline: TrajectoryTimelineModel | null
  mode: TrajectoryTimelineMode
  onModeChange: (mode: TrajectoryTimelineMode) => void
  /** 当前焦点记录下标集合；null = 无选区。 */
  focus: ReadonlySet<number> | null
  onFocusChange: (focus: ReadonlySet<number> | null) => void
}

/**
 * 顶部 Overview 时间线（对标 deepseek-harness TrajectoryTimeline）：
 * 三车道（user / assistant / tool）+ 轮次边界 + 拖选区间 → 账本高亮联动。
 * sequence 模式等宽排布，duration 模式按真实耗时（压缩空闲）排布。
 */
export default function TimelineBar({
  model, timeline, mode, onModeChange, focus, onFocusChange,
}: TimelineBarProps) {
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
      // 点击无拖动 = 清除选区
      onFocusChange(null)
      return
    }
    const range = { start: Math.min(drag.startX, drag.lastX), end: Math.max(drag.startX, drag.lastX) }
    onFocusChange(trajectoryTimelineFocusIndexes(model, range, mode))
  }

  const spanStyle = (start: number, end: number): React.CSSProperties => {
    if (!timeline || width <= 0) return {}
    const left = ((start - timeline.start) / width) * 100
    const span = Math.max((end - start) / width * 100, 0.15)
    return { left: `${left}%`, width: `${span}%` }
  }

  const renderedFocus = useMemo(() => {
    if (!timeline) return null
    if (dragRange) {
      return trajectoryTimelineFocusIndexes(model, dragRange, mode)
    }
    return focus
  }, [timeline, dragRange, focus, model, mode])

  if (!timeline) return null

  const totalMs = timeline.wallMs ?? model.rows.reduce(
    (sum, row) => sum + (row.kind === 'assistant' ? (row.llmMs ?? 0) : row.kind === 'tool' ? (row.durationMs ?? 0) : 0),
    0,
  )

  return (
    <div className="tjs-timeline-wrap">
      <div className="tjs-timeline-mode">
        <button
          className={`tjs-timeline-mode-btn ${mode === 'sequence' ? 'active' : ''}`}
          onClick={() => onModeChange('sequence')}
          title={t('按记录顺序等宽排布')}
        >{t('序列')}</button>
        <button
          className={`tjs-timeline-mode-btn ${mode === 'duration' ? 'active' : ''}`}
          onClick={() => onModeChange('duration')}
          title={t('按真实耗时排布，压缩空闲')}
        >{t('时长')}</button>
        {totalMs > 0 && <span className="tjs-timeline-total">{t('总耗时')} {formatDuration(totalMs)}</span>}
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
                const focused = renderedFocus?.has(span.index)
                return (
                  <div
                    key={span.index}
                    className={`tjs-timeline-span tjs-timeline-span-${span.kind} ${focused ? 'focused' : ''} ${span.isError ? 'is-error' : ''}`}
                    style={spanStyle(span.start, span.end)}
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
