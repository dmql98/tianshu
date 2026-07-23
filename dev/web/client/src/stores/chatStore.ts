import { create } from 'zustand'
import type { Session, Message } from '@/types'
import * as sessionsApi from '@/api/sessions'
import { connectSocket, getSocket } from '@/api/socket'

const PERSIST_KEY = 'tianshu-chat-defaults'
const DEFAULT_WORKSPACE = 'C:\\.Tianshu'

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function loadPersistedDefaults() {
  try {
    const raw = localStorage.getItem(PERSIST_KEY)
    if (!raw) return { defaultWorkspace: DEFAULT_WORKSPACE }
    return JSON.parse(raw)
  } catch {
    return { defaultWorkspace: DEFAULT_WORKSPACE }
  }
}

interface ChatState {
  sessions: Session[]
  activeSessionId: string | null
  isStreaming: boolean
  pendingApproval: { tool_call_id: string; tool_name: string; description: string } | null
  collapsedWorkspaces: Set<string>
  tokenUsage: { input: number; output: number; total: number }

  loadSessions: () => Promise<void>
  createSession: (opts?: any) => Promise<Session>
  switchSession: (id: string) => Promise<void>
  sendMessage: (input: string) => Promise<void>
  renameSession: (id: string, title: string) => Promise<void>
  deleteSession: (id: string) => Promise<void>
  setStrategy: (strategy: 'Plan' | 'Ask' | 'Bypass') => void
  respondApproval: (choice: 'once' | 'always' | 'reject') => void
  abortRun: () => void
  toggleWorkspaceCollapse: (workspace: string) => void
}

export const useChatStore = create<ChatState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  isStreaming: false,
  pendingApproval: null,
  collapsedWorkspaces: new Set(),
  tokenUsage: { input: 0, output: 0, total: 0 },

  loadSessions: async () => {
    try {
      const list = await sessionsApi.fetchSessions()
      const sessions: Session[] = list.map(s => ({
        ...s,
        messages: [],
      }))
      set({ sessions })
    } catch {
      // ignore
    }
  },

  createSession: async (opts = {}) => {
    const defs = loadPersistedDefaults()
    const session: Session = {
      id: uid(),
      character_id: opts.character_id || 'general',
      title: opts.title || '新会话',
      model: opts.model || defs.model,
      provider_id: opts.provider_id || defs.provider_id,
      workspace: opts.workspace || defs.defaultWorkspace,
      workspaces: null,
      parent_id: null,
      active_group: null,
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
      })
    } catch {
      // will be created on first message if needed
    }

    return session
  },

  switchSession: async (id: string) => {
    set({ activeSessionId: id })
    const state = get()
    const session = state.sessions.find(s => s.id === id)

    if (session && session.messages.length === 0) {
      try {
        const data = await sessionsApi.fetchSessionMessages(id)
        const messages: Message[] = data.messages.map(m => ({
          id: String(m.id),
          role: m.role,
          content: m.content,
          tool_name: m.tool_name || undefined,
          tool_input: m.tool_input || undefined,
          tool_output: m.tool_output || undefined,
          tool_status: m.tool_status || undefined,
          timestamp: m.created_at,
        }))
        set(state => ({
          sessions: state.sessions.map(s =>
            s.id === id ? { ...s, messages } : s
          ),
        }))
      } catch {
        // new session
      }
    }
  },

  sendMessage: async (input: string) => {
    const state = get()
    let session = state.sessions.find(s => s.id === state.activeSessionId)

    if (!session) {
      session = await get().createSession()
      set({ activeSessionId: session.id })
    }

    const userMsg: Message = {
      id: uid(),
      role: 'user',
      content: input,
      timestamp: Date.now(),
    }

    set(state => ({
      sessions: state.sessions.map(s =>
        s.id === session!.id
          ? { ...s, messages: [...s.messages, userMsg] }
          : s
      ),
      isStreaming: true,
    }))

    const socket = connectSocket()
    socket.emit('chat-run', {
      session_id: session.id,
      character_id: session.character_id,
      input,
      model: session.model,
      provider_id: session.provider_id,
      workspace: session.workspace,
    })
  },

  renameSession: async (id: string, title: string) => {
    set(state => ({
      sessions: state.sessions.map(s =>
        s.id === id ? { ...s, title } : s
      ),
    }))
    await sessionsApi.renameSession(id, title)
  },

  deleteSession: async (id: string) => {
    set(state => ({
      sessions: state.sessions.filter(s => s.id !== id && s.parent_id !== id),
      activeSessionId: state.activeSessionId === id ? null : state.activeSessionId,
    }))
    await sessionsApi.deleteSession(id)
  },

  setStrategy: (strategy) => {
    const socket = getSocket()
    const state = get()
    if (socket?.connected && state.activeSessionId) {
      socket.emit('strategy.set', {
        session_id: state.activeSessionId,
        strategy,
      })
    }
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

  abortRun: () => {
    const socket = getSocket()
    const state = get()
    if (socket?.connected && state.activeSessionId) {
      socket.emit('abort', { session_id: state.activeSessionId })
    }
  },

  toggleWorkspaceCollapse: (workspace) => {
    set(state => {
      const collapsed = new Set(state.collapsedWorkspaces)
      if (collapsed.has(workspace)) {
        collapsed.delete(workspace)
      } else {
        collapsed.add(workspace)
      }
      return { collapsedWorkspaces: collapsed }
    })
  },
}))
