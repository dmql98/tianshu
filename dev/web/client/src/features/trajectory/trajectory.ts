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

  return { rows, lifecycle, retries }
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
  return {
    rows: model.rows.filter(rowMatch),
    lifecycle: model.lifecycle.filter(lifecycleMatch),
    retries: model.retries,
  }
}
