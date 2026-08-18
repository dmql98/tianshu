import type { TrajectoryData, TrajectoryEvent, TrajectoryMessage } from '@/types'

export type TrajectoryRowKind = 'user' | 'assistant' | 'tool'

/** 轨迹页的一行内容（user / assistant / tool），按 messages 表 id 顺序 = 时间线顺序。 */
export interface TrajectoryRow {
  kind: TrajectoryRowKind
  messageId: number
  createdAt: number
  /** 第几步（assistant = LLM 调用序号；其后的 tool 继承当前步）。 */
  step: number | null
  text: string
  reasoning: string
  toolName: string | null
  toolArgs: string | null
  toolStatus: string | null
  isError: boolean
  // assistant 富化（来自 message.metrics / usage 事件）
  llmMs: number | null
  ttftMs: number | null
  decodeMs: number | null
  tokenSpeed: number | null
  tokenSpeedEstimated: boolean
  inputTokens: number | null
  outputTokens: number | null
  cacheHitTokens: number | null
  cacheMissTokens: number | null
  // tool 富化（来自 tool.completed）
  durationMs: number | null
  /** 请求编号 #N：assistant = LLM 调用序号，其后的 tool 继承当前步。 */
  requestNumber: number | null
  /** 截至本行（含）的累计输入 token。 */
  cumulativeInput: number | null
  /** 截至本行（含）的累计输出 token。 */
  cumulativeOutput: number | null
}

/** 每次 LLM 请求的编号行（deepseek-harness requestNumbers 的 tianshu 版）。 */
export interface TrajectoryRequestNumber {
  /** 顺序编号 #N（按请求开始时刻排序）。 */
  number: number
  step: number
  /** 对应 TrajectoryRow 下标（用于联动高亮）。 */
  rowIndex: number
  llmMs: number | null
  ttftMs: number | null
  decodeMs: number | null
  tokenSpeed: number | null
  tokenSpeedEstimated: boolean
  inputTokens: number | null
  outputTokens: number | null
  cacheHitTokens: number | null
  cacheMissTokens: number | null
  isError: boolean
  /** 编号递进时的累计用量（含本次）。 */
  cumulativeInput: number
  cumulativeOutput: number
}

/** 轮次分组：一组内是同一步（assistant + 其工具）或用户消息。 */
export interface TrajectoryGroup {
  kind: 'user' | 'step'
  step: number | null
  rows: TrajectoryRow[]
}

export interface TrajectoryTurn {
  /** 用户轮次号（1-based，由 user 消息驱动）。 */
  turn: number | null
  groups: TrajectoryGroup[]
}

/** 生命周期/审批/询问事件条（run.* / approval.* / ask_user），按 seq 顺序。 */
export interface TrajectoryLifecycleItem {
  type: string
  createdAt: number
  detail: string
}

export interface TrajectoryModel {
  rows: TrajectoryRow[]
  lifecycle: TrajectoryLifecycleItem[]
  retries: number
  /** 每次 LLM 请求的编号行（按开始时刻排序，含累计用量）。 */
  requests: TrajectoryRequestNumber[]
  /** 轮次 → 分组 → 行的折叠模型（用于时间线/分组折叠）。 */
  turns: TrajectoryTurn[]
}

const LIFECYCLE_TYPES = new Set([
  'run.queued', 'run.started', 'run.retrying', 'run.completed', 'run.failed',
  'run.cancelled', 'run.interrupted', 'run.max_turns', 'run.budget_exhausted',
  'run.limit_warning', 'run.grace_started', 'run.continuation_queued',
  'approval.requested', 'ask_user',
])

function toolCallId(toolArgs: string | null): string | undefined {
  if (!toolArgs) return undefined
  try {
    const parsed = JSON.parse(toolArgs) as { call_id?: unknown }
    return typeof parsed.call_id === 'string' ? parsed.call_id : undefined
  } catch {
    return undefined
  }
}

