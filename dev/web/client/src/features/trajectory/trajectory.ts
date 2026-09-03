import type { TrajectoryData, TrajectoryEvent, TrajectoryMessage } from '@/types'

export type TrajectoryRowKind = 'user' | 'assistant' | 'tool'

/** 轨迹页的一行内容（user / assistant / tool），按 messages 表 id 顺序 = 时间线顺序。 */
export interface TrajectoryRow {
  kind: TrajectoryRowKind
  messageId: number
  /** 该消息所属 run（会话级轨迹合并多个 run 时用于显示 run 边界）。 */
  runId: string | null
  createdAt: number
  /** 第几步（assistant = LLM 调用序号；其后的 tool 继承当前步）。跨 run 全局递增。 */
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

/** 会话轨迹中的 run 元信息（用于 run 边界分隔条）。 */
export interface TrajectoryRunMeta {
  id: string
  status: string
  queuedAt: number
  startedAt: number | null
  finishedAt: number | null
}

/** 子 agent 执行摘要（P2b：父轨迹内联显示，对齐 opencode formatSubagentToolcalls）。 */
export interface TrajectorySubagentSummary {
  sessionId: string
  targetCharacterId: string
  task: string
  status: string
  rows: TrajectoryRow[]
  lifecycle: TrajectoryLifecycleItem[]
  runs: TrajectoryRunMeta[]
  toolCalls: number
  result: string
}

/** 生命周期/审批/询问事件条（run.* / approval.* / ask_user），按 seq 顺序。 */
export interface TrajectoryLifecycleItem {
  type: string
  runId: string | null
  createdAt: number
  detail: string
}

/** 系统提示注入记录（来自 llm_calls 快照推导）：会话开头注入 / 之后 system 或 tools 变化时再注入。 */
export interface TrajectorySystemRow {
  kind: 'initial' | 'update'
  createdAt: number
  runId: string | null
  /** 关联的 LLM 调用序号。 */
  callTurn: number
  /** 完整系统提示文本（该次调用实际发送的 system 消息拼接）。 */
  system: string
  /** 该次调用实际发送的 system 消息快照（按组装顺序：静态拼接/技能/记忆/压缩摘要…）。 */
  messages: Array<{ role: string; content: unknown }>
  /** 该次调用实际发送的工具定义。 */
  tools: unknown[]
  /** system 消息 token 估算（服务端统一口径；缺失时前端本地估算兜底）。 */
  systemTokens?: number
  /** tools 参数 token 估算。 */
  toolsTokens?: number
  /** update 时上一次的状态，用于 Diff 分页。 */
  previous?: { system: string; toolNames: string[] }
}

export interface TrajectoryModel {
  rows: TrajectoryRow[]
  lifecycle: TrajectoryLifecycleItem[]
  /** 系统提示注入记录（initial + update），按时间顺序。 */
  systemRows: TrajectorySystemRow[]
  runs: TrajectoryRunMeta[]
  retries: number
  /** 子 agent 执行摘要（父轨迹内联；无子会话时为空数组）。 */
  subagents: TrajectorySubagentSummary[]
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
    // run-level 恢复重试（上游 503/网络不可用）：与服务端等待重试语义对齐。
    if (ev.scope === 'run_recovery') {
      return ['上游不可用，等待重试', attempt ? `第 ${attempt} 次` : '', error].filter(Boolean).join(' · ')
    }
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
    runId: message.run_id ?? null,
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

/** 从一条消息里提取 system 文本（支持 string 与 content parts 数组）。 */
function systemContentOf(m: unknown): string {
  const content = (m as any)?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map(block => (block as any)?.type === 'text' ? String((block as any).text ?? '') : '')
      .join('\n')
  }
  return ''
}

/** 从一次 LLM 调用快照提取系统提示文本（拼接所有 system 消息的 content，用于变化检测）。 */
function extractSystemText(messages: unknown[]): string {
  return (messages || [])
    .filter(m => (m as any)?.role === 'system')
    .map(m => systemContentOf(m))
    .filter(Boolean)
    .join('\n\n')
}

/** 系统提示的一个分块（与后端组装逻辑对应）。 */
export interface PromptSection {
  /** 第几条 system 消息（0 起，= 组装顺序：0=静态提示拼接，1=技能，2=记忆，3=压缩摘要…）。 */
  systemIndex: number
  title: string
  body: string
}

/**
 * 从非空行的首行提取块标题：
 * `## Title` → `Title`；`[Compacted History]` → 原样保留；其余 → 「补充提示」。
 */
function blockTitleOf(text: string): string {
  const first = text.split('\n').map(l => l.trim()).find(Boolean) ?? ''
  const m = first.match(/^##\s+(.+?)\s*$/)
  if (m) return m[1].trim()
  if (/^\[.+\]$/.test(first)) return first
  return ''
}

/**
 * 按后端组装逻辑切分系统提示分块（与 context-builder.ts 一一对应）：
 * - 每条 system 消息 = 一个分块，块上带 systemIndex 序号（0 起），组装顺序一目了然：
 *   system0=Character / system1=User Info / system2=模板块 / system3=Skill Packages /
 *   system4=Data Directory / system5=Workspace / system6=Active Session Skills /
 *   system7=Memory / system8=[Compacted History]；
 * - 单个块不再做 `## ` 内部分拆（后端已按消息边界组装，逐条展示即可）。
 */
export function extractSystemBlocks(messages: unknown[]): PromptSection[] {
  const blocks: PromptSection[] = []
  let sysIdx = 0
  for (const msg of (messages || []).filter(m => (m as any)?.role === 'system')) {
    const content = systemContentOf(msg)
    if (!content) { sysIdx++; continue }
    // 每条 system 消息整体一块：标题取首行（## X / [Compacted History]），内容完整保留。
    blocks.push({ systemIndex: sysIdx, title: blockTitleOf(content), body: content })
    sysIdx++
  }
  return blocks
}

/**
 * CJK-aware token 估算（与服务端 loop-policy.ts estimateTextTokens 一致）：
 * CJK 字符按 1 token/字，其余文本约 4 字符/token。
 */
export function estimateTextTokens(text: string): number {
  if (!text) return 0
  const cjk = (text.match(/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) || []).length
  const nonCjk = text.length - cjk
  return cjk + Math.ceil(nonCjk / 4)
}

/** 全部系统提示分块的总 token 估算。 */
export function estimateSystemTokens(blocks: PromptSection[]): number {
  return blocks.reduce((sum, b) => sum + estimateTextTokens(b.body), 0)
}

/** 工具定义数组（OpenAI 格式）JSON 序列化的 token 估算。 */
export function estimateToolsTokens(tools: unknown[] | undefined): number {
  if (!Array.isArray(tools)) return 0
  return tools.reduce<number>((sum, tool) => sum + estimateTextTokens(JSON.stringify(tool)), 0)
}

/**
 * 从工具定义提取名称。兼容 OpenAI 格式 { type:'function', function:{ name } }
 * 与扁平 { name }。llm_calls.request.tools 实际按 OpenAI 格式落库（见
 * server tools/definitions.ts getCharacterToolDefinitions），此前按扁平
 * tool.name 读取会全部读不到 → 系统提示的「工具」标签显示为空。
 */
export function toolNameOf(tool: unknown): string {
  if (!tool || typeof tool !== 'object') return ''
  const t = tool as Record<string, unknown>
  const fn = t.function
  if (fn && typeof fn === 'object') {
    const name = (fn as Record<string, unknown>).name
    if (typeof name === 'string') return name
  }
  if (typeof t.name === 'string') return t.name
  return ''
}

/** 从工具定义提取描述（OpenAI function.description 或扁平 description）。 */
export function toolDescriptionOf(tool: unknown): string {
  if (!tool || typeof tool !== 'object') return ''
  const t = tool as Record<string, unknown>
  const fn = t.function
  if (fn && typeof fn === 'object') {
    const desc = (fn as Record<string, unknown>).description
    if (typeof desc === 'string') return desc
  }
  if (typeof t.description === 'string') return t.description
  return ''
}

/** 工具名列表（稳定指纹：只看 name，忽略参数体变化）。 */
export function toolNames(tools: unknown[] | undefined): string[] {
  if (!Array.isArray(tools)) return []
  return tools.map(tool => toolNameOf(tool)).filter(Boolean)
}

/**
 * 从 llm_calls 快照推导系统提示注入记录（DSH 的 system / system-update 行）：
 * - 第一次调用 → initial 记录；
 * - 之后每当 system 文本或工具集合发生变化 → 新增 update 记录（含 previous 供 Diff）。
 * 调用按 created_at / turn 排序，保证时间顺序。
 */
function buildSystemRows(llmCalls: TrajectoryData['llmCalls']): TrajectorySystemRow[] {
  if (!llmCalls || llmCalls.length === 0) return []
  const calls = [...llmCalls].sort((a, b) =>
    (a.createdAt ?? 0) - (b.createdAt ?? 0) || a.turn - b.turn)
  const rows: TrajectorySystemRow[] = []
  let lastSystem = ''
  let lastToolNames: string[] = []
  for (const call of calls) {
    const system = extractSystemText(call.request.messages)
    const messages = call.request.messages as Array<{ role: string; content: unknown }>
    const tools = call.request.tools ?? []
    const names = toolNames(tools)
    if (rows.length === 0) {
      rows.push({
        kind: 'initial',
        createdAt: call.createdAt ?? 0,
        runId: call.runId ?? null,
        callTurn: call.turn,
        system,
        messages,
        tools,
        systemTokens: call.systemTokens,
        toolsTokens: call.toolsTokens,
      })
    } else if (system !== lastSystem || names.join(',') !== lastToolNames.join(',')) {
      rows.push({
        kind: 'update',
        createdAt: call.createdAt ?? 0,
        runId: call.runId ?? null,
        callTurn: call.turn,
        system,
        messages,
        tools,
        systemTokens: call.systemTokens,
        toolsTokens: call.toolsTokens,
        previous: { system: lastSystem, toolNames: lastToolNames },
      })
    }
    lastSystem = system
    lastToolNames = names
  }
  return rows
}

/**
 * 从会话轨迹数据构建时间线模型（对标 deepseek-harness trajectory）：
 * - 内容行按 messages.id 顺序（user → assistant → 其工具消息 → 下一个 assistant …），
 *   会话级数据会跨多个 run（用户多轮提问、自动续跑、ask_user 恢复等）自然合并为一条时间线；
 * - run 边界：runs 列表（含续跑链）全部并入 model.runs，供前端渲染 run 分隔条；
 * - 用事件富化：message.metrics 附 timing/缓存，usage 附 token 用量，
 *   tool.completed 附工具耗时；`usage` 在流中先于同一次调用的 `message.metrics`
 *   落库，所以用"待定用量"配对，避免不同步导致错位；
 * - 生命周期事件（run.* / approval.* / ask_user）独立成条并按时间顺序排列，真实渲染。
 */
/**
 * 单会话轨迹构建（buildTrajectory 的内部单元：主会话或一个子会话）。
 */
function buildSessionModel(
  messages: TrajectoryMessage[],
  runsRaw: TrajectoryData['runs'],
  events: TrajectoryEvent[],
  llmCalls: TrajectoryData['llmCalls'],
): { rows: TrajectoryRow[]; lifecycle: TrajectoryLifecycleItem[]; systemRows: TrajectorySystemRow[]; runs: TrajectoryRunMeta[]; retries: number } {
  const rows = messages.map(toRow)
  const runs: TrajectoryRunMeta[] = (runsRaw ?? []).map(run => ({
    id: run.id,
    status: run.status,
    queuedAt: run.queued_at,
    startedAt: run.started_at ?? null,
    finishedAt: run.finished_at ?? null,
  }))

  // 步号：assistant 行递增（跨 run 全局连续），其后的 tool 行继承当前步。
  let step = 0
  for (const row of rows) {
    if (row.kind === 'assistant') step += 1
    if (row.kind !== 'user') row.step = step
  }

  // 事件富化（events 按时间/seq 有序，跨 run 全局排列）。
  let lastAssistant: TrajectoryRow | null = null
  let pendingUsage: { input: number; output: number } | null = null
  const toolRows = rows.filter(row => row.kind === 'tool')
  let toolCursor = 0
  const takeNextTool = (): TrajectoryRow | undefined => toolRows[toolCursor++]

  const lifecycle: TrajectoryLifecycleItem[] = []
  let retries = 0

  for (const ev of events) {
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
        runId: ev.run_id ?? null,
        createdAt: ev.occurred_at,
        detail: lifecycleDetail(ev),
      })
    }
  }

  // 生命周期按发生时间排序（事件本身已按时间序，此处兜底，保证真实时间线）。
  lifecycle.sort((a, b) => a.createdAt - b.createdAt)

  // 系统提示注入记录：由每次 LLM 调用的请求快照推导（会话开头注入 + 变化时再注入）。
  const systemRows = buildSystemRows(llmCalls)

  return { rows, lifecycle, systemRows, runs, retries }
}

