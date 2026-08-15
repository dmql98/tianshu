import { create } from 'zustand'
import { normalizeStrategy, type Session, type Message, type RunEvent, type RunLimitSummary, REASON_LABELS, type Strategy, type WorkspaceGroup } from '@/types'
import * as sessionsApi from '@/api/sessions'
import { fetchRecentRuns, fetchRunEvents, cancelRun, type RunResultShape } from '@/api/runs'
import { connectSocket, getSocket } from '@/api/socket'
import { useProvidersStore } from './providersStore'


const PERSIST_KEY = 'tianshu-chat-defaults'
const DEFAULT_WORKSPACE = 'C:\\.Tianshu'

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

interface PendingApproval {
  tool_call_id: string
  tool_name: string
  description: string
  approval_kind?: 'workspace' | 'risk'
  permission_root?: string
}

function pendingApprovalFromEvent(data: RunEvent): PendingApproval {
  return {
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

function loadPersistedDefaults(): Record<string, string | undefined> {
  try {
    const raw = localStorage.getItem(PERSIST_KEY)
    if (!raw) return { defaultWorkspace: DEFAULT_WORKSPACE }
    const parsed = JSON.parse(raw)
    if (!parsed.defaultWorkspace) parsed.defaultWorkspace = DEFAULT_WORKSPACE
    return parsed
  } catch {
    return { defaultWorkspace: DEFAULT_WORKSPACE }
  }
}

function savePersistedDefaults(data: Record<string, string | undefined>) {
  const existing = loadPersistedDefaults()
  localStorage.setItem(PERSIST_KEY, JSON.stringify({ ...existing, ...data }))
}

// ── Store ──

export type ActiveRunPhase = 'idle' | 'running' | 'continuation_pending' | 'parked'

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
  pendingApproval: PendingApproval | null
  pendingAskUser: { run_id: string; session_id: string; question: string } | null

  // Cross-run active state (RUN_LIMIT_POLICY_PLAN §14)
  activeRun: ActiveRunState
  limitNotice: { text: string; tone?: 'warn' | 'info' } | null

  // Per-session live-run state (source of truth; globals above are derived).
  sessionRuns: Record<string, SessionRunRecord>

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
  _currentCleanup: (() => void) | null
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
  renameSession: (id: string, title: string) => Promise<void>
  deleteSession: (id: string) => Promise<void>
  resetToMessage: (sessionId: string, messageId: string) => Promise<void>
  toggleSessionStar: (id: string) => void

  // Messages
  sendMessage: (input: string) => Promise<void>
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
  // ── Persistent socket listeners (registered once) ──
  function initPersistentListeners() {
    const socket = connectSocket()

    // Track the highest seq seen per run so reconnects can resume replay.
    const TRACKED_EVENTS = [
      'run.queued', 'run.started', 'run.retrying', 'run.completed', 'run.failed',
      'run.interrupted', 'run.max_turns', 'run.limit_warning', 'run.grace_started',
      'run.continuation_queued', 'message.delta', 'message.metrics',
      'tool.started', 'tool.completed', 'tool.output', 'approval.requested', 'usage',
      'ask_user',
    ]
    for (const type of TRACKED_EVENTS) {
      socket.on(type, (data: RunEvent) => {
        if (data.run_id && typeof data.seq === 'number') {
          const prev = runSeqByRunId.get(data.run_id) || 0
          if (data.seq > prev) runSeqByRunId.set(data.run_id, data.seq)
        }
      })
    }

    // After a socket reconnect, replay anything the active run emitted while away.
    socket.off('connect')
    socket.on('connect', () => {
      const state = get()
      const runId = state._activeRunId
      const sessionId = state.activeSessionId
      if (!runId || !sessionId) return
      const afterSeq = runSeqByRunId.get(runId) || 0
      fetchRunEvents(runId, afterSeq)
        .then(events => {
          if (events.length === 0) return
          applyRunEvents(sessionId, events)
          runSeqByRunId.set(runId, events[events.length - 1].seq ?? afterSeq)
        })
        .catch(() => {})
    })

    // Live context usage — every LLM call reports the real prompt size, so the
    // context progress bar tracks actual tokens instead of a character estimate.
    socket.off('usage')
    socket.on('usage', (data: { session_id: string; input_tokens: number }) => {
      if (!data.session_id || typeof data.input_tokens !== 'number') return
      set(state => ({
        sessions: state.sessions.map(s =>
          s.id === data.session_id ? { ...s, context_usage: data.input_tokens } : s
        ),
      }))
    })

    socket.off('strategy.updated')
    socket.on('strategy.updated', (data: RunEvent) => {
      set(state => ({
        sessions: state.sessions.map(s =>
          s.id === data.session_id && data.strategy
            ? { ...s, current_strategy: normalizeStrategy(data.strategy) }
            : s
        ),
      }))
    })

    socket.off('sub_agent.started')
    socket.on('sub_agent.started', (data: { session_id: string; sub_session_id: string; target_character_id: string; task: string }) => {
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
        dataspace: parent?.dataspace ?? null,
        parent_id: data.session_id,
        active_group: null,
        created_at: Date.now(),
        updated_at: Date.now(),
      }
      set(state => ({ sessions: [...state.sessions, child] }))
    })

    socket.off('session:new')
    socket.on('session:new', (data: { sessionId: string; title: string; isEvent: boolean }) => {
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
        dataspace: null,
        parent_id: null,
        active_group: null,
        session_type: 'event',
        created_at: Date.now(),
        updated_at: Date.now(),
      }
      set(state => ({ sessions: [...state.sessions, session] }))
    })

    socket.off('event:status_changed')
    socket.on('event:status_changed', (data: { eventId: string; status: string }) => {
      console.log('[event] status changed:', data.eventId, data.status)
    })

    socket.off('evolution:insight_created')
    socket.on('evolution:insight_created', (data: { session_id: string; insight_type: string; description: string; notify_enabled: boolean; notify_timeout: number }) => {
      if (data.notify_enabled === false) return
      set({ evolutionNotification: { session_id: data.session_id, insight_type: data.insight_type, description: data.description } })
      const state = get()
      if (state._notificationTimer) clearTimeout(state._notificationTimer)
      const timer = setTimeout(() => set({ evolutionNotification: null }), (data.notify_timeout || 2) * 1000)
      set({ _notificationTimer: timer })
    })

    socket.off('workspace.updated')
    socket.on('workspace.updated', (data: { session_id: string; workspaces: string[] }) => {
      set(state => ({
        sessions: state.sessions.map(s =>
          s.id === data.session_id ? { ...s, workspaces: JSON.stringify(data.workspaces) } : s
        ),
      }))
    })

    // Persistent streaming for non-active sessions
    function isHandledByTemporaryListener(data: RunEvent): boolean {
      const state = get()
      if (!state._currentCleanup || data.session_id !== state.activeSessionId) return false
      const s = state.sessions.find(x => x.id === data.session_id)
      if (s?.session_type === 'event') return false
      return !data.run_id || data.run_id === state._activeRunId
    }

    
    socket.off('message.delta')
    socket.on('message.delta', (data: RunEvent) => {
      if (isHandledByTemporaryListener(data)) return
      const state = get()
      const s = state.sessions.find(x => x.id === data.session_id)
      if (!s) return
      const last = s.messages[s.messages.length - 1]
      if (last?.role === 'assistant' && last.is_streaming) {
        updateSessionMessage(data.session_id, sess => ({
          ...sess,
          messages: sess.messages.map((m, i) => i === sess.messages.length - 1
            ? {
              ...m,
              content: m.content + (data.delta || ''),
              reasoning: (m.reasoning || '') + (data.reasoning || ''),
              token_speed: data.token_speed ?? m.token_speed,
              token_speed_estimated: data.token_speed_estimated ?? m.token_speed_estimated,
            }
            : m
          ),
        }))
      } else {
        updateSessionMessage(data.session_id, sess => ({
          ...sess,
          messages: [...sess.messages, {
            id: uid(), role: 'assistant' as const, content: data.delta || '',
            reasoning: data.reasoning || '', is_streaming: true,
            token_speed: data.token_speed,
            token_speed_estimated: data.token_speed_estimated,
            timestamp: Date.now(),
          }],
        }))
      }
    })

    socket.off('message.metrics')
    socket.on('message.metrics', (data: RunEvent) => {
      if (isHandledByTemporaryListener(data)) return
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

    socket.off('tool.started')
    socket.on('tool.started', (data: RunEvent) => {
      if (isHandledByTemporaryListener(data)) return
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

    socket.off('tool.completed')
    socket.on('tool.completed', (data: RunEvent) => {
      if (isHandledByTemporaryListener(data)) return
      updateSessionMessage(data.session_id, sess => ({
        ...sess,
        messages: sess.messages.map(m =>
          m.role === 'tool' && m.tool_call_id === data.tool_call_id
            ? { ...m, tool_status: (data.tool_status as Message['tool_status']) || 'success', tool_output: data.tool_output }
            : m
        ),
      }))
    })

    socket.off('tool.output')
    socket.on('tool.output', (data: RunEvent) => {
      if (isHandledByTemporaryListener(data)) return
      updateSessionMessage(data.session_id, sess => ({
        ...sess,
        messages: sess.messages.map(m =>
          m.role === 'tool' && m.tool_call_id === data.tool_call_id
            ? { ...m, tool_output: (m.tool_output || '') + (data.output || '') }
            : m
        ),
      }))
    })

    socket.off('run.completed')
    socket.on('run.completed', (data: RunEvent) => {
      if (isHandledByTemporaryListener(data)) return
      updateSessionMessage(data.session_id, sess => {
        const messages = [...sess.messages]
        const last = messages[messages.length - 1]
        if (last?.is_streaming) messages[messages.length - 1] = { ...last, is_streaming: false }
        return { ...sess, messages, cacheStats: data.cache || sess.cacheStats }
      })
      handleTerminalForContinuation(data)
    })

    socket.off('run.max_turns')
    socket.on('run.max_turns', (data: RunEvent) => {
      if (isHandledByTemporaryListener(data)) return
      updateSessionMessage(data.session_id, sess => {
        const messages = [...sess.messages]
        const last = messages[messages.length - 1]
        if (last?.is_streaming) messages[messages.length - 1] = { ...last, is_streaming: false }
        return { ...sess, messages, cacheStats: data.cache || sess.cacheStats }
      })
      handleTerminalForContinuation(data)
    })

    socket.off('run.cancelled')
    socket.on('run.cancelled', (data: RunEvent) => {
      if (isHandledByTemporaryListener(data)) return
      updateSessionMessage(data.session_id, sess => {
        const messages = [...sess.messages]
        const last = messages[messages.length - 1]
        if (last?.is_streaming) messages[messages.length - 1] = { ...last, is_streaming: false }
        return { ...sess, messages }
      })
      handleTerminalForContinuation(data)
    })

    socket.off('run.limit_warning')
    socket.on('run.limit_warning', (data: RunEvent) => {
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

    socket.off('run.continuation_queued')
    socket.on('run.continuation_queued', (data: RunEvent) => {
      if (isHandledByTemporaryListener(data)) return
      handleContinuationQueued(data)
    })

    socket.off('run.compacted')
    socket.on('run.compacted', (data: RunEvent) => {
      set(state => ({
        sessions: state.sessions.map(s =>
          s.id === data.session_id ? { ...s, compacted: true } : s
        ),
      }))
    })

    socket.off('run.failed')
    socket.on('run.failed', (data: RunEvent) => {
      if (isHandledByTemporaryListener(data)) return
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
    })

    socket.off('run.started')
    socket.on('run.started', (data: RunEvent & { context_window?: number }) => {
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
      if (data.context_window) {
        set(state => ({
          sessions: state.sessions.map(s =>
            s.id === data.session_id ? { ...s, context_window: data.context_window } : s
          ),
        }))
      }
    })

    socket.off('run.queued')
    socket.on('run.queued', (data: RunEvent) => {
      handleAutoSuccessorQueued(data)
    })

    socket.off('run.retrying')
    socket.on('run.retrying', (data: RunEvent) => {
      updateSessionRun(data.session_id, { isStreaming: true })
    })

    // Approval prompts for sessions without a temporary listener (e.g. after
    // the page refreshed and resumeActiveRun is tracking the run).
    socket.off('approval.requested')
    socket.on('approval.requested', (data: RunEvent) => {
      if (isHandledByTemporaryListener(data)) return
      if (!data.session_id || !data.tool_call_id) return
      set({
        pendingApproval: pendingApprovalFromEvent(data),
      })
    })

    // ask_user prompts (persisted checkpoint; answered via /runs/:id/inputs).
    socket.off('ask_user')
    socket.on('ask_user', (data: { session_id?: string; run_id?: string; question?: string }) => {
      if (!data.run_id || !data.question) return
      if (data.session_id && data.session_id !== get().activeSessionId) return
      set({
        pendingAskUser: {
          run_id: data.run_id,
          session_id: data.session_id || '',
          question: data.question,
        },
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
  // message list. Mirrors the persistent socket handlers, but batch-applies
  // events in seq order instead of streaming.
  function applyRunEvents(sessionId: string, events: RunEvent[]) {
    const lastType = events.length > 0 ? events[events.length - 1].type : undefined
    const pendingApprovalEvent = events.find(e => e.type === 'approval.requested')
    const askUserEvent = events.find(e => e.type === 'ask_user')
    updateSessionMessage(sessionId, sess => {
      const messages = [...sess.messages]
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
        } else if (TERMINAL_EVENT_TYPES.has(e.type || '')) {
          const last = messages[messages.length - 1]
          if (last?.is_streaming) messages[messages.length - 1] = { ...last, is_streaming: false }
        }
      }
      return { ...sess, messages }
    })
    if (pendingApprovalEvent?.tool_call_id) {
      set({
        pendingApproval: pendingApprovalFromEvent(pendingApprovalEvent),
      })
    }
    if (askUserEvent?.run_id && askUserEvent.question) {
      set({
        pendingAskUser: {
          run_id: askUserEvent.run_id,
          session_id: sessionId,
          question: askUserEvent.question,
        },
      })
    }
    if (lastType) {
      updateSessionRun(sessionId, { isStreaming: !TERMINAL_EVENT_TYPES.has(lastType) })
    }
  }

  return {
    // ── State ──
    sessions: [],
    activeSessionId: null,
    isStreaming: false,
    pendingApproval: null,
    pendingAskUser: null,
    activeRun: { ...IDLE_RUN },
    limitNotice: null,
    sessionRuns: {},
    collapsedWorkspaces: new Set<string>(),
    toolExpandAll: false,
    isBatchMode: false,
    selectedSessionIds: new Set<string>(),
    tokenUsage: { input: 0, output: 0, total: 0 },
    evolutionNotification: null,
    attachments: [],
    _currentCleanup: null,
    _activeRunId: null,
    _notificationTimer: null,
    _loadingSessions: false,

    // ── Session Actions ──

    loadSessions: async () => {
      const state = get()
      if (state._loadingSessions) return
      set({ _loadingSessions: true })
      try {
        const list = await sessionsApi.fetchSessions()
        const currentSessions = get().sessions
        const sessions: Session[] = list.map(s => {
          // Preserve already-loaded messages
          const existing = currentSessions.find(x => x.id === s.id)
          return {
            ...s,
            current_strategy: normalizeStrategy(s.current_strategy),
            messages: existing?.messages || [],
            workspaces: s.workspaces ? JSON.parse(s.workspaces as string) : undefined,
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
        workspace: opts.workspace || defs.defaultWorkspace || DEFAULT_WORKSPACE,
        workspaces: opts.workspaces ? JSON.stringify(opts.workspaces) : (opts.workspace || defs.defaultWorkspace) ? JSON.stringify([opts.workspace || defs.defaultWorkspace]) : null,
        dataspace: defs.defaultWorkspace || DEFAULT_WORKSPACE,
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
          dataspace: session.dataspace,
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
      // Cleanup previous session listeners
      if (state._currentCleanup) {
        state._currentCleanup()
        set({ _currentCleanup: null })
      }

      // Derive the button/phase from the TARGET session's own record so the
      // previous session's running state never leaks into the view (§14.7).
      set(s => {
        const rec = s.sessionRuns[id] ?? { isStreaming: false, activeRun: { ...IDLE_RUN }, activeRunId: null }
        return {
          activeSessionId: id,
          isStreaming: rec.isStreaming,
          activeRun: rec.activeRun,
          _activeRunId: rec.activeRunId,
        }
      })
      savePersistedDefaults({ activeSessionId: id })

      const session = get().sessions.find(s => s.id === id)
      if (!session || session.messages.length > 0) {
        // Still evaluate whether this session has a live run so the send/stop
        // button matches the active session, not the previous one.
        get().resumeActiveRun(id)
        return
      }

      try {
        const data = await sessionsApi.fetchSessionMessages(id)
        const messages: Message[] = data.messages.map(toMessage)
        set(state => ({
          sessions: state.sessions.map(s =>
            s.id === id ? { ...s, messages } : s
          ),
        }))
        // Resume a run that was in flight when this view was last open.
        get().resumeActiveRun(id)
      } catch { /* new session */ }
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
      // Cleanup any previous run's temporary listeners first. Otherwise a
      // second sendMessage registers duplicate socket handlers for the same
      // events, and the earlier run's streamed deltas get dropped (stuck UI).
      if (state._currentCleanup) {
        state._currentCleanup()
        set({ _currentCleanup: null })
      }

      let session = state.sessions.find(s => s.id === state.activeSessionId)

      if (!session) {
        session = await get().createSession()
        set({ activeSessionId: session.id })
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

      const socket = connectSocket()
      const runId = `run_${session.id}_${uid()}`
      const workspaces = session.workspaces
        ? (typeof session.workspaces === 'string' ? JSON.parse(session.workspaces) : session.workspaces)
        : undefined

      socket.emit('chat-run', {
        session_id: session.id,
        run_id: runId,
        character_id: session.character_id,
        input,
        attachments: attachPayload,
        model: session.model || undefined,
        provider_id: session.provider_id || undefined,
        workspace: session.workspace || undefined,
        workspaces: workspaces || undefined,
        dataspace: session.dataspace || undefined,
        active_group: session.active_group || undefined,
        session_type: session.session_type || undefined,
        event_id: session.event_id || undefined,
        thinking: session.thinking || undefined,
        reasoning_effort: session.reasoning_effort || undefined,
        supersedes_message_id: pendingSupersedesMessageId,
      }, (response: { user_message_id?: number }) => {
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

      // ── Per-session temporary listeners ──
      function belongsToRun(data: { run_id?: string }): boolean {
        return !data.run_id || data.run_id === runId
      }

      function findSession(sid: string): Session | null {
        const s = get().sessions
        if (sid === session!.id) return s.find(x => x.id === sid) || null
        return s.find(x => x.parent_id === session!.id && x.id === sid) || null
      }

      function updateMsg(sid: string, updater: (sess: Session) => Session) {
        set(state => ({
          sessions: state.sessions.map(s => s.id === sid ? updater(s) : s),
        }))
      }

      const onRunStarted = (data: RunEvent & { context_window?: number }) => {
        if (!belongsToRun(data)) return
        set({ tokenUsage: { input: 0, output: 0, total: 0 } })
        const prev = get().sessionRuns[session!.id]?.activeRun
        updateSessionRun(session!.id, {
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
        if (data.context_window) {
          const s = findSession(data.session_id)
          if (s) {
            set(state => ({
              sessions: state.sessions.map(x =>
                x.id === data.session_id ? { ...x, context_window: data.context_window } : x
              ),
            }))
          }
        }
      }

      const onDelta = (data: RunEvent) => {
        if (!belongsToRun(data)) return
        const s = findSession(data.session_id)
        if (!s) return
        const last = s.messages[s.messages.length - 1]
        if (last?.role === 'assistant' && last.is_streaming) {
          updateMsg(data.session_id, sess => ({
            ...sess,
            messages: sess.messages.map((m, i) => i === sess.messages.length - 1
              ? {
                ...m,
                content: m.content + (data.delta || ''),
                reasoning: (m.reasoning || '') + (data.reasoning || ''),
                token_speed: data.token_speed ?? m.token_speed,
                token_speed_estimated: data.token_speed_estimated ?? m.token_speed_estimated,
              }
              : m
            ),
          }))
        } else {
          updateMsg(data.session_id, sess => ({
            ...sess,
            messages: [...sess.messages, {
              id: uid(), role: 'assistant' as const, content: data.delta || '',
              reasoning: data.reasoning || '', is_streaming: true,
              token_speed: data.token_speed,
              token_speed_estimated: data.token_speed_estimated,
              timestamp: Date.now(),
            }],
          }))
        }
      }

      const onMessageMetrics = (data: RunEvent) => {
        if (!belongsToRun(data)) return
        const s = findSession(data.session_id)
        if (!s) return
        updateMsg(data.session_id, sess => {
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
            break
          }
          return { ...sess, messages }
        })
      }

      const onToolStarted = (data: RunEvent) => {
        if (!belongsToRun(data)) return
        const s = findSession(data.session_id)
        if (!s) return
        updateMsg(data.session_id, sess => ({
          ...sess,
          messages: [...sess.messages, {
            id: uid(), role: 'tool' as const, content: '',
            tool_name: data.tool_name, tool_input: data.tool_input,
            tool_status: 'running' as const, timestamp: Date.now(),
            tool_call_id: data.tool_call_id,
          }],
        }))
      }

      const onToolCompleted = (data: RunEvent) => {
        if (!belongsToRun(data)) return
        const s = findSession(data.session_id)
        if (!s) return
        updateMsg(data.session_id, sess => ({
          ...sess,
          messages: sess.messages.map(m =>
            m.role === 'tool' && m.tool_call_id === data.tool_call_id
              ? { ...m, tool_status: (data.tool_status as Message['tool_status']) || 'success', tool_output: data.tool_output }
              : m
          ),
        }))
      }

      const onToolOutput = (data: RunEvent) => {
        if (!belongsToRun(data)) return
        const s = findSession(data.session_id)
        if (!s) return
        updateMsg(data.session_id, sess => ({
          ...sess,
          messages: sess.messages.map(m =>
            m.role === 'tool' && m.tool_call_id === data.tool_call_id
              ? { ...m, tool_output: (m.tool_output || '') + (data.output || '') }
              : m
          ),
        }))
      }

      const onStrategyUpdated = (data: RunEvent) => {
        const s = findSession(data.session_id)
        if (s && data.strategy) {
          set(state => ({
            sessions: state.sessions.map(x =>
              x.id === data.session_id ? { ...x, current_strategy: normalizeStrategy(data.strategy) } : x
            ),
          }))
        }
      }

      const onApprovalRequested = (data: RunEvent) => {
        if (!belongsToRun(data)) return
        if (data.session_id !== session!.id) return
        set({
          pendingApproval: pendingApprovalFromEvent(data),
        })
      }

      const onUsage = (data: { session_id: string; run_id?: string; input_tokens: number; output_tokens: number }) => {
        if (!belongsToRun(data)) return
        if (data.session_id === session!.id) {
          set({ tokenUsage: { input: data.input_tokens, output: data.output_tokens, total: data.input_tokens + data.output_tokens } })
        }
      }

      const onCompleted = (data: RunEvent) => {
        if (!belongsToRun(data)) return
        const s = findSession(data.session_id)
        if (!s) return
        updateMsg(data.session_id, sess => {
          const messages = [...sess.messages]
          const last = messages[messages.length - 1]
          if (last?.is_streaming) messages[messages.length - 1] = { ...last, is_streaming: false }
          return { ...sess, messages, cacheStats: data.cache || sess.cacheStats }
        })
        if (data.session_id === session!.id) {
          const summary = data.limit_summary || data.result?.limitSummary
          const continuationScheduled = !!summary?.continuationScheduled
            || !!data.continuationScheduled || !!data.result?.continuationScheduled
            || !!data.next_run_id || !!data.result?.nextRunId
          const nextRunId = summary?.nextRunId || data.next_run_id || data.result?.nextRunId || null
          const prev = get().sessionRuns[session!.id]?.activeRun
          if (continuationScheduled && nextRunId) {
            // Keep streaming across the continuation boundary (§14.3).
            updateSessionRun(session!.id, {
              activeRun: {
                runId: nextRunId,
                continuationRootRunId: prev?.continuationRootRunId || data.run_id || null,
                phase: 'continuation_pending',
                nextRunId,
                limitWarning: summary || prev?.limitWarning || null,
              },
              activeRunId: nextRunId,
              isStreaming: true,
            })
            return
          }
          updateSessionRun(session!.id, {
            activeRun: { ...IDLE_RUN },
            activeRunId: null,
            isStreaming: false,
          })
          cleanup()
        }
      }

      const onCompacted = (data: RunEvent) => {
        if (!belongsToRun(data)) return
        const s = findSession(data.session_id)
        if (s) {
          set(state => ({
            sessions: state.sessions.map(x =>
              x.id === data.session_id ? { ...x, compacted: true } : x
            ),
          }))
        }
      }

      const onFailed = (data: RunEvent) => {
        if (!belongsToRun(data)) return
        const s = findSession(data.session_id)
        if (!s) return
        updateMsg(data.session_id, sess => ({
          ...sess,
          messages: [...sess.messages, {
            id: uid(), role: 'assistant' as const,
            content: `Error: ${data.error || 'Unknown'}`,
            timestamp: Date.now(),
          }],
        }))
        if (data.session_id === session!.id) {
          updateSessionRun(session!.id, {
            activeRun: { ...IDLE_RUN },
            activeRunId: null,
            isStreaming: false,
          })
          cleanup()
        }
      }

      function cleanup() {
        socket.off('strategy.updated', onStrategyUpdated)
        socket.off('message.delta', onDelta)
        socket.off('message.metrics', onMessageMetrics)
        socket.off('tool.started', onToolStarted)
        socket.off('tool.completed', onToolCompleted)
        socket.off('tool.output', onToolOutput)
        socket.off('approval.requested', onApprovalRequested)
        socket.off('run.started', onRunStarted)
        socket.off('run.completed', onCompleted)
        socket.off('run.cancelled', onCompleted)
        socket.off('usage', onUsage)
        socket.off('run.compacted', onCompacted)
        socket.off('run.retrying', onRetrying)
        socket.off('run.failed', onFailed)
        // Only drop the listener ref. The session's run record is kept so a
        // still-running background session keeps being tracked after switching
        // away (it is cleared by updateSessionRun when the run actually ends).
        if (get()._currentCleanup === cleanup) set({ _currentCleanup: null })
      }

      const onRetrying = (data: RunEvent) => {
        if (!belongsToRun(data)) return
        updateSessionRun(data.session_id, { isStreaming: true })
      }

      socket.on('strategy.updated', onStrategyUpdated)
      socket.on('message.delta', onDelta)
      socket.on('message.metrics', onMessageMetrics)
      socket.on('tool.started', onToolStarted)
      socket.on('tool.completed', onToolCompleted)
      socket.on('tool.output', onToolOutput)
      socket.on('approval.requested', onApprovalRequested)
      socket.on('run.started', onRunStarted)
      socket.on('run.completed', onCompleted)
      socket.on('run.cancelled', onCompleted)
      socket.on('usage', onUsage)
      socket.on('run.compacted', onCompacted)
      socket.on('run.retrying', onRetrying)
      socket.on('run.failed', onFailed)

      set({ _currentCleanup: cleanup })
      updateSessionRun(session!.id, { activeRunId: runId })
    },

    resumeActiveRun: async (sessionId: string) => {
      const state = get()
      // A live run is already being tracked by the temporary listeners.
      if (state._currentCleanup) return
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
      try {
        events = await fetchRunEvents(active.id, afterSeq)
      } catch {
        return
      }
      if (events.length > 0) {
        applyRunEvents(sessionId, events)
        runSeqByRunId.set(active.id, events[events.length - 1].seq ?? afterSeq)
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
      const socket = getSocket()
      const state = get()
      if (socket?.connected && state.activeSessionId) {
        socket.emit('abort', { session_id: state.activeSessionId })
      } else if (state._activeRunId) {
        // Whole-chain cancel: auto continuations under the same root are stopped
        // too (§11.1).
        void cancelRun(state._activeRunId, true).catch(() => {})
      }
      if (state.activeSessionId) {
        updateSessionRun(state.activeSessionId, {
          activeRun: { ...IDLE_RUN },
          activeRunId: null,
          isStreaming: false,
        })
      } else {
        set({ activeRun: { ...IDLE_RUN }, _activeRunId: null, isStreaming: false })
      }
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
      const socket = getSocket()
      const state = get()
      if (socket?.connected && state.activeSessionId) {
        socket.emit('strategy.set', { session_id: state.activeSessionId, strategy })
      }
      // Update local state
      set(state => ({
        sessions: state.sessions.map(s =>
          s.id === state.activeSessionId ? { ...s, current_strategy: strategy } : s
        ),
      }))
    },

    respondApproval: (choice) => {
      const socket = getSocket()
      const state = get()
      if (socket?.connected && state.pendingApproval && state.activeSessionId) {
        socket.emit('approval.respond', {
          session_id: state.activeSessionId,
          tool_call_id: state.pendingApproval.tool_call_id,
          choice,
        })
      }
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