function lifecycleDetail(ev: TrajectoryEvent): string {
  if (ev.type === 'run.failed') return typeof ev.error === 'string' ? ev.error : ''
  if (ev.type === 'run.retrying') {
    const attempt = typeof ev.attempt === 'number' ? String(ev.attempt) : ''
    const error = typeof ev.error === 'string' ? ev.error : ''
    return [attempt ? `第 ${attempt} 次` : '', error].filter(Boolean).join(' · ')
  }
  if (ev.type === 'approval.requested') return typeof ev.tool_name === 'string' ? `工具 ${ev.tool_name}` : ''
  if (ev.type === 'ask_user') return typeof ev.question === 'string' ? String(ev.question) : ''
  if (ev.type === 'run.completed') return typeof ev.reason === 'string' ? String(ev.reason) : ''
  if (ev.type === 'run.limit_warning') return `软上限 ${String(ev.soft_turns ?? '')}`
  return ''
}

function toRow(message: TrajectoryMessage): TrajectoryRow {
  return {
    kind: message.role,
    messageId: message.id,
    createdAt: message.created_at,
    step: null,
    text: message.role === 'tool' ? (message.tool_output ?? '') : (message.content ?? ''),
    reasoning: message.reasoning_content ?? '',
    toolName: message.tool_name ?? null,
    toolArgs: message.tool_input ?? null,
    toolStatus: message.tool_status ?? null,
    isError: message.role === 'tool' && message.is_error === 1,
    llmMs: null,
    ttftMs: null,
    decodeMs: null,
    tokenSpeed: typeof message.token_speed === 'number' ? message.token_speed : null,
    tokenSpeedEstimated: false,
    inputTokens: null,
    outputTokens: null,
    cacheHitTokens: null,
    cacheMissTokens: null,
    durationMs: null,
    requestNumber: null,
    cumulativeInput: null,
    cumulativeOutput: null,
  }
}

/**
 * 从 trajectory 数据构建时间线模型：
 * - 内容行按 messages.id 顺序（user → assistant → 其工具消息 → 下一个 assistant …）；
 * - 用事件富化：message.metrics 附 timing/缓存，usage 附 token 用量，
 *   tool.completed 附工具耗时；`usage` 在流中先于同一次调用的 `message.metrics`
 *   落库，所以用"待定用量"配对，避免不同步导致错位；
 * - 生命周期事件单独成条（chip），重试计数单独统计。
 */
export function buildTrajectory(data: TrajectoryData): TrajectoryModel {
  const rows = data.messages.map(toRow)

  // 步号：assistant 行递增，其后的 tool 行继承当前步。
  let step = 0
  for (const row of rows) {
    if (row.kind === 'assistant') step += 1
    if (row.kind !== 'user') row.step = step
  }

  // 事件富化（events 按 seq 有序）。
  let lastAssistant: TrajectoryRow | null = null
  let pendingUsage: { input: number; output: number } | null = null
  const toolRows = rows.filter(row => row.kind === 'tool')
  let toolCursor = 0
  const takeNextTool = (): TrajectoryRow | undefined => toolRows[toolCursor++]

  const lifecycle: TrajectoryLifecycleItem[] = []
  let retries = 0

  for (const ev of data.events) {
    if (ev.type === 'message.metrics') {
      const byId = rows.find(row =>
        row.kind === 'assistant' && row.messageId === Number(ev.message_id))
      const target: TrajectoryRow | null = byId ?? lastAssistant
      if (target) lastAssistant = target
      if (target) {
        target.llmMs = typeof ev.llm_ms === 'number' ? ev.llm_ms : null
        target.ttftMs = typeof ev.ttft_ms === 'number' ? ev.ttft_ms : null
        target.decodeMs = typeof ev.decode_ms === 'number' ? ev.decode_ms : null
        if (typeof ev.token_speed === 'number') {
          target.tokenSpeed = ev.token_speed
          target.tokenSpeedEstimated = ev.token_speed_estimated === true
        }
        const cache = ev.cache as { hitTokens?: unknown; missTokens?: unknown } | undefined
        if (cache) {
          target.cacheHitTokens = typeof cache.hitTokens === 'number' ? cache.hitTokens : null
          target.cacheMissTokens = typeof cache.missTokens === 'number' ? cache.missTokens : null
        }
        if (pendingUsage) {
          target.inputTokens = pendingUsage.input
          target.outputTokens = pendingUsage.output
          pendingUsage = null
        }
      }
      continue
    }
    if (ev.type === 'usage') {
      pendingUsage = {
        input: typeof ev.input_tokens === 'number' ? ev.input_tokens : 0,
        output: typeof ev.output_tokens === 'number' ? ev.output_tokens : 0,
      }
      continue
    }
    if (ev.type === 'tool.completed') {
      const callId = typeof ev.tool_call_id === 'string' ? ev.tool_call_id : undefined
      const target = callId
        ? rows.find(row => row.kind === 'tool' && toolCallId(row.toolArgs) === callId)
        : undefined
      const resolved = target ?? takeNextTool()
      if (resolved && typeof ev.duration_ms === 'number') resolved.durationMs = ev.duration_ms
      continue
    }
    if (LIFECYCLE_TYPES.has(ev.type)) {
      if (ev.type === 'run.retrying') retries += 1
      lifecycle.push({
        type: ev.type,
        createdAt: ev.occurred_at,
        detail: lifecycleDetail(ev),
      })
    }
  }

  // ── 请求编号 + 累计用量 + 轮次分组（公共派生，供过滤后重建）──
  return { rows, lifecycle, retries, ...deriveRequestsAndTurns(rows) }
}

