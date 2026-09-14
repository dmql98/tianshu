// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 复现：新建项目时窗口重新聚焦会触发 loadSessions()，其迟到的服务端快照
 * （此时还没包含刚创建的新会话）会整体覆盖本地列表，把乐观插入的新会话抹掉。
 * 用户侧表现为「第一次添加项目不生效，必须再加一次」。
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
    fetchSessions: vi.fn(async () => [] as any[]),
    createSession: vi.fn(async (input: any) => input),
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
  fetchSessions: mocks.fetchSessions,
  fetchSessionPresences: vi.fn(async () => []),
  fetchChildSessions: vi.fn(async () => []),
  createSession: mocks.createSession,
  fetchSessionMessages: vi.fn(async () => ({ session: {}, messages: [] })),
  renameSession: vi.fn(async () => {}),
  deleteSession: vi.fn(async () => {}),
  keepMessages: vi.fn(async () => {}),
  reviseMessage: vi.fn(async () => ({})),
  forkSession: vi.fn(async () => ({})),
  generateSessionTitle: vi.fn(async () => {}),
  updateSession: vi.fn(async () => {}),
}))

const OLD_SERVER_ROW = {
  id: 'old',
  character_id: 'c1',
  title: '旧项目会话',
  workspace: 'C:\\old',
  session_type: 'chat',
  created_at: 1,
  updated_at: 1,
}

describe('新建项目：迟到的 loadSessions 快照不得抹掉乐观新会话', () => {
  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('服务端快照尚未包含新会话时，新会话仍应留在列表里', async () => {
    const { useChatStore } = await import('@/stores/chatStore')
    useChatStore.setState({
      sessions: [{ ...OLD_SERVER_ROW, messages: [] }] as never,
      activeSessionId: 'old',
      sessionRuns: {},
    } as never)

    // 1) 原生目录框关闭、窗口重新聚焦 → loadSessions 先发出，快照是「旧」的
    let resolveFetch!: (value: any) => void
    mocks.fetchSessions.mockReturnValueOnce(new Promise(r => { resolveFetch = r }))
    const pending = useChatStore.getState().loadSessions()

    // 2) 选定新目录 → 创建新项目会话（乐观插入 + POST 成功）
    const created = await useChatStore.getState().createSession({ workspace: 'C:\\new' })

    // 3) 迟到的旧快照返回，覆盖本地列表
    resolveFetch([OLD_SERVER_ROW])
    await pending

    const ids = useChatStore.getState().sessions.map(s => s.id)
    expect(ids).toContain(created.id)
  })

  it('服务端快照已包含该会话时，不得产生重复条目', async () => {
    const { useChatStore } = await import('@/stores/chatStore')
    useChatStore.setState({ sessions: [], activeSessionId: null, sessionRuns: {} } as never)

    const created = await useChatStore.getState().createSession({ workspace: 'C:\\new' })
    mocks.fetchSessions.mockResolvedValueOnce([
      { ...OLD_SERVER_ROW, id: created.id, workspace: 'C:\\new' },
    ])
    await useChatStore.getState().loadSessions()

    const rows = useChatStore.getState().sessions.filter(s => s.id === created.id)
    expect(rows).toHaveLength(1)
  })
})
