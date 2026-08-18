import type {
  DebugTurnDetail,
  DebugTurnMeta,
} from '@/api/debug'

/**
 * Debug 轨迹纯函数层（M2）：
 * 把「每次 LLM 调用的完整请求/响应」（debug merged 文件，经 /api/debug 暴露）
 * 折叠成可渲染的记录模型：
 * - SYSTEM 记录：system prompt + 工具目录（按 fp 去重展示）
 * - assistant 记录：text / reasoning / toolCalls / usage / error
 * - tool 记录：每次 toolCall 的参数 + 结果（结果来自下一轮 request.messages 中
 *   role=tool 且 tool_call_id 匹配的消息）
 */

export interface DebugToolCallView {
  id: string | null
  name: string
  /** 参数 JSON（美化后）。 */
  args: string
  /** 从下一轮 tool 消息中匹配到的结果；null = 未记录。 */
  result: string | null
}

export interface DebugTurnView {
  turn: number
  timestamp: number
  fp: string
  model: string | null
  usage: { input: number; output: number } | null
  error: string | null
  text: string
  reasoning: string
  toolCalls: DebugToolCallView[]
  systemPrompts: string[]
  /** 完整请求消息历史（含 role=tool 结果），懒加载后可用。 */
  messages: DebugTurnDetail['messages']
  /** 工具定义（按函数名去重后的原始 JSON）。 */
  tools: unknown[]
}

export function formatToolArgs(raw: string): string {
  if (!raw) return ''
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

/**
 * 折叠一个 turn 的完整详情为视图记录。
 * @param detail - 本 turn 详情（懒加载）。
 * @param nextDetail - 下一 turn 详情（用于匹配本 turn toolCall 的结果），可为 null。
 */
export function buildDebugTurnView(
  detail: DebugTurnDetail,
  nextDetail: DebugTurnDetail | null,
): DebugTurnView {
  const results = new Map<string, string>()
  for (const msg of nextDetail?.messages ?? []) {
    if (msg.role === 'tool' && msg.tool_call_id && typeof msg.content === 'string') {
      results.set(msg.tool_call_id, msg.content)
    }
  }
  const toolCalls = (detail.response?.toolCalls ?? []).map(call => ({
    id: call.id ?? null,
    name: call.function?.name ?? '?',
    args: formatToolArgs(call.function?.arguments ?? ''),
    result: call.id ? (results.get(call.id) ?? null) : null,
  }))
  return {
    turn: detail.turn,
    timestamp: detail.timestamp,
    fp: detail.fp,
    model: detail.model,
    usage: detail.response?.usage ?? null,
    error: detail.error,
    text: detail.response?.text ?? '',
    reasoning: detail.response?.reasoning ?? '',
    toolCalls,
    systemPrompts: detail.system_prompts ?? [],
    messages: detail.messages ?? [],
    tools: detail.tools ?? [],
  }
}

export interface DebugSummary {
  turns: number
  models: string[]
  inputTokens: number
  outputTokens: number
  errors: number
  toolCalls: number
}

/** 会话段（merged 文件）级汇总 chips。 */
export function summarizeDebugTurns(turns: DebugTurnMeta[]): DebugSummary {
  const models = new Set<string>()
  let inputTokens = 0
  let outputTokens = 0
  let errors = 0
  let toolCalls = 0
  for (const turn of turns) {
    if (turn.model) models.add(turn.model)
    if (turn.usage) {
      inputTokens += turn.usage.input ?? 0
      outputTokens += turn.usage.output ?? 0
    }
    if (turn.error) errors += 1
    toolCalls += turn.tool_calls.length
  }
  return {
    turns: turns.length,
    models: [...models],
    inputTokens,
    outputTokens,
    errors,
    toolCalls,
  }
}

// ── 调试时间线（turn 粒度）──

export interface DebugTimelineSpan {
  /** turns 数组下标（用于联动高亮）。 */
  index: number
  turn: number
  start: number
  end: number
  lane: number
  isError: boolean
  label: string
}

export interface DebugTimelineModel {
  start: number
  end: number
  spans: DebugTimelineSpan[]
  turnBoundaries: { turn: number; time: number }[]
  /** duration 模式的墙钟总时长（ms）。 */
  wallMs: number | null
}

export type DebugTimelineMode = 'sequence' | 'duration'

/**
 * 把 turn 元数据投影成时间线：
 * - 每个 turn 必有一条 assistant 记录（lane 1）；有工具调用时加 tool 记录（lane 2）；
 *   fp 相对上一轮变化时加 SYSTEM 记录（lane 0）——对应「系统提示/工具目录变更」。
 * - sequence：等宽；duration：按 timestamp 到下一轮 timestamp 的间隔排布。
 */
export function deriveDebugTimeline(
  turns: DebugTurnMeta[],
  mode: DebugTimelineMode = 'sequence',
): DebugTimelineModel | null {
  if (turns.length === 0) return null
  const wallStart = Math.min(...turns.map(t => t.timestamp))
  const wallEnd = Math.max(...turns.map(t => t.timestamp))
  const wallMs = Math.max(0, wallEnd - wallStart)

  const spans: DebugTimelineSpan[] = []
  const turnBoundaries: { turn: number; time: number }[] = []
  let prevFp: string | null = null
  turns.forEach((turn, index) => {
    let start: number
    let end: number
    if (mode === 'duration') {
      const next = turns[index + 1]
      start = turn.timestamp
      end = next ? next.timestamp : turn.timestamp + 1000
    } else {
      start = index
      end = index + 1
    }
    if (turn.fp && turn.fp !== prevFp) {
      spans.push({ index, turn: turn.turn, start, end, lane: 0, isError: false, label: 'SYSTEM' })
    }
    prevFp = turn.fp || prevFp
    turnBoundaries.push({ turn: turn.turn, time: start })
    spans.push({
      index, turn: turn.turn, start, end, lane: 1,
      isError: Boolean(turn.error),
      label: turn.error ? `轮次 ${turn.turn}（错误）` : `轮次 ${turn.turn}`,
    })
    if (turn.tool_calls.length > 0) {
      spans.push({
        index, turn: turn.turn, start, end, lane: 2,
        isError: false,
        label: turn.tool_calls.map(call => call.name).join(', '),
      })
    }
  })

  return {
    start: mode === 'duration' ? wallStart : 0,
    end: mode === 'duration' ? wallEnd + (turns.length > 0 ? 1000 : 0) : turns.length,
    spans,
    turnBoundaries,
    wallMs: mode === 'duration' ? wallMs : null,
  }
}

/** 找出与选中区间重叠的 turn 集合。 */
export function debugTimelineFocusTurns(
  turns: DebugTurnMeta[],
  range: { start: number; end: number },
  mode: DebugTimelineMode = 'sequence',
): ReadonlySet<number> {
  const model = deriveDebugTimeline(turns, mode)
  return new Set(
    model?.spans
      .filter(span => span.start <= range.end && span.end >= range.start)
      .map(span => span.turn) ?? [],
  )
}
