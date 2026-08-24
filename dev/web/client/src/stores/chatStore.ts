import { create } from 'zustand'
import { normalizeStrategy, type Session, type Message, type RunEvent, type RunLimitSummary, REASON_LABELS, type Strategy, type WorkspaceGroup } from '@/types'
import * as sessionsApi from '@/api/sessions'
import { fetchRecentRuns, fetchRunEvents, cancelRun, type RunResultShape } from '@/api/runs'
import { getEventBus } from '@/api/eventBus'
import { useProvidersStore } from './providersStore'
import type { CharacterMotion } from '@/api/characters'
import { motionForRunEvent } from '@/features/character-presence/motion'


const PERSIST_KEY = 'tianshu-chat-defaults'

const TERMINAL_RUN_STATUS = new Set([
  'completed', 'failed', 'cancelled', 'max_turns', 'budget_exhausted', 'interrupted',
])
// Run waiting on a human action (approval prompt / ask-user input / manual
// pause). These are NOT actively streaming and must not show the "working"
// state, otherwise the UI stays stuck forever once the backend has no live
// loop to resume.
const PARKED_RUN_STATUS = new Set(['awaiting_approval', 'awaiting_input', 'paused'])
const TERMINAL_EVENT_TYPES = new Set([
  'run.completed', 'run.failed', 'run.cancelled', 'run.interrupted', 'run.max_turns', 'run.budget_exhausted',
])
// Highest persisted event seq seen per run (survives reconnects to resume replay)
const runSeqByRunId = new Map<string, number>()

// Transport connection generation: any replay started by an earlier
// connect/disconnect cycle is stale and must not land its results.
let connectionGeneration = 0
function bumpConnectionGeneration(): number { return ++connectionGeneration }
function isCurrentGeneration(gen: number): boolean { return gen === connectionGeneration }
const pendingApprovalBySession = new Map<string, PendingApproval>()
const sessionMotionSince = new Map<string, number>()
const sessionMotionTimers = new Map<string, ReturnType<typeof setTimeout>>()
const TERMINAL_MOTION_TTL_MS = 8_000

// Abort latch: the stop button stays in a "stopping" state from the click
// until the server confirms a terminal event (or the safety timer fires), so
// a slow or racing abort never looks like the click "didn't take".
let abortingSessionId: string | null = null
let abortTimer: ReturnType<typeof setTimeout> | null = null

interface PendingApproval {
  session_id: string
  tool_call_id: string
  tool_name: string
  description: string
  approval_kind?: 'workspace' | 'risk'
  permission_root?: string
}

function pendingApprovalFromEvent(data: RunEvent): PendingApproval {
  return {
    session_id: data.session_id || '',
    tool_call_id: data.tool_call_id || '',
    tool_name: data.tool_name || 'tool',
    description: data.tool_input || '',
    approval_kind: data.approval_kind,
    permission_root: data.permission_root,
  }
}

interface Attachment {
  name: string
  mime: string
  data: string
  dataUrl?: string
}

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function toMessage(message: any): Message {
  return {
    id: String(message.id),
    role: message.role as Message['role'],
    content: message.content,
    reasoning: message.reasoning_content || undefined,
    tool_name: message.tool_name || undefined,
    tool_input: message.tool_input || undefined,
    tool_output: message.tool_output || undefined,
    tool_status: (message.tool_status as Message['tool_status']) || undefined,
    token_speed: typeof message.token_speed === 'number' ? message.token_speed : undefined,
    timestamp: message.created_at,
  }
}

/**
 * Insert or update a user message produced by a `message.created` event.
 * Keyed by the real DB message_id (`m${id}`) so the live stream and a
 * reconnect replay converge on the same node — no duplicate bubbles.
 * If an optimistic placeholder with the same content already sits at the
 * tail (AskUserDialog fast-path), it is upgraded in place instead of
 * duplicated.
 */
function applyMessageCreated(
  messages: Message[],
  data: { message_id?: number | null; content?: string; occurred_at?: number },
): Message[] {
  const id = `m${data.message_id}`
  const content = data.content ?? ''
  const idx = messages.findIndex(m => m.id === id)
  if (idx >= 0) {
    const existing = messages[idx]
    if (existing.role === 'user' && existing.content === content) return messages
    const next = [...messages]
    next[idx] = { ...existing, role: 'user', content, timestamp: data.occurred_at ?? existing.timestamp }
    return next
  }
  const last = messages[messages.length - 1]
  if (last && last.role === 'user' && last.content === content && !last.id.startsWith('m')) {
    const next = [...messages]
    next[next.length - 1] = { ...last, id, timestamp: data.occurred_at ?? last.timestamp }
    return next
  }
  return [...messages, { id, role: 'user', content, timestamp: data.occurred_at ?? Date.now() }]
}

/**
 * Insert a model question (ask_user) as an assistant message so it stays in
 * the conversation flow paired with the user's answer. Keyed by the asking
 * run_id so the live stream and a reconnect replay converge on the same node.
 * Positioned by occurred_at so it precedes the answer even when replayed after
 * the answer is already present.
 */
function applyAskUserQuestion(
  messages: Message[],
  data: { run_id?: string | null; question?: string; occurred_at?: number },
): Message[] {
  if (!data.run_id || !data.question) return messages
  const id = `ask-${data.run_id}`
  if (messages.some(m => m.id === id)) return messages
  const msg: Message = {
    id,
    role: 'assistant',
    content: data.question,
    timestamp: data.occurred_at ?? Date.now(),
  }
  const idx = messages.findIndex(m => m.timestamp > msg.timestamp)
  if (idx < 0) return [...messages, msg]
  const next = [...messages]
  next.splice(idx, 0, msg)
  return next
}

/**
 * Insert a conversation-flow compaction divider (virtual marker, not a real
 * persisted message) when the model compacts context. Keyed by the compacting
 * run_id so the live stream and a reconnect replay converge on the same node.
 * Positioned by occurred_at so it sits between the shadowed history and the
 * new context even when replayed after the surrounding messages are present.
 */
function applyCompactMarker(
  messages: Message[],
  data: { run_id?: string | null; occurred_at?: number; compaction_summary?: string | null },
): Message[] {
  const id = `compact-${data.run_id ?? data.occurred_at ?? 'unknown'}`
  if (messages.some(m => m.id === id)) return messages
  const msg: Message = {
    id,
    role: 'assistant',
    content: '',
    notice: 'compacted',
    compact_summary: data.compaction_summary ?? null,
    timestamp: data.occurred_at ?? Date.now(),
  }
  const idx = messages.findIndex(m => m.timestamp > msg.timestamp)
  if (idx < 0) return [...messages, msg]
  const next = [...messages]
  next.splice(idx, 0, msg)
  return next
}

