// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 会话工作区语义 + 会话恢复的回归测试：
 * - workspace 三态：undefined（回落默认工作区）/ null（「默认」分组）/ 字符串；
 * - 本地缺失会话时，switchSession / sendMessage 先按同 id 从服务端恢复，
 *   不得静默新建到默认工作区（此前表现为「消息落到上一个项目」）。
 */
const mocks = vi.hoisted(() => {
  const fakeBus = {
    transport: 'sse' as const,
    connected: true,
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    onConnect: vi.fn(() => () => {}),
    onDisconnect: vi.fn(() => () => {}),
  }
  return {
    fakeBus,
    getEventBus: vi.fn(() => fakeBus),
    fetchSessionMessages: vi.fn(async () => ({ session: null as any, messages: [] as any[], total: 0 })),
    createSessionApi: vi.fn(async (input: any) => input),
  }
})

vi.mock('@/api/eventBus', () => ({ getEventBus: mocks.getEventBus }))
vi.mock('@/api/runs', () => ({
  fetchRecentRuns: vi.fn(async () => []),
  fetchRunEvents: vi.fn(async () => []),
  cancelRun: vi.fn(async () => ({ cancelled: true })),
  submitRunInput: vi.fn(),
}))
vi.mock('@/api/sessions', () => ({
  fetchSessions: vi.fn(async () => []),
  fetchSessionPresences: vi.fn(async () => []),
  fetchChildSessions: vi.fn(async () => []),
  createSession: mocks.createSessionApi,
  fetchSessionMessages: mocks.fetchSessionMessages,
  renameSession: vi.fn(async () => {}),
  deleteSession: vi.fn(async () => {}),
  keepMessages: vi.fn(async () => {}),
  reviseMessage: vi.fn(async () => ({})),
  forkSession: vi.fn(async () => ({})),
  generateSessionTitle: vi.fn(async () => {}),
  updateSession: vi.fn(async () => {}),
}))

const PERSIST_KEY = 'tianshu-chat-defaults'

function remoteRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'remote',
    character_id: 'c1',
    title: '远端会话',
    workspace: 'C:\\remote',
    workspaces: JSON.stringify(['C:\\remote']),
    session_type: 'chat',
    created_at: 1,
    updated_at: 2,
    ...overrides,
  }
}

describe('会话工作区语义与会话恢复', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('createSession({ workspace: null }) 落在「默认」分组，且不覆盖已记住的默认工作区', async () => {
    localStorage.setItem(PERSIST_KEY, JSON.stringify({ defaultWorkspace: 'C:\\keep' }))
    const { useChatStore } = await import('@/stores/chatStore')

    const session = await useChatStore.getState().createSession({ workspace: null })

    expect(session.workspace).toBeNull()
    expect(session.workspaces).toBeNull()
    expect(JSON.parse(localStorage.getItem(PERSIST_KEY)!).defaultWorkspace).toBe('C:\\keep')
  })

  it('createSession() 未指定 workspace 时回落默认工作区', async () => {
    localStorage.setItem(PERSIST_KEY, JSON.stringify({ defaultWorkspace: 'C:\\def' }))
    const { useChatStore } = await import('@/stores/chatStore')

    const session = await useChatStore.getState().createSession()

    expect(session.workspace).toBe('C:\\def')
    expect(JSON.parse(session.workspaces!)).toEqual(['C:\\def'])
  })

  it('switchSession 在本地缺失时从服务端恢复会话（含其工作区）', async () => {
    const { useChatStore } = await import('@/stores/chatStore')
    useChatStore.setState({ sessions: [], activeSessionId: null, sessionRuns: {} } as never)
    mocks.fetchSessionMessages.mockResolvedValueOnce({ session: remoteRow(), messages: [], total: 0 })

    await useChatStore.getState().switchSession('remote')

    const restored = useChatStore.getState().sessions.find(s => s.id === 'remote')
    expect(restored?.workspace).toBe('C:\\remote')
    expect(useChatStore.getState().activeSessionId).toBe('remote')
  })

  it('sendMessage 在本地缺失会话时不会新建到默认工作区', async () => {
    localStorage.setItem(PERSIST_KEY, JSON.stringify({ defaultWorkspace: 'C:\\default' }))
    const { useChatStore } = await import('@/stores/chatStore')
    useChatStore.setState({ sessions: [], activeSessionId: 'remote', sessionRuns: {} } as never)
    mocks.fetchSessionMessages.mockResolvedValueOnce({ session: remoteRow(), messages: [], total: 0 })

    await useChatStore.getState().sendMessage('你好')

    const sessions = useChatStore.getState().sessions
    expect(sessions).toHaveLength(1)
    expect(sessions[0].id).toBe('remote')
    expect(sessions[0].workspace).toBe('C:\\remote')
  })
})