/**
 * 从内容行派生请求编号（#N）、累计用量与轮次分组。
 * buildTrajectory 与 filterTrajectory 共用，保证过滤后编号/分组一致。
 */
export function deriveRequestsAndTurns(rows: TrajectoryRow[]): {
  requests: TrajectoryRequestNumber[]
  turns: TrajectoryTurn[]
} {
  // 请求编号 + 累计用量
  const requests: TrajectoryRequestNumber[] = []
  let cumulativeInput = 0
  let cumulativeOutput = 0
  for (const [rowIndex, row] of rows.entries()) {
    if (row.kind === 'assistant') {
      const number = requests.length + 1
      row.requestNumber = number
      cumulativeInput += row.inputTokens ?? 0
      cumulativeOutput += row.outputTokens ?? 0
      row.cumulativeInput = cumulativeInput
      row.cumulativeOutput = cumulativeOutput
      requests.push({
        number,
        step: row.step ?? number,
        rowIndex,
        llmMs: row.llmMs,
        ttftMs: row.ttftMs,
        decodeMs: row.decodeMs,
        tokenSpeed: row.tokenSpeed,
        tokenSpeedEstimated: row.tokenSpeedEstimated,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        cacheHitTokens: row.cacheHitTokens,
        cacheMissTokens: row.cacheMissTokens,
        isError: row.isError,
        cumulativeInput,
        cumulativeOutput,
      })
    } else if (row.kind === 'tool' && row.step !== null) {
      // tool 行展示所属请求编号，不重复累计
      row.requestNumber = requests.length > 0 ? requests[requests.length - 1].number : null
    }
  }

  // 轮次分组：每条 user 消息开启新轮；轮内每个 assistant（及其工具）是一个 step 组。
  const turns: TrajectoryTurn[] = []
  let currentTurn: TrajectoryTurn | null = null
  let currentGroup: TrajectoryGroup | null = null
  let turnNo = 0
  for (const row of rows) {
    if (row.kind === 'user') {
      turnNo += 1
      currentTurn = { turn: turnNo, groups: [] }
      turns.push(currentTurn)
      currentGroup = { kind: 'user', step: null, rows: [] }
      currentTurn.groups.push(currentGroup)
    } else if (row.kind === 'assistant') {
      if (!currentTurn) {
        currentTurn = { turn: null, groups: [] }
        turns.push(currentTurn)
      }
      currentGroup = { kind: 'step', step: row.step, rows: [] }
      currentTurn.groups.push(currentGroup)
    } else if (row.kind === 'tool' && !currentGroup) {
      // 过滤后可能残留孤立 tool 行：并入新 turn 的 step 组，保持分组完整。
      if (!currentTurn) {
        currentTurn = { turn: null, groups: [] }
        turns.push(currentTurn)
      }
      currentGroup = { kind: 'step', step: row.step, rows: [] }
      currentTurn.groups.push(currentGroup)
    }
    currentGroup?.rows.push(row)
  }

  return { requests, turns }
}

