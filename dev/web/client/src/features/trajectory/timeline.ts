import type { TrajectoryModel, TrajectoryRow } from './trajectory'

/**
 * 时间线投影层（对标 deepseek-harness 的 timeline.ts）：
 * 把轨迹行投影成「车道 + 区间」的时间线模型，供顶部 Overview 渲染与拖选联动。
 *
 * - sequence：按行顺序等宽排布（不看真实时间），用于快速浏览结构；
 * - duration：按真实耗时排布（assistant 用 llmMs、tool 用 durationMs），
 *   压缩记录之间的空闲间隙，专注看每次操作的耗时占比。
 *
 * 车道：user → 0，assistant → 1，tool → 2。
 */

export type TrajectoryTimelineMode = 'sequence' | 'duration'

/** 一条记录在活动时间线域内的投影区间。 */
export interface TrajectoryTimelineSpan {
  /** rows 数组下标（用于与账本联动高亮）。 */
  index: number
  start: number
  end: number
  kind: TrajectoryRow['kind']
  lane: number
  isError: boolean
  label: string
}

export interface TrajectoryTimelineTurnBoundary {
  turn: number
  time: number
}

export interface TrajectoryTimelineModel {
  start: number
  end: number
  spans: TrajectoryTimelineSpan[]
  turnBoundaries: TrajectoryTimelineTurnBoundary[]
  /** duration 模式下的原始墙钟总时长（ms），供标签展示；sequence 为 null。 */
  wallMs: number | null
}

function laneFor(kind: TrajectoryRow['kind']): number {
  if (kind === 'tool') return 2
  if (kind === 'assistant') return 1
  return 0
}

function rowLabel(row: TrajectoryRow): string {
  if (row.kind === 'tool') {
    const bits = ['工具']
    if (row.toolName) bits.push(row.toolName)
    return bits.join(' · ')
  }
  if (row.kind === 'assistant') {
    const bits = ['助手']
    if (row.step !== null) bits.push(`#${row.step}`)
    return bits.join(' · ')
  }
  return '用户'
}

/** duration 模式下的耗时：assistant=llmMs，tool=durationMs，user=0。 */
function rowDurationMs(row: TrajectoryRow): number {
  if (row.kind === 'assistant') return Math.max(0, row.llmMs ?? 0)
  if (row.kind === 'tool') return Math.max(0, row.durationMs ?? 0)
  return 0
}

export function deriveTrajectoryTimeline(
  model: TrajectoryModel,
  mode: TrajectoryTimelineMode = 'sequence',
): TrajectoryTimelineModel | null {
  if (mode === 'sequence') {
    const spans: TrajectoryTimelineSpan[] = []
    const turnBoundaries: TrajectoryTimelineTurnBoundary[] = []
    let lastUserIndex: number | null = null
    model.rows.forEach((row, index) => {
      if (row.kind === 'user') {
        lastUserIndex = spans.length
        turnBoundaries.push({ turn: turnBoundaries.length + 1, time: spans.length })
      }
      spans.push({
        index,
        start: spans.length,
        end: spans.length + 1,
        kind: row.kind,
        lane: laneFor(row.kind),
        isError: row.isError,
        label: rowLabel(row),
      })
    })
    if (spans.length === 0) return null
    return { start: 0, end: spans.length, spans, turnBoundaries, wallMs: null }
  }

  return deriveDurationTimeline(model)
}

function deriveDurationTimeline(model: TrajectoryModel): TrajectoryTimelineModel | null {
  // 原始（墙钟）区间：start = createdAt，end = createdAt + 耗时。
  const rawSpans: Array<TrajectoryTimelineSpan & { createdAt: number }> = []
  let wallStart = Infinity
  let wallEnd = -Infinity
  for (let index = 0; index < model.rows.length; index += 1) {
    const row = model.rows[index]
    const start = row.createdAt
    const end = start + rowDurationMs(row)
    wallStart = Math.min(wallStart, start)
    wallEnd = Math.max(wallEnd, end)
    rawSpans.push({
      index,
      start,
      end,
      kind: row.kind,
      lane: laneFor(row.kind),
      isError: row.isError,
      label: rowLabel(row),
      createdAt: start,
    })
  }
  if (rawSpans.length === 0) return null
  const wallMs = Math.max(0, wallEnd - wallStart)

  // 压缩空闲：按 start 排序，把前面的覆盖终点与当前起点之间的空隙去掉。
  const removedIdleByIndex = new Map<number, number>()
  let removedIdle = 0
  let coveredUntil: number | null = null
  for (const span of [...rawSpans].sort((a, b) => a.start - b.start || a.end - b.end)) {
    if (coveredUntil !== null && span.start > coveredUntil) {
      removedIdle += span.start - coveredUntil
    }
    removedIdleByIndex.set(span.index, removedIdle)
    coveredUntil = coveredUntil === null ? span.end : Math.max(coveredUntil, span.end)
  }

  const spans = rawSpans.map(span => {
    const offset = removedIdleByIndex.get(span.index) ?? 0
    return { ...span, start: span.start - offset, end: span.end - offset }
  })

  // 轮次边界 = 该轮第一条 user 记录压缩后的起点。
  const turnBoundaries: TrajectoryTimelineTurnBoundary[] = []
  let turnNo = 0
  for (let index = 0; index < model.rows.length; index += 1) {
    const row = model.rows[index]
    if (row.kind === 'user') {
      turnNo += 1
      const span = spans.find(s => s.index === index)
      if (span) turnBoundaries.push({ turn: turnNo, time: span.start })
    }
  }

  return {
    start: Math.min(...spans.map(s => s.start)),
    end: Math.max(...spans.map(s => s.end)),
    spans,
    turnBoundaries,
    wallMs,
  }
}

/** 找出与选中区间重叠的记录下标集合（用于表格高亮联动）。 */
export function trajectoryTimelineFocusIndexes(
  model: TrajectoryModel,
  range: { start: number; end: number },
  mode: TrajectoryTimelineMode = 'sequence',
): ReadonlySet<number> {
  const timeline = deriveTrajectoryTimeline(model, mode)
  return new Set(
    timeline?.spans
      .filter(span => span.start <= range.end && span.end >= range.start)
      .map(span => span.index) ?? [],
  )
}