function loadPersistedDefaults(): Record<string, string | undefined> {
  try {
    const raw = localStorage.getItem(PERSIST_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed
  } catch {
    return {}
  }
}

function savePersistedDefaults(data: Record<string, string | undefined>) {
  const existing = loadPersistedDefaults()
  localStorage.setItem(PERSIST_KEY, JSON.stringify({ ...existing, ...data }))
}

// ── Store ──

export type ActiveRunPhase = 'idle' | 'running' | 'continuation_pending' | 'parked' | 'cancelling'

export interface ActiveRunState {
  runId: string | null
  continuationRootRunId: string | null
  phase: ActiveRunPhase
  nextRunId: string | null
  limitWarning?: RunLimitSummary | null
}

export const IDLE_RUN: ActiveRunState = {
  runId: null,
  continuationRootRunId: null,
  phase: 'idle',
  nextRunId: null,
  limitWarning: null,
}

/**
 * Live-run bookkeeping per session. The global `isStreaming` / `activeRun` /
 * `_activeRunId` fields are DERIVED from the record of the active session, so
 * events from a background session can never corrupt the send/stop button of
 * the session being viewed (multi-session concurrency).
 */
export interface SessionRunRecord {
  isStreaming: boolean
  activeRun: ActiveRunState
  activeRunId: string | null
}

interface ChatState {
  // Sessions
  sessions: Session[]
  activeSessionId: string | null
  isStreaming: boolean
  streamConnected: boolean
  isRefreshing: boolean
  pendingApproval: PendingApproval | null
  pendingAskUser: { run_id: string; session_id: string; question: string } | null

  // Cross-run active state (RUN_LIMIT_POLICY_PLAN §14)
  activeRun: ActiveRunState
  limitNotice: { text: string; tone?: 'warn' | 'info' } | null

  // Per-session live-run state (source of truth; globals above are derived).
  sessionRuns: Record<string, SessionRunRecord>
  sessionMotions: Record<string, CharacterMotion>

  // UI state
  collapsedWorkspaces: Set<string>
  toolExpandAll: boolean
  isBatchMode: boolean
  selectedSessionIds: Set<string>

  // Stats
  tokenUsage: { input: number; output: number; total: number }
  evolutionNotification: { session_id: string; insight_type: string; description: string } | null

  // Attachments
  attachments: Attachment[]

  // Cleanup ref (not in state, mutable)
  _activeRunId: string | null
  _notificationTimer: ReturnType<typeof setTimeout> | null
  _loadingSessions: boolean

  // ── Actions ──

  // Sessions
  loadSessions: () => Promise<void>
  createSession: (opts?: {
    character_id?: string; model?: string; provider_id?: string
    workspace?: string; workspaces?: string[]; parent_id?: string
    active_group?: string; session_type?: 'chat' | 'event'
    event_id?: string | null; title?: string
  }) => Promise<Session>
  switchSession: (id: string) => Promise<void>
  refreshSession: (id?: string) => Promise<void>
  renameSession: (id: string, title: string) => Promise<void>
  deleteSession: (id: string) => Promise<void>
  resetToMessage: (sessionId: string, messageId: string) => Promise<void>
  toggleSessionStar: (id: string) => void

  // Messages
  sendMessage: (input: string) => Promise<void>
  /** Insert/update a message in one session's list (used for optimistic inserts). */
  updateSessionMessage: (sessionId: string, updater: (session: Session) => Session) => void
  editMessage: (messageId: string, content: string) => Promise<void>
  forkFromMessage: (messageId: string) => Promise<Session>
  abortRun: () => void
  setStrategy: (strategy: Strategy) => void
  respondApproval: (choice: 'once' | 'always' | 'reject') => void
  clearAskUser: () => void
  resumeActiveRun: (sessionId: string) => Promise<void>
  setActiveRunPhase: (phase: ActiveRunPhase, patch?: Partial<ActiveRunState>) => void
  clearLimitNotice: () => void

  // Attachments
  addAttachment: (name: string, mime: string, data: string, dataUrl?: string) => void
  removeAttachment: (idx: number) => void
  clearAttachments: () => void

  // Workspaces
  addWorkspace: (path: string) => void
  removeWorkspace: (path: string) => void
  toggleWorkspaceCollapse: (workspace: string) => void

  // Batch ops
  toggleBatchMode: () => void
  toggleSessionSelection: (sessionId: string) => void
  batchDeleteSessions: () => Promise<void>
  deleteProject: (workspace: string) => Promise<void>

  // UI
  toggleAllTools: () => void
  clearEvolutionNotification: () => void
}

export const useChatStore = create<ChatState>((set, get) => {
  let pendingSupersedesMessageId: number | null = null

  // ── 流式高频事件合并（对齐 DSH animation-frame 合并策略）──
  // message.delta / tool.output 每 token 一次 emit；若逐条 setState，React
  // 每 token 全量重渲（sessions.map + messages.map + Markdown 全文重解析），
  // 100+ tok/s 时主线程持续满载 → 客户端变"卡"。按 ~50ms 窗口缓冲合并，
  // N 个事件折叠成 1 次 store 更新（≈20 次/s），渲染成本直降一个数量级。
  const STREAM_COALESCE_MS = 50
  const pendingStreamDeltas = new Map<string, {
    sessionId: string
    runId?: string
    text: string
    reasoning: string
    tokenSpeed?: number
    tokenSpeedEstimated?: boolean
  }>()
  const pendingToolOutputs = new Map<string, {
    sessionId: string
    toolCallId: string
    output: string
  }>()
  let streamFlushTimer: ReturnType<typeof setTimeout> | null = null

  function scheduleStreamFlush() {
    if (streamFlushTimer !== null) return
    streamFlushTimer = setTimeout(() => {
      streamFlushTimer = null
      flushStreamBuffers()
    }, STREAM_COALESCE_MS)
  }

  /** 合并一条 message.delta（正文/思考增量）到对应 session 的缓冲。 */
  function enqueueStreamDelta(data: RunEvent) {
    const key = `${data.session_id}|${data.run_id || ''}`
    const prev = pendingStreamDeltas.get(key)
    pendingStreamDeltas.set(key, {
      sessionId: data.session_id,
      runId: data.run_id,
      text: (prev?.text || '') + (data.delta || ''),
      reasoning: (prev?.reasoning || '') + (data.reasoning || ''),
      tokenSpeed: data.token_speed ?? prev?.tokenSpeed,
      tokenSpeedEstimated: data.token_speed_estimated ?? prev?.tokenSpeedEstimated,
    })
    scheduleStreamFlush()
  }

  /** 合并一条 tool.output（bash 流式 chunk）到对应 tool 调用的缓冲。 */
  function enqueueToolOutput(data: RunEvent) {
    if (!data.tool_call_id) return
    const key = `${data.session_id}|${data.tool_call_id}`
    const prev = pendingToolOutputs.get(key)
    pendingToolOutputs.set(key, {
      sessionId: data.session_id,
      toolCallId: data.tool_call_id,
      output: (prev?.output || '') + (data.output || ''),
    })
    scheduleStreamFlush()
  }

  /** 立即落空缓冲（终端/里程碑事件前调用，保证最后一段流式文本先落地）。 */
  function flushStreamBuffers() {
    if (streamFlushTimer !== null) {
      clearTimeout(streamFlushTimer)
      streamFlushTimer = null
    }
    if (pendingStreamDeltas.size === 0 && pendingToolOutputs.size === 0) return
    const deltas = [...pendingStreamDeltas.values()]
    pendingStreamDeltas.clear()
    const outputs = [...pendingToolOutputs.values()]
    pendingToolOutputs.clear()
    for (const d of deltas) {
      updateSessionMessage(d.sessionId, sess => {
        const last = sess.messages[sess.messages.length - 1]
        if (last?.role === 'assistant' && last.is_streaming) {
          return {
            ...sess,
            messages: sess.messages.map((m, i) => i === sess.messages.length - 1
              ? {
                  ...m,
                  content: m.content + d.text,
                  reasoning: (m.reasoning || '') + d.reasoning,
                  token_speed: d.tokenSpeed ?? m.token_speed,
                  token_speed_estimated: d.tokenSpeedEstimated ?? m.token_speed_estimated,
                }
              : m
            ),
          }
        }
        if (!d.text && !d.reasoning) return sess
        return {
          ...sess,
          messages: [...sess.messages, {
            id: uid(), role: 'assistant' as const, content: d.text,
            reasoning: d.reasoning, is_streaming: true,
            token_speed: d.tokenSpeed,
            token_speed_estimated: d.tokenSpeedEstimated,
            timestamp: Date.now(),
          }],
        }
      })
    }
    for (const t of outputs) {
      updateSessionMessage(t.sessionId, sess => ({
        ...sess,
        messages: sess.messages.map(m =>
          m.role === 'tool' && m.tool_call_id === t.toolCallId
            ? { ...m, tool_output: (m.tool_output || '') + t.output }
            : m
        ),
      }))
    }
  }

  /** LLM 请求重试（run.retrying）时重置该 session 的流式累积：服务端
   *  streamWithRetry 的每个 attempt 都会实时 emit message.delta——若 attempt 1
   *  输出了一部分后失败，这部分已拼进前端消息，attempt 2 会从零重新完整输出，
   *  若不重置前端就会把两段拼成重复文本（新会话/停止后首次调用最易触发重试，
   *  刷新后从 messages 表读最终结果所以正常）。这里清空 pending 缓冲并把当前
   *  流式消息的内容/思考置空，让重试的新流从零累积。 */
  function resetStreamingContent(sessionId: string) {
    for (const key of [...pendingStreamDeltas.keys()]) {
      if (pendingStreamDeltas.get(key)?.sessionId === sessionId) pendingStreamDeltas.delete(key)
    }
    for (const key of [...pendingToolOutputs.keys()]) {
      if (pendingToolOutputs.get(key)?.sessionId === sessionId) pendingToolOutputs.delete(key)
    }
    updateSessionMessage(sessionId, sess => ({
      ...sess,
      messages: sess.messages.map((m, i) =>
        i === sess.messages.length - 1 && m.role === 'assistant' && m.is_streaming
          ? { ...m, content: '', reasoning: '' }
          : m
      ),
    }))
  }

  /** 判断一个终态/里程碑事件是否属于该 session 当前跟踪的运行。停止（abort）后
   *  立刻发新消息时，旧 run 的 run.cancelled / run.completed 等终态会姗姗来迟；
   *  若此时仍按旧逻辑处理（把最后一条流式消息置终、settleAbort 清空 activeRunId），
   *  _activeRunId 会在新 run 流式过程中被清零，导致后续每个 message.delta 被临时
   *  监听器与持久监听器各入队一次——每个 chunk 追加两遍，整段回复文本翻倍
   *  （“你好” → “你好你好”）。旧 run 的终态只应作用于它自己，不能改写新 run
   *  的流式状态；新 run 会有自己的终态事件。 */
  function isCurrentTrackedRun(data: RunEvent): boolean {
    if (!data.session_id) return true
    const tracked = get().sessionRuns[resolveSessionRoot(data.session_id)]?.activeRunId
    return !tracked || !data.run_id || data.run_id === tracked
  }

  function clearPendingApproval(sessionId: string) {
    pendingApprovalBySession.delete(sessionId)
    if (get().activeSessionId === sessionId) set({ pendingApproval: null })
  }

  function setSessionMotion(sessionId: string, motion: CharacterMotion, since = Date.now()) {
    if (!sessionId || since < (sessionMotionSince.get(sessionId) ?? 0)) return
    sessionMotionSince.set(sessionId, since)
    // 高频流式事件（message.delta / tool.output 每 chunk 一条）都走这里。
    // 持续态（working/speaking/thinking/listening）在整段输出期间不变化：
    // 相同 motion 直接跳过 store set，把 set 频率从"每 chunk 一次"降到
    // "每状态变化一次"，否则 bash 输出几百条 chunk 时主线程被 set 风暴拖垮，
    // 表现就是"界面不动了"，刷新后积压事件批量补出。终态仍走原逻辑
    // （需要正确重置 success/error 的 TTL 定时器）。
    const currentMotion = get().sessionMotions[sessionId]
    if (currentMotion === motion && motion !== 'success' && motion !== 'error') return
    const existingTimer = sessionMotionTimers.get(sessionId)
    if (existingTimer) clearTimeout(existingTimer)
    sessionMotionTimers.delete(sessionId)

    const settle = () => {
      if (sessionMotionSince.get(sessionId) !== since) return
      set(state => ({ sessionMotions: { ...state.sessionMotions, [sessionId]: 'idle' } }))
    }
    if (motion === 'success' || motion === 'error') {
      const remaining = TERMINAL_MOTION_TTL_MS - (Date.now() - since)
      if (remaining <= 0) motion = 'idle'
      else sessionMotionTimers.set(sessionId, setTimeout(settle, remaining))
    }
    set(state => ({ sessionMotions: { ...state.sessionMotions, [sessionId]: motion } }))
  }

  /** A run really terminated (or the chain was cancelled): leave the stopping state. */
  function settleAbort(sessionId: string) {
    if (abortingSessionId === null) return
    if (abortingSessionId === sessionId) abortingSessionId = null
    if (abortTimer) { clearTimeout(abortTimer); abortTimer = null }
    updateSessionRun(sessionId, {
      activeRun: { ...IDLE_RUN },
      activeRunId: null,
      isStreaming: false,
    })
  }

  /** While a session is aborting, ignore events that would re-arm its streaming state. */
  function isAbortingSession(sessionId?: string): boolean {
    return abortingSessionId !== null && (sessionId === undefined || sessionId === abortingSessionId)
  }

  // ── Persistent stream listeners (registered once) ──
  function initPersistentListeners() {
    const bus = getEventBus()

    // Track the highest seq seen per run so reconnects can resume replay.
    const TRACKED_EVENTS = [
      'run.queued', 'run.started', 'run.retrying', 'run.completed', 'run.failed',
      'run.cancelled', 'run.interrupted', 'run.max_turns', 'run.budget_exhausted',
      'run.limit_warning', 'run.grace_started',
      'run.continuation_queued', 'message.delta', 'message.metrics',
      'tool.started', 'tool.completed', 'tool.output', 'approval.requested', 'usage',
      'ask_user',
    ]
    for (const type of TRACKED_EVENTS) {
      bus.on(type, (data: RunEvent) => {
        if (data.run_id && typeof data.seq === 'number') {
          const prev = runSeqByRunId.get(data.run_id) || 0
          if (data.seq > prev) runSeqByRunId.set(data.run_id, data.seq)
        }
        const motion = motionForRunEvent(type)
        if (motion && data.session_id) {
          setSessionMotion(data.session_id, motion, data.occurred_at ?? Date.now())
        }
        if (data.session_id && TERMINAL_EVENT_TYPES.has(type)) {
          clearPendingApproval(data.session_id)
        }
      })
    }

    // After reconnect, replay persisted events for every tracked run. Background
    // sessions can stream too; replaying only the visible session leaves the
    // others permanently stale after a transport interruption.
    const offConnect = bus.onConnect(async () => {
      // Fresh connection generation: any replay started by an earlier
      // connect/disconnect cycle is now stale and must not land its results.
      const generation = bumpConnectionGeneration()
      set({ streamConnected: true })
      try {
        // REST replay does not depend on a transport handshake.
        if (!isCurrentGeneration(generation) || !get().streamConnected) return
        const state = get()
        // Session creation notifications (especially sub-agent sessions) are
        // ephemeral stream events. Reconcile the authoritative session tree on
        // every connect so an event missed while offline is not lost forever.
        void state.loadSessions()
        // Replay run events through a small concurrency pool: a reconnect
        // burst firing dozens of parallel fetches at once is what makes the UI
        // jank. Results from a generation that died meanwhile are discarded.
        const targets = Object.entries(state.sessionRuns)
          .filter(([, record]) => !!record.activeRunId)
          .map(([sessionId, record]) => ({ sessionId, runId: record.activeRunId as string }))
        const REPLAY_POOL_SIZE = 3
        let cursor = 0
        const worker = async () => {
          while (cursor < targets.length) {
            const target = targets[cursor++]
            if (!isCurrentGeneration(generation)) return
            const afterSeq = runSeqByRunId.get(target.runId) || 0
            try {
              const events = await fetchRunEvents(target.runId, afterSeq)
              if (!isCurrentGeneration(generation)) return
              if (events.length === 0) continue
              applyRunEvents(target.sessionId, events)
              runSeqByRunId.set(target.runId, events[events.length - 1].seq ?? afterSeq)
            } catch {
              // Run may be gone after the restart; skip it.
            }
          }
        }
        await Promise.all(Array.from(
          { length: Math.min(REPLAY_POOL_SIZE, targets.length) },
          () => worker(),
        ))
      } catch (error) {
        console.error('[stream] reconnect replay failed:', error)
      }
    })
    const offDisconnect = bus.onDisconnect(() => {
      // Invalidate any replay still in flight from the connection that just died.
      bumpConnectionGeneration()
      set({ streamConnected: false })
    })

    // Live context usage — every LLM call reports the real prompt size, so the
    // context progress bar tracks actual tokens instead of a character estimate.
    // Only accept positive counts: a 0/absent value mid-stream (or for a
    // provider that doesn't report usage) must NOT overwrite the last real one,
    // otherwise the bar collapses then jumps back up.
    bus.off('usage')
    bus.on('usage', (data: { session_id: string; run_id?: string; input_tokens?: number; output_tokens?: number }) => {
      if (!data.session_id) return
      // Live context usage — bar tracking (only positive counts).
      if (typeof data.input_tokens === 'number' && data.input_tokens > 0) {
        set(state => ({
          sessions: state.sessions.map(s =>
            s.id === data.session_id ? { ...s, context_usage: data.input_tokens } : s
          ),
        }))
      }
      // 当前活动会话的 token 统计条：仅跟踪该 session 当前 run 的 usage，
      // 旧 run 的迟到 usage 不得覆盖新 run 的计数。
      if (data.session_id === get().activeSessionId && isCurrentTrackedRun(data)
        && typeof data.input_tokens === 'number' && typeof data.output_tokens === 'number') {
        set({ tokenUsage: { input: data.input_tokens, output: data.output_tokens, total: data.input_tokens + data.output_tokens } })
      }
    })

    bus.off('strategy.updated')
    bus.on('strategy.updated', (data: RunEvent) => {
      set(state => ({
        sessions: state.sessions.map(s =>
          s.id === data.session_id && data.strategy
            ? { ...s, current_strategy: normalizeStrategy(data.strategy) }
            : s
        ),
      }))
    })

    bus.off('sub_agent.started')
    bus.on('sub_agent.started', (data: { session_id: string; sub_session_id: string; target_character_id: string; task: string }) => {
      const state = get()
      if (state.sessions.find(s => s.id === data.sub_session_id)) return
      const parent = state.sessions.find(s => s.id === data.session_id)
      const child: Session = {
        id: data.sub_session_id,
        character_id: data.target_character_id,
        title: `Sub: ${data.task.slice(0, 60)}`,
        messages: [],
        model: parent?.model ?? null,
        provider_id: parent?.provider_id ?? null,
        workspace: parent?.workspace ?? null,
        workspaces: parent?.workspaces ?? null,
        parent_id: data.session_id,
        active_group: null,
        created_at: Date.now(),
        updated_at: Date.now(),
      }
      set(state => ({ sessions: [...state.sessions, child] }))
    })

    bus.off('session:new')
    bus.on('session:new', (data: { sessionId: string; title: string; isEvent: boolean }) => {
      const state = get()
      if (state.sessions.find(s => s.id === data.sessionId)) return
      const session: Session = {
        id: data.sessionId,
        character_id: '',
        title: data.title,
        messages: [],
        model: null,
        provider_id: null,
        workspace: null,
        workspaces: null,
        parent_id: null,
        active_group: null,
        session_type: 'event',
        created_at: Date.now(),
        updated_at: Date.now(),
      }
      set(state => ({ sessions: [...state.sessions, session] }))
    })

    bus.off('event:status_changed')
    bus.on('event:status_changed', (data: { eventId: string; status: string }) => {
      console.log('[event] status changed:', data.eventId, data.status)
    })

    bus.off('evolution:insight_created')
    bus.on('evolution:insight_created', (data: { session_id: string; insight_type: string; description: string; notify_enabled: boolean; notify_timeout: number }) => {
      if (data.notify_enabled === false) return
      set({ evolutionNotification: { session_id: data.session_id, insight_type: data.insight_type, description: data.description } })
      const state = get()
      if (state._notificationTimer) clearTimeout(state._notificationTimer)
      const timer = setTimeout(() => set({ evolutionNotification: null }), (data.notify_timeout || 2) * 1000)
      set({ _notificationTimer: timer })
    })

    bus.off('workspace.updated')
    bus.on('workspace.updated', (data: { session_id: string; workspaces: string[] }) => {
      set(state => ({
        sessions: state.sessions.map(s =>
          s.id === data.session_id ? { ...s, workspaces: JSON.stringify(data.workspaces) } : s
        ),
      }))
    })

    // ── 全局流式处理（唯一写路径）──
    // 每个事件按「run 身份」路由：仅当 run_id 匹配该 session 当前跟踪的运行
    // （sessionRuns[root].activeRunId）才写；旧 run 的迟到事件一律丢弃。
    // sendMessage 不再注册临时监听器，只在 sessionRuns 上同步声明 run 归属
    // （claim），全局处理即生效——不存在「临时 + 持久双处理」的可能，翻倍、
    // 污染类 bug 从结构上消除。
    bus.off('message.delta')
    bus.on('message.delta', (data: RunEvent) => {
      // 旧 run 的迟到 delta 不得混入新 run 的消息（否则新 run 的文本被前缀污染/翻倍）。
      if (!isCurrentTrackedRun(data)) return
      const state = get()
      const s = state.sessions.find(x => x.id === data.session_id)
      if (!s) return
      enqueueStreamDelta(data)
    })

    bus.off('message.metrics')
    bus.on('message.metrics', (data: RunEvent) => {
      
      // 终态事件：先把缓冲的最后一段流式文本落地，避免 is_streaming=false 后
      // 残留 delta 被当成"新消息"追加。
      flushStreamBuffers()
      // 旧 run 的 message.metrics 不得把新 run 还在流式的消息置为终态。
      if (!isCurrentTrackedRun(data)) return
      updateSessionMessage(data.session_id, sess => {
        let updated = false
        const messages = [...sess.messages]
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].role !== 'assistant') continue
          messages[i] = {
            ...messages[i],
            id: data.message_id != null ? String(data.message_id) : messages[i].id,
            token_speed: data.token_speed,
            token_speed_estimated: data.token_speed_estimated,
            is_streaming: false,
          }
          updated = true
          break
        }
        const cacheStats = data.cache ? { ...data.cache } : sess.cacheStats
        return updated || data.cache ? { ...sess, messages, cacheStats } : sess
      })
    })

    // A user answer to an ask_user prompt (or any server-persisted user turn)
    // surfaces here. Keyed by the real DB message_id so the live stream and a
    // reconnect replay converge on the same node — this is the authoritative
    // fix for "ask_user answer only appears after a refresh".
    bus.off('message.created')
    bus.on('message.created', (data: RunEvent) => {
      if (!data.session_id || data.message_id == null || data.role !== 'user') return
      updateSessionMessage(data.session_id, sess => {
        const next = applyMessageCreated(sess.messages, {
          message_id: data.message_id,
          content: data.content,
          occurred_at: data.occurred_at,
        })
        return next === sess.messages ? sess : { ...sess, messages: next }
      })
    })

    bus.off('tool.started')
    bus.on('tool.started', (data: RunEvent) => {
      
      // 旧 run 的 tool 事件不得注入到新 run 的会话里。
      if (!isCurrentTrackedRun(data)) return
      flushStreamBuffers()
      updateSessionMessage(data.session_id, sess => ({
        ...sess,
        messages: [...sess.messages, {
          id: uid(), role: 'tool' as const, content: '',
          tool_name: data.tool_name, tool_input: data.tool_input,
          tool_status: 'running' as const, timestamp: Date.now(),
          tool_call_id: data.tool_call_id,
        }],
      }))
    })

    bus.off('tool.completed')
    bus.on('tool.completed', (data: RunEvent) => {
      
      if (!isCurrentTrackedRun(data)) return
      flushStreamBuffers()
      updateSessionMessage(data.session_id, sess => ({
        ...sess,
        messages: sess.messages.map(m =>
          m.role === 'tool' && m.tool_call_id === data.tool_call_id
            ? { ...m, tool_status: (data.tool_status as Message['tool_status']) || 'success', tool_output: data.tool_output }
            : m
        ),
      }))
    })

    bus.off('tool.output')
    bus.on('tool.output', (data: RunEvent) => {
      
      if (!isCurrentTrackedRun(data)) return
      enqueueToolOutput(data)
    })

    bus.off('run.completed')
    bus.on('run.completed', (data: RunEvent) => {
      
      flushStreamBuffers()
      // 旧 run 的终态不得清除新 run 的流式状态（否则新 run 的 delta 被双写翻倍）。
      if (!isCurrentTrackedRun(data)) return
      updateSessionMessage(data.session_id, sess => {
        const messages = [...sess.messages]
        const last = messages[messages.length - 1]
        if (last?.is_streaming) messages[messages.length - 1] = { ...last, is_streaming: false }
        return { ...sess, messages, cacheStats: data.cache || sess.cacheStats }
      })
      handleTerminalForContinuation(data)
      settleAbort(data.session_id)
    })

    bus.off('run.max_turns')
    bus.on('run.max_turns', (data: RunEvent) => {
      
      flushStreamBuffers()
      if (!isCurrentTrackedRun(data)) return
      updateSessionMessage(data.session_id, sess => {
        const messages = [...sess.messages]
        const last = messages[messages.length - 1]
        if (last?.is_streaming) messages[messages.length - 1] = { ...last, is_streaming: false }
        return { ...sess, messages, cacheStats: data.cache || sess.cacheStats }
      })
      handleTerminalForContinuation(data)
      settleAbort(data.session_id)
    })

    bus.off('run.cancelled')
    bus.on('run.cancelled', (data: RunEvent) => {
      
      flushStreamBuffers()
      if (!isCurrentTrackedRun(data)) return
      updateSessionMessage(data.session_id, sess => {
        const messages = [...sess.messages]
        const last = messages[messages.length - 1]
        if (last?.is_streaming) messages[messages.length - 1] = { ...last, is_streaming: false }
        return { ...sess, messages }
      })
      handleTerminalForContinuation(data)
      settleAbort(data.session_id)
    })

    bus.off('run.limit_warning')
    bus.on('run.limit_warning', (data: RunEvent) => {
      if (data.session_id !== get().activeSessionId) return
      const prev = get().sessionRuns[data.session_id]?.activeRun
      updateSessionRun(data.session_id, {
        activeRun: {
          ...(prev ?? { ...IDLE_RUN }),
          phase: prev?.phase === 'idle' ? 'running' : (prev?.phase ?? 'idle'),
          limitWarning: undefined,
        },
      })
      set({ limitNotice: { text: '已接近本轮上限，正在优先收敛当前步骤', tone: 'warn' } })
    })

    bus.off('run.continuation_queued')
    bus.on('run.continuation_queued', (data: RunEvent) => {
      
      handleContinuationQueued(data)
    })

    bus.off('run.compacted')
    bus.on('run.compacted', (data: RunEvent) => {
      set(state => ({
        sessions: state.sessions.map(s =>
          s.id === data.session_id
            ? { ...s, compacted: true, compaction_summary: data.compaction_summary ?? s.compaction_summary }
            : s
        ),
      }))
      // Surface a divider in the conversation flow so the user can see where
      // the model stopped seeing earlier history (paired with the answer /
      // follow-up on either side).
      updateSessionMessage(data.session_id || '', sess => {
        const next = applyCompactMarker(sess.messages, {
          run_id: data.run_id,
          occurred_at: data.occurred_at,
          compaction_summary: data.compaction_summary,
        })
        return next === sess.messages ? sess : { ...sess, messages: next }
      })
    })

    bus.off('run.failed')
    bus.on('run.failed', (data: RunEvent) => {
      
      flushStreamBuffers()
      if (!isCurrentTrackedRun(data)) return
      updateSessionMessage(data.session_id, sess => ({
        ...sess,
        messages: [...sess.messages, {
          id: uid(), role: 'assistant' as const,
          content: `Error: ${data.error || 'Unknown'}`,
          timestamp: Date.now(),
        }],
      }))
      updateSessionRun(data.session_id, {
        activeRun: { ...IDLE_RUN },
        activeRunId: null,
        isStreaming: false,
      })
      settleAbort(data.session_id)
    })

    // Server-initiated interruption (stall watchdog / startup recovery): the
    // run will never produce more events, so reset the streaming state here —
    // without this a stalled run pinned the session in thinking/speaking
    // forever, even across client restarts.
    bus.off('run.interrupted')
    bus.on('run.interrupted', (data: RunEvent) => {
      
      // 旧 run 的 interrupted（如服务端停滞看门狗误伤已替换的 run）不得重置新 run。
      if (!isCurrentTrackedRun(data)) return
      const reasonText = data.reason === 'stalled' || data.reason === 'stalled_active'
        ? '运行停滞超时，已被服务端自动中断'
        : data.reason === 'orphaned_after_restart'
          ? '服务端重启，遗留的运行已中断'
          : '运行已中断'
      updateSessionMessage(data.session_id, sess => ({
        ...sess,
        messages: [...sess.messages, {
          id: uid(), role: 'assistant' as const,
          content: `[${reasonText}]`,
          timestamp: Date.now(),
        }],
      }))
      updateSessionRun(data.session_id, {
        activeRun: { ...IDLE_RUN },
        activeRunId: null,
        isStreaming: false,
      })
      settleAbort(data.session_id)
    })

    bus.off('run.started')
    bus.on('run.started', (data: RunEvent & { context_window?: number }) => {
      if (isAbortingSession(data.session_id)) return
      const prev = get().sessionRuns[resolveSessionRoot(data.session_id)]?.activeRun
      updateSessionRun(data.session_id, {
        activeRun: {
          runId: data.run_id || prev?.runId || null,
          continuationRootRunId: prev?.continuationRootRunId || null,
          phase: 'running',
          nextRunId: null,
          limitWarning: prev?.limitWarning ?? null,
        },
        activeRunId: data.run_id || undefined,
        isStreaming: true,
      })
      if (data.session_id === get().activeSessionId) {
        set({ tokenUsage: { input: 0, output: 0, total: 0 } })
      }
      if (data.context_window) {
        set(state => ({
          sessions: state.sessions.map(s =>
            s.id === data.session_id ? { ...s, context_window: data.context_window } : s
          ),
        }))
      }
    })

    bus.off('run.queued')
    bus.on('run.queued', (data: RunEvent) => {
      handleAutoSuccessorQueued(data)
    })

    bus.off('run.retrying')
    bus.on('run.retrying', (data: RunEvent) => {
      
      // 不在此处拦 isAbortingSession：停止后立刻发新消息时，会话仍处于 aborting
      // 窗口，但新 run 的首个 LLM 调用同样可能瞬时失败触达 retry——若在这里跳过
      // resetStreamingContent，attempt 1 已拼进消息的前缀就会与 attempt 2 的完整
      // 输出叠成重复文本（“你好” → “你好你好”）。旧 run 的迟到 retry 由
      // isCurrentTrackedRun 拦截，不会误清新 run 的内容。
      // 旧 run 的 retrying 不得清空新 run 已流式的内容（否则内容丢失/错位）。
      if (!isCurrentTrackedRun(data)) return
      // LLM 请求重试：服务端 attempt 1 的部分 delta 已拼进前端消息，attempt 2
      // 会完整重发，必须重置流式累积避免拼成重复文本。
      resetStreamingContent(data.session_id)
      updateSessionRun(data.session_id, { isStreaming: true })
    })

    // Approval prompts for sessions without a temporary listener (e.g. after
    // the page refreshed and resumeActiveRun is tracking the run).
    bus.off('approval.requested')
    bus.on('approval.requested', (data: RunEvent) => {
      
      if (!data.session_id || !data.tool_call_id) return
      const pending = pendingApprovalFromEvent(data)
      pendingApprovalBySession.set(data.session_id, pending)
      // Do not overlay an unrelated conversation. The desktop notification can
      // jump to this session; switchSession restores its pending dialog.
      if (data.session_id === get().activeSessionId) set({ pendingApproval: pending })
    })

    // ask_user prompts (persisted checkpoint; answered via /runs/:id/inputs).
    bus.off('ask_user')
    bus.on('ask_user', (data: RunEvent) => {
      if (!data.run_id || !data.question) return
      if (data.session_id && data.session_id !== get().activeSessionId) return
      set({
        pendingAskUser: {
          run_id: data.run_id,
          session_id: data.session_id || '',
          question: data.question,
        },
      })
      // Also surface the question in the conversation flow (paired with the
      // user's answer from message.created) so the Q&A is visible on refresh.
      updateSessionMessage(data.session_id || '', sess => {
        const next = applyAskUserQuestion(sess.messages, {
          run_id: data.run_id,
          question: data.question,
          occurred_at: data.occurred_at,
        })
        return next === sess.messages ? sess : { ...sess, messages: next }
      })
    })
  }

  // Initialize listeners on store creation
  initPersistentListeners()

  function updateSessionMessage(sessionId: string, updater: (session: Session) => Session) {
    set(state => ({
      sessions: state.sessions.map(s => s.id === sessionId ? updater(s) : s),
    }))
  }

  // ── Per-session live-run state (§14 multi-session) ──
  // Events arrive for whichever session is running, but the send/stop button
  // must reflect the ACTIVE session only. Every write goes through
  // `updateSessionRun`, which updates the per-session record and re-derives the
  // global `isStreaming` / `activeRun` / `_activeRunId` from the active session
  // (child sessions map to their parent so sub-agent runs share the flag).
  function resolveSessionRoot(sessionId: string): string {
    const s = get().sessions.find(x => x.id === sessionId)
    if (s?.parent_id) {
      const parent = get().sessions.find(x => x.id === s.parent_id)
      if (parent) return parent.id
    }
    return sessionId
  }

  function updateSessionRun(sessionId: string, patch: {
    isStreaming?: boolean
    activeRun?: ActiveRunState
    activeRunId?: string | null
  }): void {
    set(state => {
      const sid = resolveSessionRoot(sessionId)
      const prev = state.sessionRuns[sid] ?? { isStreaming: false, activeRun: { ...IDLE_RUN }, activeRunId: null }
      const sessionRuns = {
        ...state.sessionRuns,
        [sid]: {
          isStreaming: patch.isStreaming ?? prev.isStreaming,
          activeRun: patch.activeRun ?? prev.activeRun,
          activeRunId: patch.activeRunId !== undefined ? patch.activeRunId : prev.activeRunId,
        },
      }
      const active = sessionRuns[state.activeSessionId ?? ''] ?? { isStreaming: false, activeRun: { ...IDLE_RUN }, activeRunId: null }
      return {
        sessionRuns,
        isStreaming: active.isStreaming,
        activeRun: active.activeRun,
        _activeRunId: active.activeRunId,
      }
    })
  }

  // ── ActiveRunState coordination (§14) ──
  // Terminal event may carry `limit_summary.continuationScheduled` / `nextRunId`
  // (or `result.nextRunId`). When it does, the run is NOT done from the client's
  // perspective: keep the active phase in `continuation_pending` and follow the
  // successor via `run.continuation_queued` / the next `run.queued`.
  function handleTerminalForContinuation(data: RunEvent) {
    const sessionId = data.session_id
    const prev = get().sessionRuns[resolveSessionRoot(sessionId)]
    // Only the currently-tracked run's terminal may clear it (§14.3).
    if (!data.run_id || (prev?.activeRunId && data.run_id !== prev.activeRunId)) return

    const summary = data.limit_summary || data.result?.limitSummary
    const continuationScheduled = !!summary?.continuationScheduled
      || !!data.continuationScheduled
      || !!data.result?.continuationScheduled
      || !!data.next_run_id
      || !!data.result?.nextRunId
    const nextRunId = summary?.nextRunId || data.next_run_id || data.result?.nextRunId || null

    if (continuationScheduled && nextRunId) {
      updateSessionRun(sessionId, {
        activeRun: {
          runId: nextRunId,
          continuationRootRunId: prev?.activeRun.continuationRootRunId || data.run_id || null,
          phase: 'continuation_pending',
          nextRunId: nextRunId,
          limitWarning: summary || prev?.activeRun.limitWarning || null,
        },
        activeRunId: nextRunId,
        isStreaming: true,
      })
      if (sessionId === get().activeSessionId) setLimitNoticeFromSummary(summary, true)
      return
    }

    // No continuation: the run is truly finished.
    updateSessionRun(sessionId, {
      activeRun: { ...IDLE_RUN },
      activeRunId: null,
      isStreaming: false,
    })
    if (sessionId === get().activeSessionId) setLimitNoticeFromSummary(summary, false)
  }

  function setLimitNoticeFromSummary(summary: RunLimitSummary | undefined, continuing: boolean) {
    if (!summary) return
    let text: string
    if (continuing) text = `本轮已结束，正在继续剩余步骤`
    else text = REASON_LABELS[summary.reason] || '运行已停止'
    set({ limitNotice: { text, tone: summary.reason === 'absolute_limit' || summary.reason === 'continuation_limit' ? 'warn' : 'info' } })
    if (!continuing) {
      const timerRef = get()._notificationTimer
      if (timerRef) clearTimeout(timerRef)
      const timer = setTimeout(() => set({ limitNotice: null }), 8000)
      set({ _notificationTimer: timer })
    }  }

  // `run.continuation_queued` from the previous run: record the pending target.
  function handleContinuationQueued(data: RunEvent) {
    const sessionId = data.session_id
    if (isAbortingSession(sessionId)) return
    const prev = get().sessionRuns[resolveSessionRoot(sessionId)]
    if (!data.run_id || (prev?.activeRunId && data.run_id !== prev.activeRunId)) return
    if (!data.next_run_id) return
    const queuedRunId: string | null = prev?.activeRunId || data.run_id || null
    const queuedNextId: string | null = data.next_run_id
    updateSessionRun(sessionId, {
      activeRun: {
        ...(prev?.activeRun ?? { ...IDLE_RUN }),
        runId: queuedRunId,
        phase: 'continuation_pending',
        nextRunId: queuedNextId,
      },
      isStreaming: true,
    })
  }

  // A successor `run.queued` with trigger auto_limit takes over as the active run.
  function handleAutoSuccessorQueued(data: RunEvent) {
    const sessionId = data.session_id
    if (isAbortingSession(sessionId)) return
    if (data.trigger !== 'auto_limit' && data.trigger !== undefined) return
    const prev = get().sessionRuns[resolveSessionRoot(sessionId)]
    const pending = prev?.activeRun.nextRunId
    if (!data.run_id || !pending || data.run_id !== pending) return
    const successorId: string = data.run_id
    updateSessionRun(sessionId, {
      activeRun: {
        ...(prev?.activeRun ?? { ...IDLE_RUN }),
        runId: successorId,
        phase: 'running',
        nextRunId: null,
      },
      activeRunId: successorId,
      isStreaming: true,
    })
  }

  // Replay persisted RunEvents (from /api/runs/:id/events) into the session
  // message list. Mirrors the persistent stream handlers, but batch-applies
  // events in seq order instead of streaming.
  function applyRunEvents(sessionId: string, events: RunEvent[]) {
    const lastType = events.length > 0 ? events[events.length - 1].type : undefined
    const terminalEvent = [...events].reverse().find(e => TERMINAL_EVENT_TYPES.has(e.type || ''))
    const approvalIndex = events.map(e => e.type).lastIndexOf('approval.requested')
    const approvalCandidate = approvalIndex >= 0 ? events[approvalIndex] : undefined
    const approvalResolved = !!terminalEvent || (approvalCandidate
      ? events.slice(approvalIndex + 1).some(e =>
          e.type === 'message.delta' ||
          ((e.type === 'tool.output' || e.type === 'tool.completed') &&
            (!e.tool_call_id || e.tool_call_id === approvalCandidate.tool_call_id))
        )
      : false)
    const pendingApprovalEvent = approvalResolved ? undefined : approvalCandidate
    const askUserEvent = events.find(e => e.type === 'ask_user')
    updateSessionMessage(sessionId, sess => {
      let messages = [...sess.messages]
      let compacted = sess.compacted ?? false
      for (const e of events) {
        if (e.type === 'message.delta') {
          const last = messages[messages.length - 1]
          if (last?.role === 'assistant' && last.is_streaming) {
            messages[messages.length - 1] = {
              ...last,
              content: last.content + (e.delta || ''),
              reasoning: (last.reasoning || '') + (e.reasoning || ''),
            }
          } else {
            messages.push({
              id: uid(), role: 'assistant' as const,
              content: e.delta || '', reasoning: e.reasoning || '',
              is_streaming: true, timestamp: Date.now(),
            })
          }
        } else if (e.type === 'message.metrics') {
          for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role !== 'assistant') continue
            messages[i] = {
              ...messages[i],
              id: e.message_id != null ? String(e.message_id) : messages[i].id,
              is_streaming: false,
              token_speed: e.token_speed,
              token_speed_estimated: e.token_speed_estimated,
            }
            break
          }
        } else if (e.type === 'message.created') {
          if (e.role === 'user' && e.message_id != null) {
            const next = applyMessageCreated(messages, {
              message_id: e.message_id,
              content: e.content,
              occurred_at: e.occurred_at,
            })
            if (next !== messages) messages = next
          }
        } else if (e.type === 'tool.started') {
          messages.push({
            id: uid(), role: 'tool' as const, content: '',
            tool_name: e.tool_name, tool_input: e.tool_input,
            tool_status: 'running' as const, timestamp: Date.now(),
            tool_call_id: e.tool_call_id,
          })
        } else if (e.type === 'tool.completed') {
          const idx = messages.findIndex(m => m.role === 'tool' && m.tool_call_id === e.tool_call_id)
          if (idx >= 0) {
            messages[idx] = {
              ...messages[idx],
              tool_status: (e.tool_status as Message['tool_status']) || 'success',
              tool_output: e.tool_output,
            }
          }
        } else if (e.type === 'tool.output') {
          const idx = messages.findIndex(m => m.role === 'tool' && m.tool_call_id === e.tool_call_id)
          if (idx >= 0) {
            messages[idx] = {
              ...messages[idx],
              tool_output: (messages[idx].tool_output || '') + (e.output || ''),
            }
          }
        } else if (e.type === 'run.failed') {
          messages.push({
            id: uid(), role: 'assistant' as const,
            content: `Error: ${e.error || 'Unknown'}`,
            timestamp: Date.now(),
          })
        } else if (e.type === 'run.compacted') {
          const next = applyCompactMarker(messages, { run_id: e.run_id, occurred_at: e.occurred_at, compaction_summary: e.compaction_summary })
          if (next !== messages) messages = next
          compacted = true
        } else if (TERMINAL_EVENT_TYPES.has(e.type || '')) {
          const last = messages[messages.length - 1]
          if (last?.is_streaming) messages[messages.length - 1] = { ...last, is_streaming: false }
        }
      }
      return { ...sess, messages, compacted: compacted || sess.compacted }
    })
    if (pendingApprovalEvent?.tool_call_id) {
      const pending = pendingApprovalFromEvent({ ...pendingApprovalEvent, session_id: sessionId })
      pendingApprovalBySession.set(sessionId, pending)
      if (sessionId === get().activeSessionId) set({ pendingApproval: pending })
    } else if (approvalResolved) {
      clearPendingApproval(sessionId)
    }
    if (askUserEvent?.run_id && askUserEvent.question) {
      set({
        pendingAskUser: {
          run_id: askUserEvent.run_id,
          session_id: sessionId,
          question: askUserEvent.question,
        },
      })
      // Surface the question in the flow too (paired with the answer) so a
      // refresh/reconnect still shows the full Q&A pair.
      updateSessionMessage(sessionId, sess => {
        const next = applyAskUserQuestion(sess.messages, {
          run_id: askUserEvent.run_id,
          question: askUserEvent.question,
          occurred_at: askUserEvent.occurred_at,
        })
        return next === sess.messages ? sess : { ...sess, messages: next }
      })
    }
    if (lastType) {
      updateSessionRun(sessionId, { isStreaming: !TERMINAL_EVENT_TYPES.has(lastType) })
    }
    for (const event of events) {
      const motion = motionForRunEvent(event.type || '')
      if (motion) setSessionMotion(sessionId, motion, event.occurred_at ?? Date.now())
    }
  }

  return {
    // ── State ──
    sessions: [],
    activeSessionId: null,
    isStreaming: false,
    streamConnected: getEventBus().connected,
    isRefreshing: false,
    pendingApproval: null,
    pendingAskUser: null,
    activeRun: { ...IDLE_RUN },
    limitNotice: null,
    sessionRuns: {},
    sessionMotions: {},
    collapsedWorkspaces: new Set<string>(),
    toolExpandAll: false,
    isBatchMode: false,
    selectedSessionIds: new Set<string>(),
    tokenUsage: { input: 0, output: 0, total: 0 },
    evolutionNotification: null,
    attachments: [],
    _activeRunId: null,
    _notificationTimer: null,
    _loadingSessions: false,

    // ── Session Actions ──

    loadSessions: async () => {
      const state = get()
      if (state._loadingSessions) return
      set({ _loadingSessions: true })
      try {
        const [list, presences] = await Promise.all([
          sessionsApi.fetchSessions(),
          sessionsApi.fetchSessionPresences().catch(() => []),
        ])
        const currentSessions = get().sessions
        const sessions: Session[] = list.map(s => {
          // Preserve already-loaded messages and the live context usage
          const existing = currentSessions.find(x => x.id === s.id)
          return {
            ...s,
            current_strategy: normalizeStrategy(s.current_strategy),
            messages: existing?.messages || [],
            workspaces: s.workspaces ? JSON.parse(s.workspaces as string) : undefined,
            context_usage: existing?.context_usage ?? s.context_usage ?? undefined,
          }
        })
        // Load child sessions
        for (const s of sessions) {
          if (s.parent_id) continue
          try {
            const children = await sessionsApi.fetchChildSessions(s.id)
            for (const c of children) {
              if (!sessions.find(x => x.id === c.id)) {
                const existing = currentSessions.find(x => x.id === c.id)
                sessions.push({
                  ...c,
                  messages: existing?.messages || [],
                  workspaces: c.workspaces ? JSON.parse(c.workspaces as string) : undefined,
                })
              }
            }
          } catch { /* ignore */ }
        }
        set({ sessions })
        for (const presence of presences) {
          setSessionMotion(presence.sessionId, presence.motion, presence.since)
        }
      } catch { /* ignore */ }
      set({ _loadingSessions: false })
    },

    createSession: async (opts = {}) => {
      const defs = loadPersistedDefaults()
      const providersStore = useProvidersStore.getState()
      const characterId = opts.character_id || defs.character_id || 'general'

      let currentStrategy: Strategy | undefined
      if (opts.session_type === 'event') {
        currentStrategy = 'Auto Approve'
      } else {
        // Try to get default approval mode from character (if loaded)
        // For now, default to Ask Risky
        currentStrategy = 'Ask Risky'
      }

      const session: Session = {
        id: uid(),
        character_id: characterId,
        title: opts.title || '',
        model: opts.model || defs.model || null,
        provider_id: opts.provider_id || defs.provider_id || (providersStore.providers[0]?.id) || null,
        workspace: opts.workspace || defs.defaultWorkspace || null,
        workspaces: opts.workspaces ? JSON.stringify(opts.workspaces) : (opts.workspace || defs.defaultWorkspace) ? JSON.stringify([opts.workspace || defs.defaultWorkspace]) : null,
        parent_id: opts.parent_id || null,
        active_group: opts.active_group || null,
        session_type: opts.session_type,
        event_id: opts.event_id,
        current_strategy: currentStrategy,
        messages: [],
        created_at: Date.now(),
        updated_at: Date.now(),
      }

      set(state => ({ sessions: [session, ...state.sessions] }))

      try {
        await sessionsApi.createSession({
          id: session.id,
          character_id: session.character_id,
          title: session.title,
          model: session.model,
          provider_id: session.provider_id,
          workspace: session.workspace,
          workspaces: session.workspaces,
          parent_id: session.parent_id,
          active_group: session.active_group,
          session_type: session.session_type,
          event_id: session.event_id,
          current_strategy: session.current_strategy,
        })
      } catch { /* will be created on first message */ }

      // Persist defaults
      savePersistedDefaults({
        character_id: session.character_id,
        provider_id: session.provider_id ?? undefined,
        model: session.model ?? undefined,
        workspace: session.workspace ?? undefined,
      })

      return session
    },

    switchSession: async (id: string) => {
      const state = get()
      // 单一写路径：没有临时监听器需要清理，切会话只改 activeSessionId
      // 与派生状态即可；各 session 的流式跟踪记录（sessionRuns）保持不动，
      // 后台会话继续由全局处理写入。

      // Derive the button/phase from the TARGET session's own record so the
      // previous session's running state never leaks into the view (§14.7).
      set(s => {
        const rec = s.sessionRuns[id] ?? { isStreaming: false, activeRun: { ...IDLE_RUN }, activeRunId: null }
        return {
          activeSessionId: id,
          pendingApproval: pendingApprovalBySession.get(id) ?? null,
          isStreaming: rec.isStreaming,
          activeRun: rec.activeRun,
          _activeRunId: rec.activeRunId,
        }
      })
      savePersistedDefaults({ activeSessionId: id })

      const session = get().sessions.find(s => s.id === id)
      if (!session) {
        // No local record (e.g. created elsewhere): let resume handle it.
        get().resumeActiveRun(id)
        return
      }

      // Don't clobber a session that is actively streaming in this window —
      // its live output is being written by the global handler, and a snapshot
      // would truncate the in-flight tail.
      const tracked = get().sessionRuns[resolveSessionRoot(id)]
      const streamingLive = tracked?.isStreaming || tracked?.activeRun?.phase === 'running'

      let needLoad = session.messages.length === 0
      if (!needLoad && !streamingLive) {
        // Already loaded: silently re-pull only if the server has newer content
        // (updated_at bumped by a persisted message / compaction while we were
        // away). Fixes the "switch back still shows stale data" trap.
        try {
          const fresh = await sessionsApi.fetchSessions()
          const server = fresh.find(s => s.id === id)
          if (server && server.updated_at > (session.updated_at ?? 0)) needLoad = true
        } catch { /* keep local */ }
      }

      if (needLoad) {
        try {
          const data = await sessionsApi.fetchSessionMessages(id)
          const messages: Message[] = data.messages.map(toMessage)
          set(state => ({
            sessions: state.sessions.map(s =>
              s.id === id
                ? { ...s, messages, updated_at: data.session.updated_at ?? s.updated_at }
                : s,
            ),
          }))
        } catch { /* keep local */ }
      }
      // Resume a run that was in flight when this view was last open.
      get().resumeActiveRun(id)
    },

    refreshSession: async (requestedId?: string) => {
      const sessionId = requestedId || get().activeSessionId
      if (!sessionId || get().isRefreshing) return
      set({ isRefreshing: true })
      try {
        // Rebuild from the server's authoritative messages, then replay the
        // current run from sequence zero to recover any unpersisted-looking
        // partial output that was actually stored as run events.
        // (单一写路径：无临时监听器可清理；运行中会话的流式状态保留在
        // sessionRuns，由全局处理继续写。) 
        getEventBus()

        // Refreshing a chat also refreshes the tree: a running parent may have
        // created child sessions while the renderer was disconnected.
        await get().loadSessions()
        const data = await sessionsApi.fetchSessionMessages(sessionId)
        const previousRunId = get().sessionRuns[resolveSessionRoot(sessionId)]?.activeRunId
        if (previousRunId) runSeqByRunId.delete(previousRunId)
        const messages: Message[] = data.messages.map(toMessage)
        set(state => {
          // 单一写路径：该 run 正在本窗口实时流式写入（全局处理累积文本）。
          // 服务端快照可能比游标晚一拍，用它覆盖 messages 会截断进行中的
          // 流式尾巴（稳妥的做法是只刷新元数据，内容交给全局写路径）。
          const tracked = state.sessionRuns[resolveSessionRoot(sessionId)]
          const streamingLive = tracked?.isStreaming || tracked?.activeRun?.phase === 'running'
          return {
            sessions: state.sessions.map(session =>
              session.id === sessionId
                ? {
                    ...session,
                    ...data.session,
                    current_strategy: normalizeStrategy(data.session.current_strategy),
                    workspaces: data.session.workspaces
                      ? JSON.parse(data.session.workspaces as string)
                      : undefined,
                    ...(streamingLive ? {} : { messages }),
                  }
                : session
            ),
          }
        })
        await get().resumeActiveRun(sessionId)
      } finally {
        set({ isRefreshing: false })
      }
    },

    renameSession: async (id: string, title: string) => {
      set(state => ({
        sessions: state.sessions.map(s =>
          s.id === id ? { ...s, title } : s
        ),
      }))
      try { await sessionsApi.renameSession(id, title) } catch { /* ignore */ }
    },

    deleteSession: async (id: string) => {
      const state = get()
      // Delete children too
      const children = state.sessions.filter(s => s.parent_id === id)
      const childIds = children.map(c => c.id)

      set(state => ({
        sessions: state.sessions.filter(s => s.id !== id && s.parent_id !== id),
        activeSessionId: state.activeSessionId === id ? null : state.activeSessionId,
      }))

      try { await sessionsApi.deleteSession(id) } catch { /* ignore */ }
      for (const cid of childIds) {
        try { await sessionsApi.deleteSession(cid) } catch { /* ignore */ }
      }
    },

    resetToMessage: async (sessionId: string, messageId: string) => {
      const state = get()
      const session = state.sessions.find(s => s.id === sessionId)
      if (!session) return
      const idx = session.messages.findIndex(m => m.id === messageId)
      if (idx < 0) return

      set(state => ({
        sessions: state.sessions.map(s =>
          s.id === sessionId
            ? { ...s, messages: s.messages.slice(0, idx + 1) }
            : s
        ),
      }))

      try { await sessionsApi.keepMessages(sessionId, idx + 1) } catch { /* best-effort */ }
    },

    toggleSessionStar: (id: string) => {
      set(state => ({
        sessions: state.sessions.map(s =>
          s.id === id ? { ...s, pinned: !s.pinned } : s
        ),
      }))
    },

    // ── Message Actions ──

    editMessage: async (messageId: string, content: string) => {
      const nextContent = content.trim()
      if (!nextContent) return
      const state = get()
      if (state.isStreaming) throw new Error('请先停止当前运行')
      const session = state.sessions.find(s => s.id === state.activeSessionId)
      if (!session) throw new Error('当前会话不存在')
      const index = session.messages.findIndex(message => message.id === messageId)
      if (index < 0 || session.messages[index].role !== 'user') throw new Error('只能编辑用户消息')

      if (!/^\d+$/.test(messageId)) throw new Error('消息尚未完成持久化，请稍后重试')
      const revision = await sessionsApi.reviseMessage(Number(messageId), nextContent)
      set(current => ({
        sessions: current.sessions.map(item =>
          item.id === session.id ? { ...item, messages: item.messages.slice(0, index) } : item
        ),
        attachments: [],
      }))
      pendingSupersedesMessageId = revision.supersedes_message_id
      try {
        await get().sendMessage(nextContent)
      } finally {
        pendingSupersedesMessageId = null
      }
    },

    forkFromMessage: async (messageId: string) => {
      const state = get()
      const source = state.sessions.find(s => s.id === state.activeSessionId)
      if (!source) throw new Error('当前会话不存在')
      const index = source.messages.findIndex(message => message.id === messageId)
      if (index < 0 || source.messages[index].role !== 'assistant') throw new Error('只能从 Agent 消息创建分支')
      if (source.messages[index].is_streaming) throw new Error('请等待 Agent 回复完成')

      const numericMessageId = /^\d+$/.test(messageId) ? Number(messageId) : undefined
      const result = await sessionsApi.forkSession(source.id, {
        id: uid(),
        message_id: numericMessageId,
        message_count: index + 1,
      })
      const forked: Session = {
        ...result.session,
        workspaces: result.session.workspaces
          ? JSON.parse(result.session.workspaces as string)
          : undefined,
        messages: result.messages.map(toMessage),
      }
      set(current => ({
        sessions: [forked, ...current.sessions.filter(item => item.id !== forked.id)],
        activeSessionId: forked.id,
        isStreaming: false,
      }))
      updateSessionRun(forked.id, {
        activeRun: { ...IDLE_RUN },
        activeRunId: null,
        isStreaming: false,
      })
      savePersistedDefaults({ activeSessionId: forked.id })
      return forked
    },

    sendMessage: async (input: string) => {
      const state = get()
      // 单一写路径：无临时监听器可清理。多次发送只做「run 归属声明平移」，
      // 旧 run 的事件由 isCurrentTrackedRun 按 run_id 拦截，结构上不会双写。

      let session = state.sessions.find(s => s.id === state.activeSessionId)

      if (!session) {
        session = await get().createSession()
        set({ activeSessionId: session.id })
      }

      // ── 发送即"显式新意图"：立即离开任何残留的停止窗口，并清掉本会话残留的
      // 流式缓冲。等价于"发送时触发一次轻量刷新"（用户实测刷新后不再翻倍），
      // 但不做整体刷新、不重放 run 事件，只重置状态前置条件。旧 run 的迟到事件
      // 由 isCurrentTrackedRun 拦截，不会误伤新 run。
      if (abortingSessionId !== null) {
        if (abortTimer) { clearTimeout(abortTimer); abortTimer = null }
        abortingSessionId = null
      }
      for (const key of pendingStreamDeltas.keys()) {
        if (pendingStreamDeltas.get(key)?.sessionId === session!.id) pendingStreamDeltas.delete(key)
      }
      for (const key of pendingToolOutputs.keys()) {
        if (pendingToolOutputs.get(key)?.sessionId === session!.id) pendingToolOutputs.delete(key)
      }

      // Attachments
      const attachPayload = state.attachments.length > 0
        ? state.attachments.map(a => ({ name: a.name, mime: a.mime, data: a.data, dataUrl: a.dataUrl }))
        : undefined

      const userMsg: Message = {
        id: uid(),
        role: 'user',
        content: input,
        timestamp: Date.now(),
        attachments: attachPayload?.map(a => ({ name: a.name, mime: a.mime, dataUrl: a.dataUrl })),
      }

      set(state => ({
        sessions: state.sessions.map(s =>
          s.id === session!.id
            ? { ...s, messages: [...s.messages, userMsg], updated_at: Date.now() }
            : s
        ),
        attachments: [],
        tokenUsage: { input: 0, output: 0, total: 0 },
      }))
      updateSessionRun(session!.id, { isStreaming: true })

      // Generate a semantic title from the first message without delaying the Run.
      if (!session.title && input.trim()) {
        set(state => ({
          sessions: state.sessions.map(s =>
            s.id === session!.id ? { ...s, title: '生成标题中…' } : s
          ),
        }))
        sessionsApi.generateSessionTitle(session.id, input)
          .then(({ title, applied }) => {
            if (!applied) return
            set(state => ({
              sessions: state.sessions.map(s =>
                s.id === session!.id && s.title === '生成标题中…' ? { ...s, title } : s
              ),
            }))
          })
          .catch(() => {
            set(state => ({
              sessions: state.sessions.map(s =>
                s.id === session!.id && s.title === '生成标题中…' ? { ...s, title: '' } : s
              ),
            }))
          })
      }

      // Ensure provider
      if (!session.provider_id) {
        const providersStore = useProvidersStore.getState()
        if (providersStore.providers.length > 0) {
          const providerId = providersStore.providers[0].id
          set(state => ({
            sessions: state.sessions.map(s =>
              s.id === session!.id ? { ...s, provider_id: providerId } : s
            ),
          }))
          session = { ...session, provider_id: providerId }
        }
      }

      const bus = getEventBus()
      const runId = `run_${session.id}_${uid()}`
      const workspaces = session.workspaces
        ? (typeof session.workspaces === 'string' ? JSON.parse(session.workspaces) : session.workspaces)
        : undefined

      // 先声明 run 归属再上行：全局写路径即刻生效，任何同步/最早到达的事件
      // 都不会丢在「已发出 chat-run、尚未认领」的空窗里。
      updateSessionRun(session!.id, { activeRunId: runId, isStreaming: true })

      bus.emit('chat-run', {
        session_id: session.id,
        run_id: runId,
        character_id: session.character_id,
        input,
        attachments: attachPayload,
        model: session.model || undefined,
        provider_id: session.provider_id || undefined,
        workspace: session.workspace || undefined,
        workspaces: workspaces || undefined,
        active_group: session.active_group || undefined,
        session_type: session.session_type || undefined,
        event_id: session.event_id || undefined,
        thinking: !!session.thinking || !!session.reasoning_effort || undefined,
        reasoning_effort: session.reasoning_effort || undefined,
        supersedes_message_id: pendingSupersedesMessageId,
      }, (resp: unknown) => {
        const response = resp as { user_message_id?: number } | null
        if (response?.user_message_id == null) return
        set(current => ({
          sessions: current.sessions.map(item =>
            item.id === session!.id
              ? {
                ...item,
                messages: item.messages.map(message =>
                  message.id === userMsg.id ? { ...message, id: String(response.user_message_id) } : message
                ),
              }
              : item
          ),
        }))
      })
    },

    updateSessionMessage,

    resumeActiveRun: async (sessionId: string) => {
      // A live run is already being tracked (claim exists in sessionRuns):
      // its events are being written by the global handler, don't re-fetch.
      const tracked = get().sessionRuns[resolveSessionRoot(sessionId)]?.activeRunId
      if (tracked) return
      let runs: import('@/api/runs').RunRow[]
      try {
        runs = await fetchRecentRuns(sessionId, 5)
      } catch {
        return
      }
      const active = runs.find(r => !TERMINAL_RUN_STATUS.has(r.status))
      if (!active) {
        // No live run for this session — but the newest terminal run may point
        // to a queued successor (auto continuation awaiting execution after a
        // reconnect, §14.6).
        const newest = runs[0]
        if (newest?.result) {
          try {
            const result = JSON.parse(newest.result) as RunResultShape
            if (result.continuationScheduled && result.nextRunId) {
              const next = runs.find(r => r.id === result.nextRunId)
              if (next && !TERMINAL_RUN_STATUS.has(next.status)) {
                updateSessionRun(sessionId, {
                  activeRun: {
                    runId: next.id,
                    continuationRootRunId: next.continuation_root_run_id || newest.id,
                    phase: next.status === 'queued' ? 'continuation_pending' : 'running',
                    nextRunId: null,
                    limitWarning: result.limitSummary || null,
                  },
                  activeRunId: next.id,
                  isStreaming: true,
                })
                return
              }
            }
          } catch { /* ignore */ }
        }
        updateSessionRun(sessionId, {
          activeRun: { ...IDLE_RUN },
          activeRunId: null,
          isStreaming: false,
        })
        return
      }

      const afterSeq = runSeqByRunId.get(active.id) || 0
      let events: RunEvent[] = []
      let after = afterSeq
      try {
        // The events API caps each batch at 1000 rows; a long run with many
        // stream deltas can exceed that, so keep pulling until the batch is
        // empty (otherwise each resume only recovers one slice).
        for (let i = 0; i < 100; i++) {
          const batch = await fetchRunEvents(active.id, after)
          if (batch.length === 0) break
          events = events.concat(batch)
          after = batch[batch.length - 1].seq ?? after
          if (TERMINAL_EVENT_TYPES.has(batch[batch.length - 1].type || '')) break
        }
      } catch {
        return
      }
      if (events.length > 0) {
        applyRunEvents(sessionId, events)
        runSeqByRunId.set(active.id, after)
        if (TERMINAL_EVENT_TYPES.has(events[events.length - 1].type || '')) return
      }
      // Re-check once: the run may have finished between the two fetches.
      let tail: RunEvent[] = []
      try {
        tail = await fetchRunEvents(active.id, runSeqByRunId.get(active.id) || 0)
      } catch { /* keep last seq */ }
      if (tail.length > 0) {
        applyRunEvents(sessionId, tail)
        runSeqByRunId.set(active.id, tail[tail.length - 1].seq ?? (runSeqByRunId.get(active.id) || 0))
        if (TERMINAL_EVENT_TYPES.has(tail[tail.length - 1].type || '')) return
      }
      // A parked run is waiting for the user (approval/input/pause), not
      // streaming. Show idle so the stop button is not stuck "working".
      if (PARKED_RUN_STATUS.has(active.status)) {
        updateSessionRun(sessionId, {
          activeRun: { runId: active.id, continuationRootRunId: active.continuation_root_run_id || active.id, phase: 'parked', nextRunId: null, limitWarning: null },
          activeRunId: active.id,
          isStreaming: false,
        })
        return
      }
      // Live streaming continues through the persistent listeners.
      updateSessionRun(sessionId, {
        activeRun: { runId: active.id, continuationRootRunId: active.continuation_root_run_id || active.id, phase: 'running', nextRunId: null, limitWarning: null },
        activeRunId: active.id,
        isStreaming: true,
      })
    },

    abortRun: () => {
      const bus = getEventBus()
      const state = get()
      const sessionId = state.activeSessionId
      const record = sessionId ? state.sessionRuns[resolveSessionRoot(sessionId)] : null
      const runId = record?.activeRunId ?? record?.activeRun.runId ?? state._activeRunId
      if (!sessionId && !runId) return

      // Keep the stop/stopping affordance visible until the server confirms a
      // terminal event, instead of optimistically flipping back to send — the
      // old behavior made the button reappear on the next stream event and
      // feel like the click "didn't take" (needing many clicks).
      abortingSessionId = sessionId ?? abortingSessionId
      if (abortTimer) clearTimeout(abortTimer)
      if (sessionId) {
        const prev = record?.activeRun ?? { ...IDLE_RUN }
        updateSessionRun(sessionId, {
          activeRun: {
            ...prev,
            runId: prev.runId ?? runId ?? null,
            phase: 'cancelling',
            nextRunId: null,
          },
          activeRunId: prev.runId ?? runId ?? null,
          isStreaming: true,
        })
      } else {
        set({ activeRun: { ...IDLE_RUN, phase: 'cancelling' }, _activeRunId: null, isStreaming: true })
      }

      const cancelViaHttp = () => {
        if (runId) void cancelRun(runId, true).catch(() => {})
      }
      if (bus.connected && sessionId) {
        // Primary path: stream abort, acked by the server. If the ack is
        // missing/bad (stream raced a reconnect), fall back to HTTP cancel.
        bus.emit('abort', { session_id: sessionId }, (resp: unknown) => {
          const ok = typeof resp === 'object' && resp !== null
            && (resp as { status?: string }).status === 'ok'
          if (!ok) cancelViaHttp()
        })
        setTimeout(() => {
          // Ack never arrived (emit lost / server restarting): cancel via HTTP.
          if (abortingSessionId === sessionId) cancelViaHttp()
        }, 1500)
      } else {
        // Whole-chain cancel: auto continuations under the same root are stopped
        // too (§11.1).
        cancelViaHttp()
      }

      // Safety net: if no terminal event lands (server process died mid-abort),
      // force the stopping state to clear so the UI never sticks.
      abortTimer = setTimeout(() => {
        const sid = abortingSessionId
        abortingSessionId = null
        if (sid) {
          // 只清理仍跟踪被中止 run 的会话：用户可能已立刻发了新消息（新 run 正在
          // 流式），此时清空 activeRunId 会让新 run 的每个 delta 被双写翻倍。
          const tracked = get().sessionRuns[resolveSessionRoot(sid)]?.activeRunId
          if (!tracked || tracked === runId) {
            updateSessionRun(sid, {
              activeRun: { ...IDLE_RUN },
              activeRunId: null,
              isStreaming: false,
            })
          }
          // tracked 已指向更新的 run：保留其流式状态，交给它自己的终态事件收尾。
        } else {
          set({ activeRun: { ...IDLE_RUN }, _activeRunId: null, isStreaming: false })
        }
      }, 10_000)
    },

    setActiveRunPhase: (phase, patch = {}) => {
      const sid = get().activeSessionId
      if (sid) {
        const prev = get().sessionRuns[sid]?.activeRun ?? { ...IDLE_RUN }
        updateSessionRun(sid, {
          activeRun: { ...prev, ...patch, phase },
          isStreaming: phase === 'running' || phase === 'continuation_pending',
        })
      }
    },

    clearLimitNotice: () => set({ limitNotice: null }),

    setStrategy: (strategy: Strategy) => {
      const bus = getEventBus()
      const state = get()
      if (bus.connected && state.activeSessionId) {
        bus.emit('strategy.set', { session_id: state.activeSessionId, strategy })
      }
      // Update local state
      set(state => ({
        sessions: state.sessions.map(s =>
          s.id === state.activeSessionId ? { ...s, current_strategy: strategy } : s
        ),
      }))
    },

    respondApproval: (choice) => {
      const bus = getEventBus()
      const state = get()
      if (bus.connected && state.pendingApproval) {
        bus.emit('approval.respond', {
          session_id: state.pendingApproval.session_id,
          tool_call_id: state.pendingApproval.tool_call_id,
          choice,
        })
      }
      if (state.pendingApproval) pendingApprovalBySession.delete(state.pendingApproval.session_id)
      set({ pendingApproval: null })
    },

    clearAskUser: () => set({ pendingAskUser: null }),

    // ── Attachment Actions ──

    addAttachment: (name, mime, data, dataUrl) => {
      set(state => ({
        attachments: [...state.attachments, { name, mime, data, dataUrl }],
      }))
    },

    removeAttachment: (idx) => {
      set(state => ({
        attachments: state.attachments.filter((_, i) => i !== idx),
      }))
    },

    clearAttachments: () => set({ attachments: [] }),

    // ── Workspace Actions ──

    addWorkspace: (path: string) => {
      const state = get()
      const session = state.sessions.find(s => s.id === state.activeSessionId)
      if (!session) return

      let workspaces: string[] = session.workspaces
        ? (typeof session.workspaces === 'string' ? JSON.parse(session.workspaces) : session.workspaces)
        : [session.workspace || path]

      if (!workspaces.includes(path)) {
        workspaces.push(path)
        const wsStr = JSON.stringify(workspaces)
        set(state => ({
          sessions: state.sessions.map(s =>
            s.id === state.activeSessionId ? { ...s, workspaces: wsStr } : s
          ),
        }))
        sessionsApi.updateSession(session.id, {
          workspace: session.workspace || path,
          workspaces: wsStr,
        }).catch(() => {})
      }
    },

    removeWorkspace: (path: string) => {
      const state = get()
      const session = state.sessions.find(s => s.id === state.activeSessionId)
      if (!session || !session.workspaces) return
      if (path === session.workspace) return // Cannot remove default

      let workspaces: string[] = typeof session.workspaces === 'string'
        ? JSON.parse(session.workspaces) : session.workspaces

      workspaces = workspaces.filter(w => w !== path)
      const wsStr = workspaces.length > 0 ? JSON.stringify(workspaces) : null

      set(state => ({
        sessions: state.sessions.map(s =>
          s.id === state.activeSessionId ? { ...s, workspaces: wsStr } : s
        ),
      }))

      sessionsApi.updateSession(session.id, { workspaces: wsStr }).catch(() => {})
    },

    toggleWorkspaceCollapse: (workspace) => {
      set(state => {
        const collapsed = new Set(state.collapsedWorkspaces)
        if (collapsed.has(workspace)) collapsed.delete(workspace)
        else collapsed.add(workspace)
        return { collapsedWorkspaces: collapsed }
      })
    },

    // ── Batch Actions ──

    toggleBatchMode: () => {
      set(state => ({
        isBatchMode: !state.isBatchMode,
        selectedSessionIds: state.isBatchMode ? new Set() : state.selectedSessionIds,
      }))
    },

    toggleSessionSelection: (sessionId) => {
      set(state => {
        const selected = new Set(state.selectedSessionIds)
        if (selected.has(sessionId)) selected.delete(sessionId)
        else selected.add(sessionId)
        return { selectedSessionIds: selected }
      })
    },

    selectAllSessions: () => {
      set(state => {
        if (state.selectedSessionIds.size === state.sessions.length) {
          return { selectedSessionIds: new Set() }
        }
        return { selectedSessionIds: new Set(state.sessions.map(s => s.id)) }
      })
    },

    batchDeleteSessions: async () => {
      const state = get()
      const ids = Array.from(state.selectedSessionIds)
      const allIds = new Set<string>(ids)

      // Include children
      for (const id of ids) {
        state.sessions.filter(s => s.parent_id === id).forEach(c => allIds.add(c.id))
      }

      const idArray = Array.from(allIds)
      await Promise.all(idArray.map(id => sessionsApi.deleteSession(id).catch(() => {})))

      set(state => ({
        sessions: state.sessions.filter(s => !allIds.has(s.id)),
        activeSessionId: allIds.has(state.activeSessionId || '') ? null : state.activeSessionId,
        selectedSessionIds: new Set(),
        isBatchMode: false,
      }))
    },

    deleteProject: async (workspace: string) => {
      const state = get()
      const ids = state.sessions
        .filter(s => !s.parent_id && (s.workspace || 'default') === workspace)
        .map(s => s.id)
      const removed = new Set<string>(ids)
      // Children follow their parents
      for (const s of state.sessions) {
        if (s.parent_id && removed.has(s.parent_id)) removed.add(s.id)
      }
      await Promise.all(ids.map(id => sessionsApi.deleteSession(id).catch(() => {})))
      set(state => ({
        sessions: state.sessions.filter(s => !removed.has(s.id)),
        activeSessionId: removed.has(state.activeSessionId || '') ? null : state.activeSessionId,
      }))
    },

    // ── UI Actions ──

    toggleAllTools: () => set(state => ({ toolExpandAll: !state.toolExpandAll })),

    clearEvolutionNotification: () => set({ evolutionNotification: null }),
  }
})