/** 头部汇总：与侧边栏会话统计同口径（本 run 范围）。 */
export interface TrajectorySummary {
  turns: number
  tools: number
  llmMs: number
  toolMs: number
  ttftAvgMs: number | null
  decodeMs: number
  outputTokens: number
}

export function summarizeTrajectory(model: TrajectoryModel): TrajectorySummary {
  let turns = 0
  let tools = 0
  let llmMs = 0
  let toolMs = 0
  let ttftSum = 0
  let ttftN = 0
  let decodeMs = 0
  let outputTokens = 0
  for (const row of model.rows) {
    if (row.kind === 'assistant') {
      turns += 1
      llmMs += row.llmMs ?? 0
      decodeMs += row.decodeMs ?? 0
      outputTokens += row.outputTokens ?? 0
      if (row.ttftMs !== null && row.ttftMs > 0) {
        ttftSum += row.ttftMs
        ttftN += 1
      }
    } else if (row.kind === 'tool') {
      tools += 1
      toolMs += row.durationMs ?? 0
    }
  }
  return {
    turns,
    tools,
    llmMs,
    toolMs,
    ttftAvgMs: ttftN > 0 ? ttftSum / ttftN : null,
    decodeMs,
    outputTokens,
  }
}

/** 搜索过滤：匹配行文本/思考/工具名/参数/输出 或 生命周期详情。 */
export function filterTrajectory(model: TrajectoryModel, query: string): TrajectoryModel {
  const q = query.trim().toLowerCase()
  if (!q) return model
  const rowMatch = (row: TrajectoryRow): boolean =>
    [row.text, row.reasoning, row.toolName, row.toolArgs, row.toolStatus]
      .some(value => typeof value === 'string' && value.toLowerCase().includes(q))
  const lifecycleMatch = (item: TrajectoryLifecycleItem): boolean =>
    item.type.toLowerCase().includes(q) || item.detail.toLowerCase().includes(q)
  const filteredRows = model.rows.filter(rowMatch)
  return {
    rows: filteredRows,
    lifecycle: model.lifecycle.filter(lifecycleMatch),
    retries: model.retries,
    ...deriveRequestsAndTurns(filteredRows),
  }
}

// ── 时间线投影（对齐 deepseek-harness timeline.ts，适配 tianshu 行模型）──

/** 时间线投影模式：sequence 等宽序列 / duration 真实耗时（压缩空闲）。 */
export type TrajectoryTimelineMode = 'sequence' | 'duration'

/** 一条记录在时间线中的投影（车道 = user/assistant/tool）。 */
export interface TrajectoryTimelineSpan {
  /** 行下标（对应 TrajectoryRow 数组下标，用于联动高亮）。 */
  index: number
  kind: TrajectoryRowKind
  start: number
  end: number
  lane: 0 | 1 | 2
  isError: boolean
  label: string
  /** assistant 行内 TTFT 占比（0~1），无数据为 null。 */
  ttftFraction: number | null
}

export interface TrajectoryTimelineModel {
  start: number
  end: number
  spans: TrajectoryTimelineSpan[]
  /** user 行位置 = 轮次边界。 */
  turnBoundaries: Array<{ turn: number | null; time: number }>
}

function laneFor(kind: TrajectoryRowKind): 0 | 1 | 2 {
  if (kind === 'tool') return 2
  if (kind === 'assistant') return 1
  return 0
}

function rowDurationMs(row: TrajectoryRow): number | null {
  if (row.kind === 'assistant') return row.llmMs
  if (row.kind === 'tool') return row.durationMs
  return null
}

/**
 * 把轨迹行投影到横向时间线（sequence：每记录等宽；duration：按真实耗时）。
 * @param rows - 已富化的轨迹行（通常为 model.rows）。
 * @param mode - 投影模式。
 * @returns 时间线模型，无记录时返回 null。
 */
