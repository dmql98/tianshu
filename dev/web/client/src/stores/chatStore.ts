import { create } from 'zustand'
import type { Session, Message, RunEvent, WorkspaceGroup } from '@/types'
import * as sessionsApi from '@/api/sessions'
import { connectSocket, getSocket } from '@/api/socket'
import { useProvidersStore } from './providersStore'


const PERSIST_KEY = 'tianshu-chat-defaults'
const DEFAULT_WORKSPACE = 'C:\\.Tianshu'

type Strategy = 'Plan' | 'Ask' | 'Bypass'

interface PendingApproval {
  tool_call_id: string
  tool_name: string
  description: string
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

interface ChatState {
  // Sessions
  sessions: Session[]
  activeSessionId: string | null
  isStreaming: boolean
  pendingApproval: PendingApproval | null

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
  abortRun: () => void
  setStrategy: (strategy: Strategy) => void
  respondApproval: (choice: 'once' | 'always' | 'reject') => void

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
  selectAllSessions: () => void
  batchDeleteSessions: () => Promise<void>

  // UI
  toggleAllTools: () => void
  clearEvolutionNotification: () => void
}

export const useChatStore = create<ChatState>((set, get) => {
  // ── Persistent socket listeners (registered once) ──
  function initPersistentListeners() {
    const socket = connectSocket()

    socket.off('strategy.updated')
    socket.on('strategy.updated', (data: RunEvent) => {
      set(state => ({
        sessions: state.sessions.map(s =>
          s.id === data.session_id && data.strategy
            ? { ...s, current_strategy: data.strategy as Strategy }
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

    function updateSessionMessage(sessionId: string, updater: (session: Session) => Session) {
      set(state => ({
        sessions: state.sessions.map(s => s.id === sessionId ? updater(s) : s),
      }))
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
            ? { ...m, content: m.content + (data.delta || ''), reasoning: (m.reasoning || '') + (data.reasoning || '') }
            : m
          ),
        }))
      } else {
        updateSessionMessage(data.session_id, sess => ({
          ...sess,
          messages: [...sess.messages, {
            id: uid(), role: 'assistant' as const, content: data.delta || '',
            reasoning: data.reasoning || '', is_streaming: true, timestamp: Date.now(),
          }],
        }))
      }
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
      if (data.session_id === get().activeSessionId) set({ isStreaming: false })
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
      if (data.session_id === get().activeSessionId) set({ isStreaming: false })
    })

    socket.off('run.started')
    socket.on('run.started', (data: RunEvent & { context_window?: number }) => {
      if (data.session_id === get().activeSessionId) set({ isStreaming: true })
      if (data.context_window) {
        set(state => ({
          sessions: state.sessions.map(s =>
            s.id === data.session_id ? { ...s, context_window: data.context_window } : s
          ),
        }))
      }
    })

    socket.off('run.retrying')
    socket.on('run.retrying', (data: RunEvent) => {
      if (data.session_id === get().activeSessionId) set({ isStreaming: true })
    })
  }

  // Initialize listeners on store creation
  initPersistentListeners()

  return {
    // ── State ──
    sessions: [],
    activeSessionId: null,
    isStreaming: false,
    pendingApproval: null,
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
        currentStrategy = 'Bypass'
      } else {
        // Try to get default strategy from character (if loaded)
        // For now, default to Ask
        currentStrategy = 'Ask'
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
        set({ _currentCleanup: null, _activeRunId: null, isStreaming: false })
      }

      set({ activeSessionId: id })
      savePersistedDefaults({ activeSessionId: id })

      const session = get().sessions.find(s => s.id === id)
      if (!session || session.messages.length > 0) return

      try {
        const data = await sessionsApi.fetchSessionMessages(id)
        const messages: Message[] = data.messages.map(m => ({
          id: String(m.id),
          role: m.role as Message['role'],
          content: m.content,
          reasoning: m.reasoning_content || undefined,
          tool_name: m.tool_name || undefined,
          tool_input: m.tool_input || undefined,
          tool_output: m.tool_output || undefined,
          tool_status: (m.tool_status as Message['tool_status']) || undefined,
          timestamp: m.created_at,
        }))
        set(state => ({
          sessions: state.sessions.map(s =>
            s.id === id ? { ...s, messages } : s
          ),
        }))
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

    sendMessage: async (input: string) => {
      const state = get()
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
        isStreaming: true,
        attachments: [],
        tokenUsage: { input: 0, output: 0, total: 0 },
      }))

      // Auto-generate session title from first message
      if (!session.title && input.trim()) {
        const title = input.replace(/\n+/g, ' ').trim().slice(0, 60)
        set(state => ({
          sessions: state.sessions.map(s =>
            s.id === session!.id ? { ...s, title } : s
          ),
        }))
        sessionsApi.updateSession(session.id, { title }).catch(() => {})
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
              ? { ...m, content: m.content + (data.delta || ''), reasoning: (m.reasoning || '') + (data.reasoning || '') }
              : m
            ),
          }))
        } else {
          updateMsg(data.session_id, sess => ({
            ...sess,
            messages: [...sess.messages, {
              id: uid(), role: 'assistant' as const, content: data.delta || '',
              reasoning: data.reasoning || '', is_streaming: true, timestamp: Date.now(),
            }],
          }))
        }
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
              x.id === data.session_id ? { ...x, current_strategy: data.strategy as Strategy } : x
            ),
          }))
        }
      }

      const onApprovalRequested = (data: RunEvent) => {
        if (!belongsToRun(data)) return
        if (data.session_id !== session!.id) return
        set({
          pendingApproval: {
            tool_call_id: data.tool_call_id!,
            tool_name: data.tool_name!,
            description: data.tool_input || '',
          },
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
          set({ isStreaming: false })
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
          set({ isStreaming: false })
          cleanup()
        }
      }

      function cleanup() {
        socket.off('strategy.updated', onStrategyUpdated)
        socket.off('message.delta', onDelta)
        socket.off('tool.started', onToolStarted)
        socket.off('tool.completed', onToolCompleted)
        socket.off('tool.output', onToolOutput)
        socket.off('approval.requested', onApprovalRequested)
        socket.off('run.started', onRunStarted)
        socket.off('run.completed', onCompleted)
        socket.off('usage', onUsage)
        socket.off('run.compacted', onCompacted)
        socket.off('run.retrying', onRetrying)
        socket.off('run.failed', onFailed)
        const state = get()
        if (state._currentCleanup === cleanup) set({ _currentCleanup: null, _activeRunId: null })
      }

      const onRetrying = (data: RunEvent) => {
        if (!belongsToRun(data)) return
        if (data.session_id === session!.id) set({ isStreaming: true })
      }

      socket.on('strategy.updated', onStrategyUpdated)
      socket.on('message.delta', onDelta)
      socket.on('tool.started', onToolStarted)
      socket.on('tool.completed', onToolCompleted)
      socket.on('tool.output', onToolOutput)
      socket.on('approval.requested', onApprovalRequested)
      socket.on('run.started', onRunStarted)
      socket.on('run.completed', onCompleted)
      socket.on('usage', onUsage)
      socket.on('run.compacted', onCompacted)
      socket.on('run.retrying', onRetrying)
      socket.on('run.failed', onFailed)

      set({ _currentCleanup: cleanup, _activeRunId: runId })
    },

    abortRun: () => {
      const socket = getSocket()
      const state = get()
      if (socket?.connected && state.activeSessionId) {
        socket.emit('abort', { session_id: state.activeSessionId })
      }
    },

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

    // ── UI Actions ──

    toggleAllTools: () => set(state => ({ toolExpandAll: !state.toolExpandAll })),

    clearEvolutionNotification: () => set({ evolutionNotification: null }),
  }
})
