import { useMemo, useRef, useState, type PointerEvent } from 'react'
import {
  deriveTrajectoryTimeline,
  type TrajectoryRow,
  type TrajectoryTimelineMode,
  type TrajectoryTimelineSpan,
} from './trajectory'

/**
 * 轨迹 Overview 时间线（deepseek-harness TrajectoryTimeline 的 tianshu 精简版）：
 * - 三车道：user（lane0）/ assistant（lane1）/ tool（lane2），按 rows 顺序排布；
 * - 模式：sequence 等宽 / duration 按真实耗时（压缩空闲）；
 * - assistant 条内按 TTFT/解码分段着色；
 * - 拖选区间 → onRangeChange；单击记录 → onRecordSelect。
 */

const MINIMUM_DRAG_PX = 3
const LANE_HEIGHT = 10
const LANE_GAP = 3

const KIND_LABEL: Record<TrajectoryTimelineSpan['kind'], string> = {
  user: 'USER',
  assistant: 'ASSISTANT',
  tool: 'TOOL',
}

export interface TimelineBarProps {
  rows: TrajectoryRow[]
  mode: TrajectoryTimelineMode
  range: { start: number; end: number } | null
  onRangeChange: (range: { start: number; end: number } | null) => void
  onRecordSelect?: (index: number) => void
  /** 搜索命中的行下标集合（无查询时为 null）。 */
  searchMatchIndexes?: ReadonlySet<number> | null
  /** 当前选中行下标（时间线点击后高亮）。 */
  selectedIndex?: number | null
}

export default function TimelineBar({
  rows, mode, range, onRangeChange, onRecordSelect,
  searchMatchIndexes = null, selectedIndex = null,
}: TimelineBarProps) {
  const model = useMemo(() => deriveTrajectoryTimeline(rows, mode), [rows, mode])
  const [draft, setDraft] = useState<{ start: number; end: number } | null>(null)
  const dragRef = useRef<{ pointerId: number; anchor: number; clientX: number; recordIndex: number | null } | null>(null)
  const trackRef = useRef<HTMLDivElement | null>(null)

  if (!model) return null

  const domain = model.end - model.start
  const fractionAt = (event: PointerEvent<HTMLDivElement>): number => {
    const rect = event.currentTarget.getBoundingClientRect()
    return Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width)))
  }
  const recordIndexAt = (event: PointerEvent<HTMLDivElement>): number | null => {
    const target = event.target instanceof HTMLElement ? event.target : null
    const value = target?.closest<HTMLElement>('[data-timeline-record-index]')?.dataset.timelineRecordIndex
    if (value === undefined) return null
    const index = Number(value)
    return Number.isFinite(index) ? index : null
  }
  const ordered = (a: number, b: number) => (a <= b ? { start: a, end: b } : { start: b, end: a })

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    const fraction = fractionAt(event)
    const point = model.start + fraction * domain
    dragRef.current = { pointerId: event.pointerId, anchor: point, clientX: event.clientX, recordIndex: recordIndexAt(event) }
    if (typeof event.currentTarget.setPointerCapture === 'function') {
      event.currentTarget.setPointerCapture(event.pointerId)
    }
    setDraft({ start: point, end: point })
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const point = model.start + fractionAt(event) * domain
    setDraft(ordered(drag.anchor, point))
  }

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    setDraft(null)
    const click = Math.abs(event.clientX - drag.clientX) < MINIMUM_DRAG_PX
    if (click && drag.recordIndex !== null) {
      onRangeChange(null)
      onRecordSelect?.(drag.recordIndex)
      return
    }
    const point = model.start + fractionAt(event) * domain
    const selected = ordered(drag.anchor, point)
    const minSelection = Math.max(0.001, domain / Math.max(1, model.spans.length))
    if (selected.end - selected.start < minSelection) {
      // 单击空白：聚焦最近记录
      const center = (selected.start + selected.end) / 2
      const nearest = model.spans.reduce((best, span) => {
        const distance = center < span.start ? span.start - center
          : center > span.end ? center - span.end : 0
        return distance < best.distance ? { span, distance } : best
      }, { span: model.spans[0], distance: Number.POSITIVE_INFINITY })
      if (nearest.span) onRecordFocus(nearest.span.index)
      onRangeChange(null)
      return
    }
    onRangeChange(selected)
  }

  const onPointerCancel = () => {
    dragRef.current = null
    setDraft(null)
  }

  const visibleRange = draft ?? range
  const lanes: Array<{ lane: 0 | 1 | 2; label: string }> = [
    { lane: 0, label: '输入' },
    { lane: 1, label: '模型' },
    { lane: 2, label: '工具' },
  ]

  return (
    <div className="tjs-timeline">
      <div className="tjs-timeline-lanes" aria-hidden="true">
        {lanes.map(l => <span key={l.lane}>{l.label}</span>)}
      </div>
      <div
        ref={trackRef}
        className="tjs-timeline-track"
        role="img"
        aria-label="轨迹时间线；拖动以聚焦记录"
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onDoubleClick={() => onRangeChange(null)}
        onContextMenu={e => e.preventDefault()}
      >
        {visibleRange && (
          <div
            className="tjs-timeline-selection"
            aria-hidden="true"
            style={{
              left: `${(visibleRange.start - model.start) / domain * 100}%`,
              width: `${(visibleRange.end - visibleRange.start) / domain * 100}%`,
            }}
          />
        )}
        {model.spans.map((span) => {
          const left = (span.start - model.start) / domain * 100
          const width = (span.end - span.start) / domain * 100
          const top = span.lane * (LANE_HEIGHT + LANE_GAP)
          const selected = selectedIndex === span.index
          const searchMatched = searchMatchIndexes === null
            ? undefined
            : searchMatchIndexes.has(span.index)
          return (
            <span
              key={span.index}
              className="tjs-timeline-span"
              data-timeline-record-index={span.index}
              data-kind={span.kind}
              data-error={span.isError || undefined}
              data-selected={selected || undefined}
              data-search-match={searchMatched === undefined ? undefined : (searchMatched ? 'true' : 'false')}
              data-assistant-timing={span.ttftFraction !== null ? 'true' : undefined}
              title={`${KIND_LABEL[span.kind]} #${span.index + 1} · ${span.label}`}
              style={{
                left: `${left}%`,
                width: `${Math.max(0.5, width)}%`,
                top,
                height: LANE_HEIGHT,
                ...(span.ttftFraction !== null
                  ? { '--tjs-ttft': `${span.ttftFraction * 100}%` } as React.CSSProperties
                  : {}),
              }}
            />
          )
        })}
      </div>
    </div>
  )

  function onRecordFocus(index: number) {
    onRecordSelect?.(index)
  }
}