export function deriveTrajectoryTimeline(
  rows: TrajectoryRow[],
  mode: TrajectoryTimelineMode = 'sequence',
): TrajectoryTimelineModel | null {
  if (rows.length === 0) return null

  if (mode === 'sequence') {
    const spans: TrajectoryTimelineSpan[] = rows.map((row, index): TrajectoryTimelineSpan => {
      const ttftFraction = row.kind === 'assistant'
        && row.ttftMs !== null && row.llmMs !== null && row.llmMs > 0
        ? Math.min(1, Math.max(0, row.ttftMs / row.llmMs))
        : null
      return {
        index,
        kind: row.kind,
        start: index,
        end: index + 1,
        lane: laneFor(row.kind),
        isError: row.isError,
        label: row.kind === 'tool'
          ? (row.toolName ?? 'tool')
          : (row.text.length > 48 ? `${row.text.slice(0, 48)}…` : row.text || row.kind),
        ttftFraction,
      }
    })
    return {
      start: 0,
      end: rows.length,
      spans,
      turnBoundaries: rows
        .map((row, index) => ({ row, index }))
        .filter(entry => entry.row.kind === 'user')
        .map(entry => ({ turn: null, time: entry.index })),
    }
  }

  // duration：真实耗时压缩空闲（参考 deriveTimedTimeline 的 removedIdle 逻辑）
  const rawSpans = rows.map((row, index): TrajectoryTimelineSpan => {
    const durationMs = rowDurationMs(row)
    const ttftFraction = row.kind === 'assistant'
      && row.ttftMs !== null && row.llmMs !== null && row.llmMs > 0
      ? Math.min(1, Math.max(0, row.ttftMs / row.llmMs))
      : null
    return {
      index,
      kind: row.kind,
      start: index,
      end: index + (durationMs !== null && durationMs > 0 ? durationMs / 1000 : 0.25),
      lane: laneFor(row.kind),
      isError: row.isError,
      label: row.kind === 'tool'
        ? (row.toolName ?? 'tool')
        : (row.text.length > 48 ? `${row.text.slice(0, 48)}…` : row.text || row.kind),
      ttftFraction,
    }
  })
  const spans = rawSpans.map((span, i) => {
    if (i === 0) return span
    const gap = Math.max(0, span.start - rawSpans[i - 1].end)
    return { ...span, start: span.start - gap, end: span.end - gap }
  })
  return {
    start: spans[0].start,
    end: spans[spans.length - 1].end,
    spans,
    turnBoundaries: [],
  }
}

/**
 * 找出与选中区间重叠的记录下标（用于时间线拖选 → 表格高亮联动）。
 * @param rows - 轨迹行。
 * @param range - 选中区间（投影域内）。
 * @param mode - 与 deriveTrajectoryTimeline 相同的投影模式。
 */
export function trajectoryTimelineFocusIndexes(
  rows: TrajectoryRow[],
  range: { start: number; end: number },
  mode: TrajectoryTimelineMode = 'sequence',
): ReadonlySet<number> {
  const model = deriveTrajectoryTimeline(rows, mode)
  return new Set(
    model?.spans
      .filter(span => span.start <= range.end && span.end >= range.start)
      .map(span => span.index),
  )
}

/** 高亮一段文本中命中的子串（搜索高亮用，大小写不敏感）。 */
export function highlightParts(text: string, query: string): Array<{ text: string; hit: boolean }> {
  const q = query.trim().toLowerCase()
  if (!q || !text) return [{ text, hit: false }]
  const lower = text.toLowerCase()
  const parts: Array<{ text: string; hit: boolean }> = []
  let cursor = 0
  while (cursor < text.length) {
    const at = lower.indexOf(q, cursor)
    if (at === -1) {
      parts.push({ text: text.slice(cursor), hit: false })
      break
    }
    if (at > cursor) parts.push({ text: text.slice(cursor, at), hit: false })
    parts.push({ text: text.slice(at, at + q.length), hit: true })
    cursor = at + q.length
  }
  return parts
}
