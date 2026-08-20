import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RunEvent } from '@/types'

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
    cancelRun: vi.fn(async () => ({ cancelled: true })),
  }
})

vi.mock('@/api/eventBus', () => ({ getEventBus: mocks.getEventBus }))
vi.mock('@/api/runs', () => ({
  fetchRecentRuns: vi.fn(async () => []),
  fetchRunEvents: vi.fn(async () => []),
  cancelRun: mocks.cancelRun,
  submitRunInput: vi.fn(),
}))
vi.mock('@/api/sessions', () => ({
  fetchSessions: vi.fn(async () => []),
  fetchSessionPresences: vi.fn(async () => []),
  fetchChildSessions: vi.fn(async () => []),
  createSession: vi.fn(async (input: any) => ({ session: { id: 's2', messages: [] }, ...input })),
  fetchSessionMessages: vi.fn(async () => []),
  renameSession: vi.fn(async () => {}),
  deleteSession: vi.fn(async () => {}),
  keepMessages: vi.fn(async () => {}),
  reviseMessage: vi.fn(async () => ({})),
  forkSession: vi.fn(async () => ({})),
  generateSessionTitle: vi.fn(async () => {}),
  updateSession: vi.fn(async () => {}),
}))

const SID = 's1'

function handlers(): Map<string, (d: unknown) => void> {
  const map = new Map<string, (d: unknown) => void>()
  for (const [event, handler] of mocks.fakeBus.on.mock.calls as [string, (d: unknown) => void][]) {
    map.set(event, handler)
  }
  return map
}

describe('duplicate-text regression (double-append through both listeners)', () => {
  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.fakeBus.connected = true
    vi.useFakeTimers()
    const { useChatStore } = await import('@/stores/chatStore')
    useChatStore.setState({
      activeSessionId: SID,
      sessions: [{
        id: SID, character_id: 'c1', session_type: 'chat',
        messages: [{ id: 'm0', role: 'user', content: '帮我研究一下今天agent skill有啥新闻', timestamp: Date.now() }],
      }] as never,
      sessionRuns: {},
      isStreaming: false,
      _currentCleanup: null,
      _activeRunId: null,
    } as never)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('persistent + temporary listeners must not double-append the same delta', async () => {
    const { useChatStore } = await import('@/stores/chatStore')
    const send = useChatStore.getState().sendMessage
    await send('帮我研究一下今天agent skill有啥新闻')
    const runId = (mocks.fakeBus.emit.mock.calls.find(c => c[0] === 'chat-run')?.[1] as { run_id?: string })?.run_id || ''
    const h = handlers()

    // 临时监听器拦截了该 run 的 delta（belongsToRun=true）。
    // 持久监听器通过 isHandledByTemporaryListener 检查后必须跳过。
    h.get('message.delta')?.({ session_id: SID, run_id: runId, delta: '用户想让我研究', type: 'message.delta' } as RunEvent)
    h.get('message.delta')?.({ session_id: SID, run_id: runId, delta: '一下今天关于', type: 'message.delta' } as RunEvent)

    vi.advanceTimersByTime(60)

    const msgs = useChatStore.getState().sessions[0].messages
    const assistant = msgs.filter(m => (m as any).role === 'assistant')
    expect(assistant.length).toBe(1)
    // 关键断言：文本必须只拼接一次，不得重复
    expect((assistant[0] as any).content).toBe('用户想让我研究一下今天关于')
  })

  it('replay (applyRunEvents) and live stream must not double-append', async () => {
    const { useChatStore } = await import('@/stores/chatStore')
    const send = useChatStore.getState().sendMessage
    await send('hi')
    const runId = (mocks.fakeBus.emit.mock.calls.find(c => c[0] === 'chat-run')?.[1] as { run_id?: string })?.run_id || ''
    const h = handlers()

    // 模拟重连重放：先把历史事件灌进去（这是 attach 时读取历史/重放路径）
    const replay = [{ session_id: SID, run_id: runId, delta: '你好', type: 'message.delta', seq: 1, occurred_at: Date.now() }] as never[]
    // applyRunEvents 是 store 内部函数，无法直接 import——通过重放路径验证：
    // 这里改为模拟"重放后 live 继续"的场景
    useChatStore.setState(state => ({
      sessions: state.sessions.map(s => s.id === SID
        ? { ...s, messages: [...s.messages, { id: 'r1', role: 'assistant' as const, content: '你好', reasoning: '', is_streaming: true, timestamp: Date.now() }] }
        : s),
    }))

    h.get('message.delta')?.({ session_id: SID, run_id: runId, delta: '世界', type: 'message.delta' } as RunEvent)
    vi.advanceTimersByTime(60)

    const msgs = useChatStore.getState().sessions[0].messages
    const last = msgs[msgs.length - 1]
    expect((last as any).content).toBe('你好世界')
  })
})