/** 从子会话 id（sub_<父id>_<角色id>_<时间戳>）提取目标角色 id；解析失败返回 null。 */
function parseSubTargetId(sid: string, parentId: string): string | null {
  const prefix = `sub_${parentId}_`
  if (!sid.startsWith(prefix)) return null
  const rest = sid.slice(prefix.length)
  const m = /^(.*)_\d+$/.exec(rest)
  return m ? m[1] : (rest || null)
}

/**
 * 从会话轨迹数据构建时间线模型（对标 deepseek-harness trajectory）。
 * P2b: 数据可包含直接子会话（includeChildren=1），按 session_id 分组——
 * 主会话走完整轨迹（含 run 边界/系统提示），每个子会话汇总为
 * TrajectorySubagentSummary（内联显示 toolcalls + 状态 + 结果摘要）。
 */
export function buildTrajectory(data: TrajectoryData): TrajectoryModel {
  const parentId = data.session?.id ?? data.messages[0]?.session_id ?? ''
  const groups = new Map<string, TrajectoryMessage[]>()
  for (const m of data.messages) {
    if (!groups.has(m.session_id)) groups.set(m.session_id, [])
    groups.get(m.session_id)!.push(m)
  }

  const parentMsgs = groups.get(parentId) ?? []
  const parentRuns = (data.runs ?? []).filter(r => r.session_id === parentId)
  const parentEvents = data.events.filter(e => e.session_id === parentId)
  const parentLlmCalls = (data.llmCalls ?? []).filter(c => c.sessionId === parentId)
  const parent = buildSessionModel(parentMsgs, parentRuns, parentEvents, parentLlmCalls)

  const subagents: TrajectorySubagentSummary[] = []
  for (const [sid, msgs] of groups) {
    if (sid === parentId) continue
    const runs = (data.runs ?? []).filter(r => r.session_id === sid)
    const events = data.events.filter(e => e.session_id === sid)
    const llmCalls = (data.llmCalls ?? []).filter(c => c.sessionId === sid)
    const sub = buildSessionModel(msgs, runs, events, llmCalls)
    subagents.push({
      sessionId: sid,
      targetCharacterId: parseSubTargetId(sid, parentId) ?? sid,
      task: sub.rows.find(r => r.kind === 'user')?.text ?? '',
      status: runs[runs.length - 1]?.status ?? 'completed',
      rows: sub.rows,
      lifecycle: sub.lifecycle,
      runs: sub.runs,
      toolCalls: sub.rows.filter(r => r.kind === 'tool').length,
      result: [...sub.rows].reverse().find(r => (r.kind === 'assistant' || r.kind === 'tool') && r.text)?.text ?? '',
    })
  }

  return { ...parent, subagents }
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
    systemRows: model.systemRows.filter(system =>
      system.system.toLowerCase().includes(q)
      || toolNames(system.tools).some(name => name.toLowerCase().includes(q))),
    runs: model.runs,
    retries: model.retries,
    subagents: model.subagents.map(sub => ({
      ...sub,
      rows: sub.rows.filter(rowMatch),
      lifecycle: sub.lifecycle.filter(lifecycleMatch),
    })),
  }
}
