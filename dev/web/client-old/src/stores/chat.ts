import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { connectSocket, getSocket, type RunEvent, type Strategy } from '@/api/socket'
import * as sessionsApi from '@/api/sessions'

const PERSIST_KEY = 'tianshu-chat-defaults'
const DEFAULT_DEFAULT_WORKSPACE = 'C:\\.Tianshu'

function loadPersistedDefaults() {
  try {
    const raw = localStorage.getItem(PERSIST_KEY)
    if (!raw) return { defaultWorkspace: DEFAULT_DEFAULT_WORKSPACE }
    const parsed = JSON.parse(raw) as Record<string, string>
    if (!parsed.defaultWorkspace) {
      parsed.defaultWorkspace = DEFAULT_DEFAULT_WORKSPACE
    }
    return parsed
  } catch { return { defaultWorkspace: DEFAULT_DEFAULT_WORKSPACE } }
}

function savePersistedDefaults(data: Record<string, string | undefined>) {
  const existing = loadPersistedDefaults()
  localStorage.setItem(PERSIST_KEY, JSON.stringify({ ...existing, ...data }))
}

function uid(): string { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8) }

export interface Message {
  id: string; role: 'user' | 'assistant' | 'tool'; content: string
  attachments?: { name: string; mime: string; dataUrl?: string }[]
  tool_name?: string; tool_input?: string; tool_output?: string
  tool_call_id?: string
  tool_status?: 'running' | 'done' | 'success' | 'error'
  is_streaming?: boolean
  reasoning?: string
  reasoning_duration?: number
  timestamp: number
}

export interface Session {
  id: string; character_id: string; title: string; messages: Message[]
  model?: string; provider_id?: string; workspace?: string; workspaces?: string[]
  pinned?: boolean
  thinking?: boolean
  reasoning_effort?: string
  current_strategy?: Strategy
  parent_id?: string
  active_group?: string
  session_type?: 'chat' | 'event'
  event_id?: string | null
  context_window?: number | null
  compacted?: boolean
  created_at: number; updated_at: number
  cacheStats?: { hitTokens: number; missTokens: number; hitRatio: string }
}

export interface EventStatusChange {
  eventId: string
  status: string
  result_summary?: string
  error?: string
}

export interface SessionNew {
  sessionId: string
  title: string
  isEvent: boolean
}

export interface WorkspaceGroup {
  name: string
  sessions: Session[]
  collapsed: boolean
}

export const useChatStore = defineStore('chat', () => {
  const sessions = ref<Session[]>([])
  const activeSessionId = ref<string | null>(null)
  const activeSession = computed(() => sessions.value.find(s => s.id === activeSessionId.value) || null)
  const isStreaming = ref(false)
  const pendingApproval = ref<{ tool_call_id: string; tool_name: string; description: string } | null>(null)
  const currentStrategy = computed(() => activeSession.value?.current_strategy || 'Plan')
  const collapsedWorkspaces = ref<Set<string>>(new Set())
  const isBatchMode = ref(false)
  const selectedSessionIds = ref<Set<string>>(new Set())
  const evolutionNotification = ref<{ session_id: string; insight_type: string; description: string } | null>(null)
  let notificationTimer: ReturnType<typeof setTimeout> | null = null
  let currentCleanup: (() => void) | null = null

  const tokenUsage = ref({ input: 0, output: 0, total: 0 })

  const toolExpandAll = ref(false)
  const defaultContextWindow = 200000
  const contextUsage = computed(() => {
    const s = activeSession.value
    if (!s) return { pct: 0, used: 0, total: defaultContextWindow, show: false }
    const cw = s.context_window || defaultContextWindow
    let total = 0
    for (const m of s.messages) {
      if (m.content) total += m.content.length
      else if (m.tool_output) total += m.tool_output.length
      if (m.reasoning) total += m.reasoning.length
      total += 16
    }
    const tokenEst = Math.ceil(total / 4)
    return {
      pct: Math.min(100, Math.round((tokenEst / cw) * 100)),
      used: tokenEst,
      total: cw,
      show: tokenEst > 0,
    }
  })

  const attachments = ref<{ name: string; mime: string; data: string; dataUrl?: string }[]>([])

  function toggleAllTools() { toolExpandAll.value = !toolExpandAll.value }

  function addAttachment(name: string, mime: string, data: string, dataUrl?: string) {
    attachments.value.push({ name, mime, data, dataUrl })
  }
  function removeAttachment(idx: number) {
    attachments.value.splice(idx, 1)
  }
  function clearAttachments() {
    attachments.value = []
  }

  function getChildSessions(parentId: string): Session[] {
    return sessions.value.filter(s => s.parent_id === parentId)
  }

  const workspaceGroups = computed<WorkspaceGroup[]>(() => {
    const groups = new Map<string, Session[]>()
    const parentSessions = sessions.value.filter(s => !s.parent_id)
    parentSessions.forEach(session => {
      const workspaces = session.workspaces && session.workspaces.length > 0
        ? session.workspaces
        : session.workspace ? [session.workspace] : ['default']
      for (const ws of workspaces) {
        if (!groups.has(ws)) groups.set(ws, [])
        if (!groups.get(ws)!.find(s => s.id === session.id)) {
          groups.get(ws)!.push(session)
        }
      }
    })
    return Array.from(groups.entries()).map(([name, sessions]) => ({
      name,
      sessions,
      collapsed: collapsedWorkspaces.value.has(name),
    }))
  })

  async function renameSession(id: string, title: string) {
    const session = sessions.value.find(s => s.id === id)
    if (session) session.title = title
    await sessionsApi.renameSession(id, title)
  }

  async function deleteSingleSession(id: string) {
    const children = getChildSessions(id)
    for (const child of children) {
      sessions.value = sessions.value.filter(s => s.id !== child.id)
      sessionsApi.deleteSession(child.id).catch(() => {})
    }
    sessions.value = sessions.value.filter(s => s.id !== id)
    if (activeSessionId.value === id) activeSessionId.value = null
    sessionsApi.deleteSession(id).catch(() => {})
  }

  function toggleSessionStar(id: string) {
    const session = sessions.value.find(s => s.id === id)
    if (session) {
      session.pinned = !session.pinned
    }
  }

  function toggleWorkspaceCollapse(workspace: string) {
    if (collapsedWorkspaces.value.has(workspace)) {
      collapsedWorkspaces.value.delete(workspace)
    } else {
      collapsedWorkspaces.value.add(workspace)
    }
  }

  // persistent socket listeners (registered once)
  {
    const socket = getSocket()
    socket.off('strategy.updated')
    socket.on('strategy.updated', (data: RunEvent) => {
      const s = sessions.value.find(x => x.id === data.session_id)
      if (s && data.strategy) s.current_strategy = data.strategy
    })
    socket.off('sub_agent.started')
    socket.on('sub_agent.started', (data: { session_id: string; sub_session_id: string; target_character_id: string; task: string }) => {
      if (sessions.value.find(s => s.id === data.sub_session_id)) return
      const parent = sessions.value.find(s => s.id === data.session_id)
      const child: Session = {
        id: data.sub_session_id,
        character_id: data.target_character_id,
        title: `Sub: ${data.task.slice(0, 60)}`,
        messages: [],
        parent_id: data.session_id,
        workspace: parent?.workspace,
        workspaces: parent?.workspaces,
        created_at: Date.now(),
        updated_at: Date.now(),
      }
      sessions.value.push(child)
    })
    socket.off('session:new')
    socket.on('session:new', (data: SessionNew) => {
      if (sessions.value.find(s => s.id === data.sessionId)) return
      sessions.value.push({
        id: data.sessionId,
        character_id: '',
        title: data.title,
        messages: [],
        session_type: 'event',
        created_at: Date.now(),
        updated_at: Date.now(),
      })
    })
    // Persistent streaming handlers — skip active non-event sessions (handled by per-send listeners)
    function isActiveSession(sid: string) {
      if (sid !== activeSessionId.value) return false
      const s = sessions.value.find(x => x.id === sid)
      return s?.session_type !== 'event'
    }

    socket.off('event:status_changed')
    socket.on('event:status_changed', (data: EventStatusChange) => {
      console.log('[event] status changed:', data.eventId, data.status)
    })

    socket.off('evolution:insight_created')
    socket.on('evolution:insight_created', (data: { session_id: string; insight_type: string; description: string; notify_enabled: boolean; notify_timeout: number }) => {
      if (data.notify_enabled === false) return
      evolutionNotification.value = data
      if (notificationTimer) clearTimeout(notificationTimer)
      notificationTimer = setTimeout(() => { evolutionNotification.value = null }, (data.notify_timeout || 2) * 1000)
    })

    socket.off('message.delta', onPersistentDelta)
    socket.on('message.delta', onPersistentDelta)
    socket.off('tool.started', onPersistentToolStarted)
    socket.on('tool.started', onPersistentToolStarted)
    socket.off('tool.completed', onPersistentToolCompleted)
    socket.on('tool.completed', onPersistentToolCompleted)
    socket.off('tool.output', onPersistentToolOutput)
    socket.on('tool.output', onPersistentToolOutput)
    socket.off('run.completed', onPersistentCompleted)
    socket.on('run.completed', onPersistentCompleted)
    socket.off('run.compacted', onPersistentCompacted)
    socket.on('run.compacted', onPersistentCompacted)
    socket.off('workspace.updated')
    socket.on('workspace.updated', (data: { session_id: string; workspaces: string[] }) => {
      const s = sessions.value.find(x => x.id === data.session_id)
      if (s) s.workspaces = data.workspaces
    })
    socket.off('run.started')
    socket.on('run.started', (data: RunEvent & { context_window?: number }) => {
      if (data.session_id === activeSessionId.value) {
        isStreaming.value = true
      }
      if (data.context_window) {
        const s = sessions.value.find(x => x.id === data.session_id)
        if (s) s.context_window = data.context_window
      }
    })
    socket.off('run.failed', onPersistentFailed)
    socket.on('run.failed', onPersistentFailed)

    function onPersistentDelta(data: RunEvent) {
      if (isActiveSession(data.session_id)) return
      const s = sessions.value.find(x => x.id === data.session_id)
      if (!s) return
      const last = s.messages[s.messages.length - 1]
      if (last?.role === 'assistant' && last.is_streaming) {
        if (data.reasoning) last.reasoning = (last.reasoning || '') + data.reasoning
        if (data.delta) last.content += data.delta
      } else {
        s.messages.push({
          id: uid(), role: 'assistant', content: data.delta || '',
          reasoning: data.reasoning || '',
          is_streaming: true, timestamp: Date.now(),
        })
      }
    }
    function onPersistentToolStarted(data: RunEvent) {
      if (isActiveSession(data.session_id)) return
      const s = sessions.value.find(x => x.id === data.session_id)
      if (!s) return
      s.messages.push({
        id: uid(), role: 'tool', content: '',
        tool_name: data.tool_name, tool_input: data.tool_input,
        tool_status: 'running', timestamp: Date.now(),
        tool_call_id: data.tool_call_id,
      })
    }
    function onPersistentToolCompleted(data: RunEvent) {
      if (isActiveSession(data.session_id)) return
      const s = sessions.value.find(x => x.id === data.session_id)
      if (!s) return
      const tool = s.messages.find(m => m.role === 'tool' && m.tool_call_id === data.tool_call_id)
      if (tool) { tool.tool_status = (data.tool_status as any) || 'success'; tool.tool_output = data.tool_output }
    }
    function onPersistentToolOutput(data: RunEvent) {
      if (isActiveSession(data.session_id)) return
      const s = sessions.value.find(x => x.id === data.session_id)
      if (!s) return
      const tool = s.messages.find(m => m.role === 'tool' && m.tool_call_id === data.tool_call_id)
      if (tool) { tool.tool_output = (tool.tool_output || '') + (data.output || '') }
    }
    function onPersistentCompleted(data: RunEvent) {
      if (isActiveSession(data.session_id)) return
      if (data.session_id === activeSessionId.value) {
        isStreaming.value = false
      }
      const s = sessions.value.find(x => x.id === data.session_id)
      if (!s) return
      const last = s.messages[s.messages.length - 1]
      if (last?.is_streaming) last.is_streaming = false
    }
    function onPersistentCompacted(data: RunEvent) {
      const s = sessions.value.find(x => x.id === data.session_id)
      if (s) s.compacted = true
    }
    function onPersistentFailed(data: RunEvent) {
      if (isActiveSession(data.session_id)) return
      if (data.session_id === activeSessionId.value) {
        isStreaming.value = false
      }
      const s = sessions.value.find(x => x.id === data.session_id)
      if (!s) return
      s.messages.push({ id: uid(), role: 'assistant', content: `Error: ${data.error || 'Unknown'}`, timestamp: Date.now() })
    }
  }

  async function loadSessions() {
    const list = await sessionsApi.fetchSessions()
    sessions.value = list.map(s => ({
      ...s,
      model: s.model ?? undefined,
      provider_id: s.provider_id ?? undefined,
      workspace: s.workspace ?? undefined,
      workspaces: s.workspaces ? JSON.parse(s.workspaces) : undefined,
      parent_id: s.parent_id ?? undefined,
      active_group: s.active_group ?? undefined,
      current_strategy: s.current_strategy,
      context_window: s.context_window ?? undefined,
      messages: [],
    }))
    for (const s of sessions.value) {
      if (s.parent_id) continue
      try {
        const children = await sessionsApi.fetchChildSessions(s.id)
        for (const c of children) {
          if (!sessions.value.find(x => x.id === c.id)) {
            sessions.value.push({
              ...c,
              model: c.model ?? undefined,
              provider_id: c.provider_id ?? undefined,
              workspace: c.workspace ?? undefined,
              workspaces: c.workspaces ? JSON.parse(c.workspaces) : undefined,
              parent_id: c.parent_id ?? undefined,
              active_group: c.active_group ?? undefined,
              context_window: c.context_window ?? undefined,
              messages: [],
            })
          }
        }
      } catch { /* ignore */ }
    }
  }

  watch(activeSession, (s) => {
    if (!s) return
    savePersistedDefaults({
      character_id: s.character_id,
      provider_id: s.provider_id,
      model: s.model,
      workspace: s.workspace,
    })
  }, { deep: true })

  watch(activeSessionId, (id) => {
    if (id) savePersistedDefaults({ activeSessionId: id })
  })

  async function createSession(opts: { character_id?: string; model?: string; provider_id?: string; workspace?: string; workspaces?: string[]; parent_id?: string; active_group?: string; session_type?: 'chat' | 'event'; event_id?: string | null; title?: string } = {}): Promise<Session> {
    const defs = loadPersistedDefaults()
    const characterId = opts.character_id || defs.character_id || 'general'
    let current_strategy: Strategy | undefined
    if (opts.session_type === 'event') {
      current_strategy = 'Bypass'
    } else {
      const { useCharactersStore } = await import('@/stores/characters')
      const char = useCharactersStore().characters.find(c => c.id === characterId)
      current_strategy = char?.default_strategy as Strategy | undefined
    }
    const session: Session = {
      id: uid(), character_id: characterId,
      title: opts.title || '',
      model: opts.model || defs.model, provider_id: opts.provider_id || defs.provider_id,
      workspace: opts.workspace || defs.defaultWorkspace,
      workspaces: opts.workspaces || (opts.workspace || defs.defaultWorkspace ? [opts.workspace || defs.defaultWorkspace!] : undefined),
      parent_id: opts.parent_id,
      active_group: opts.active_group,
      session_type: opts.session_type,
      event_id: opts.event_id,
      current_strategy,
      context_window: undefined,
      messages: [], created_at: Date.now(), updated_at: Date.now(),
    }
    sessions.value.unshift(session)
    try {
      await sessionsApi.createSession({ id: session.id, character_id: session.character_id, title: session.title, model: session.model, provider_id: session.provider_id, workspace: session.workspace, workspaces: session.workspaces ? JSON.stringify(session.workspaces) : null, parent_id: session.parent_id, active_group: session.active_group, session_type: session.session_type, event_id: session.event_id, current_strategy })
    } catch { /* will be created on first message if needed */ }
    return session
  }

  async function switchSession(id: string) {
    if (currentCleanup) {
      currentCleanup()
      isStreaming.value = false
    }
    activeSessionId.value = id
    const s = sessions.value.find(s => s.id === id)
    if (!s || s.messages.length > 0) return
    try {
      const data = await sessionsApi.fetchSessionMessages(id)
      s.messages = data.messages.map(m => ({
        id: String(m.id), role: m.role as any, content: m.content,
        reasoning: m.reasoning_content || undefined,
        tool_name: m.tool_name || undefined, tool_input: m.tool_input || undefined,
        tool_output: m.tool_output || undefined, tool_status: m.tool_status as any || undefined,
        timestamp: m.created_at,
      }))
    } catch { /* new session */ }
  }

  function setStrategy(strategy: Strategy) {
    const session = activeSession.value
    if (!session) return
    const socket = connectSocket()
    socket.emit('strategy.set', { session_id: session.id, strategy }, (resp: any) => {
      if (resp?.error) console.warn('strategy.set error:', resp.error)
    })
  }

  async function sendMessage(input: string) {
    let session = activeSession.value
    if (!session) {
      session = await createSession()
      activeSessionId.value = session.id
    }

    let fullInput = input
    const attachPayload = attachments.value.length > 0
      ? attachments.value.map(a => ({ name: a.name, mime: a.mime, data: a.data, dataUrl: a.dataUrl }))
      : undefined
    attachments.value = []

    const userMsg: Message = {
      id: uid(), role: 'user', content: fullInput, timestamp: Date.now(),
      attachments: attachPayload
        ? attachPayload.map(a => ({ name: a.name, mime: a.mime, dataUrl: a.dataUrl }))
        : undefined,
    }
    session.messages.push(userMsg)
    isStreaming.value = true

    if (!session.provider_id) {
      const { useProvidersStore } = await import('@/stores/providers')
      const providers = useProvidersStore().providers
      if (providers.length > 0) session.provider_id = providers[0].id
    }

    const socket = connectSocket()
    socket.emit('chat-run', {
      session_id: session.id,
      character_id: session.character_id,
      input: fullInput,
      attachments: attachPayload,
      model: session.model || undefined,
      provider_id: session.provider_id || undefined,
      workspace: session.workspace || undefined,
      workspaces: session.workspaces || undefined,
      active_group: session.active_group || undefined,
      session_type: session.session_type || undefined,
      event_id: session.event_id || undefined,
      thinking: session.thinking || undefined,
      reasoning_effort: session.reasoning_effort || undefined,
    })

    function findSession(sid: string): Session | null {
      if (sid === session!.id) return session!
      return sessions.value.find(s => s.parent_id === session!.id && s.id === sid) || null
    }

    const onStrategyUpdated = (data: RunEvent & { context_window?: number }) => {
      const s = findSession(data.session_id)
      if (!s) return
      if (data.strategy) s.current_strategy = data.strategy
    }
    const onRunStarted = (data: RunEvent & { context_window?: number }) => {
      tokenUsage.value = { input: 0, output: 0, total: 0 }
      if (data.context_window) {
        const s = findSession(data.session_id)
        if (s) s.context_window = data.context_window
      }
    }
    const onDelta = (data: RunEvent) => {
      const s = findSession(data.session_id)
      if (!s) return
      const last = s.messages[s.messages.length - 1]
      if (last?.role === 'assistant' && last.is_streaming) {
        if (data.reasoning) last.reasoning = (last.reasoning || '') + data.reasoning
        if (data.delta) last.content += data.delta
      } else {
        s.messages.push({
          id: uid(), role: 'assistant', content: data.delta || '',
          reasoning: data.reasoning || '',
          is_streaming: true, timestamp: Date.now(),
        })
      }
    }
    const onToolStarted = (data: RunEvent) => {
      const s = findSession(data.session_id)
      if (!s) return
      s.messages.push({
        id: uid(), role: 'tool', content: '',
        tool_name: data.tool_name, tool_input: data.tool_input,
        tool_status: 'running', timestamp: Date.now(),
        tool_call_id: data.tool_call_id,
      })
    }
    const onToolCompleted = (data: RunEvent) => {
      const s = findSession(data.session_id)
      if (!s) return
      const tool = s.messages.find(m => m.role === 'tool' && m.tool_call_id === data.tool_call_id)
      if (tool) { tool.tool_status = (data.tool_status as any) || 'success'; tool.tool_output = data.tool_output }
    }
    const onToolOutput = (data: RunEvent) => {
      const s = findSession(data.session_id)
      if (!s) return
      const tool = s.messages.find(m => m.role === 'tool' && m.tool_call_id === data.tool_call_id)
      if (tool) { tool.tool_output = (tool.tool_output || '') + (data.output || '') }
    }
    const onApprovalRequested = (data: RunEvent) => {
      if (data.session_id !== session!.id) return
      pendingApproval.value = {
        tool_call_id: data.tool_call_id!, tool_name: data.tool_name!, description: data.tool_input || '',
      }
    }
    const onCompleted = (data: RunEvent) => {
      const s = findSession(data.session_id)
      if (!s) return
      const last = s.messages[s.messages.length - 1]
      if (last?.is_streaming) last.is_streaming = false
      if (data.cache) s.cacheStats = data.cache
      if (data.session_id === session!.id) isStreaming.value = false
      if (data.session_id === session!.id) cleanup()
    }
    const onUsage = (data: { session_id: string; input_tokens: number; output_tokens: number; usage_type: string }) => {
      if (data.session_id === session!.id) {
        tokenUsage.value = {
          input: data.input_tokens,
          output: data.output_tokens,
          total: data.input_tokens + data.output_tokens,
        }
      }
    }
    const onCompacted = (data: RunEvent) => {
      const s = findSession(data.session_id)
      if (s) s.compacted = true
    }
    const onFailed = (data: RunEvent) => {
      const s = findSession(data.session_id)
      if (!s) return
      s.messages.push({ id: uid(), role: 'assistant', content: `Error: ${data.error || 'Unknown'}`, timestamp: Date.now() })
      if (data.session_id === session!.id) {
        isStreaming.value = false
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
      socket.off('workspace.paths.updated')
      socket.off('run.started', onRunStarted)
      socket.off('run.completed', onCompleted)
      socket.off('usage', onUsage)
      socket.off('run.compacted', onCompacted)
      socket.off('run.failed', onFailed)
      if (currentCleanup === cleanup) currentCleanup = null
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
    socket.on('run.failed', onFailed)
    currentCleanup = cleanup
  }

  function respondApproval(choice: 'once' | 'always' | 'reject') {
    if (!pendingApproval.value) return
    const socket = getSocket()
    if (socket?.connected && activeSessionId.value) {
      socket.emit('approval.respond', {
        session_id: activeSessionId.value,
        tool_call_id: pendingApproval.value.tool_call_id,
        choice,
      })
    }
    pendingApproval.value = null
  }

  function abortRun() {
    const socket = getSocket()
    if (socket?.connected && activeSessionId.value) {
      socket.emit('abort', { session_id: activeSessionId.value })
    }
  }

  async function resetToMessage(sessionId: string, messageId: string) {
    const s = sessions.value.find(x => x.id === sessionId)
    if (!s) return
    const idx = s.messages.findIndex(m => m.id === messageId)
    if (idx < 0) return
    s.messages = s.messages.slice(0, idx + 1)
    try { await sessionsApi.keepMessages(sessionId, idx + 1) } catch { /* best-effort */ }
  }

  function toggleBatchMode() {
    isBatchMode.value = !isBatchMode.value
    if (!isBatchMode.value) {
      selectedSessionIds.value.clear()
    }
  }

  function toggleSessionSelection(sessionId: string) {
    if (selectedSessionIds.value.has(sessionId)) {
      selectedSessionIds.value.delete(sessionId)
    } else {
      selectedSessionIds.value.add(sessionId)
    }
  }

  function selectAllSessions() {
    if (selectedSessionIds.value.size === sessions.value.length) {
      selectedSessionIds.value.clear()
    } else {
      sessions.value.forEach(session => {
        selectedSessionIds.value.add(session.id)
      })
    }
  }

  function addWorkspace(path: string) {
    const session = activeSession.value
    if (!session) return
    if (!session.workspaces) {
      session.workspaces = [session.workspace || path]
    }
    if (!session.workspaces.includes(path)) {
      session.workspaces.push(path)
      sessionsApi.updateSession(session.id, {
        workspace: session.workspace || path,
        workspaces: JSON.stringify(session.workspaces),
      }).catch(() => {})
    }
  }

  function removeWorkspace(path: string) {
    const session = activeSession.value
    if (!session || !session.workspaces) return
    // Default workspace cannot be deleted
    if (path === session.workspace) return
    session.workspaces = session.workspaces.filter(w => w !== path)
    if (session.workspaces.length === 0) {
      session.workspaces = undefined
    }
    sessionsApi.updateSession(session.id, {
      workspaces: session.workspaces ? JSON.stringify(session.workspaces) : null,
    }).catch(() => {})
  }

  async function batchDeleteSessions() {
    const ids = Array.from(selectedSessionIds.value)
    const allIds = new Set<string>()
    for (const id of ids) {
      allIds.add(id)
      const children = getChildSessions(id)
      for (const c of children) allIds.add(c.id)
    }
    const failedIds: string[] = []
    await Promise.all(Array.from(allIds).map(id =>
      sessionsApi.deleteSession(id).catch(() => { failedIds.push(id) })
    ))
    const deletedIds = Array.from(allIds).filter(id => !failedIds.includes(id))
    sessions.value = sessions.value.filter(s => !deletedIds.includes(s.id))
    if (activeSessionId.value && deletedIds.includes(activeSessionId.value)) {
      activeSessionId.value = null
    }
    deletedIds.forEach(id => selectedSessionIds.value.delete(id))
    if (selectedSessionIds.value.size === 0) {
      isBatchMode.value = false
    }
  }

  return {
    sessions, activeSessionId, activeSession, isStreaming, pendingApproval, currentStrategy,
    collapsedWorkspaces, workspaceGroups, isBatchMode, selectedSessionIds,
    evolutionNotification,
    tokenUsage,
    toolExpandAll, toggleAllTools,
    contextUsage,
    attachments, addAttachment, removeAttachment, clearAttachments,
    loadSessions, createSession, switchSession, sendMessage, setStrategy, respondApproval, abortRun,
    renameSession, deleteSingleSession, resetToMessage,
    toggleSessionStar, getChildSessions,
    addWorkspace, removeWorkspace,
    toggleWorkspaceCollapse, toggleBatchMode, toggleSessionSelection, selectAllSessions, batchDeleteSessions,
  }
})
