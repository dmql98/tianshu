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
    createSession: vi.fn(async (input: any) => ({ session: { id: 's2', messages: [] }, ...input })),
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
  createSession: mocks.createSession,
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
    // 只保留最后一次注册（模拟 bus 覆盖语义：后注册的临时监听器处理流式事件）
    map.set(event, handler)
  }
  return map
}

describe('stream integration: sendMessage → delta → flush', () => {
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
        messages: [{ id: 'm0', role: 'user', content: 'prev', timestamp: Date.now() }],
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

  it('turn 1: deltas flush into a visible assistant message', async () => {
    const { useChatStore } = await import('@/stores/chatStore')
    const send = useChatStore.getState().sendMessage
    const runId = `run_${SID}_abc`
    // sendMessage 内部生成的 runId 不可控，改用 emit 捕获？直接调用 sendMessage：
    await send('hello')

    // 从 bus.emit 拿到 chat-run 的 run_id
    const runCall = mocks.fakeBus.emit.mock.calls.find(c => c[0] === 'chat-run')
    const sentRunId = (runCall?.[1] as { run_id?: string })?.run_id || runId
    const h = handlers()

    h.get('message.delta')?.({ session_id: SID, run_id: sentRunId, delta: '你', type: 'message.delta' } as RunEvent)
    h.get('message.delta')?.({ session_id: SID, run_id: sentRunId, delta: '好', type: 'message.delta' } as RunEvent)
    h.get('message.delta')?.({ session_id: SID, run_id: sentRunId, reasoning: '思考中', type: 'message.delta' } as RunEvent)

    vi.advanceTimersByTime(60)

    const msgs = useChatStore.getState().sessions[0].messages
    const assistant = msgs.filter(m => (m as any).role === 'assistant')
    expect(assistant.length).toBe(1)
    expect((assistant[0] as any).content).toBe('你好')
    expect((assistant[0] as any).reasoning).toBe('思考中')
  })

  it('turn 2 (second sendMessage) still streams after turn 1 cleanup', async () => {
    const { useChatStore } = await import('@/stores/chatStore')
    const send = useChatStore.getState().sendMessage

    await send('first')
    const run1 = (mocks.fakeBus.emit.mock.calls.find(c => c[0] === 'chat-run')?.[1] as { run_id?: string })?.run_id || ''
    const h1 = handlers()
    h1.get('message.delta')?.({ session_id: SID, run_id: run1, delta: '一', type: 'message.delta' } as RunEvent)
    vi.advanceTimersByTime(60)
    h1.get('message.metrics')?.({ session_id: SID, run_id: run1, type: 'message.metrics' } as RunEvent)
    h1.get('run.completed')?.({ session_id: SID, run_id: run1, type: 'run.completed', status: 'completed' } as RunEvent)

    // 第二轮
    await send('second')
    const run2 = (mocks.fakeBus.emit.mock.calls.filter(c => c[0] === 'chat-run').pop()?.[1] as { run_id?: string })?.run_id || ''
    const h2 = handlers()
    h2.get('message.delta')?.({ session_id: SID, run_id: run2, delta: '二', type: 'message.delta' } as RunEvent)
    vi.advanceTimersByTime(60)

    const msgs = useChatStore.getState().sessions[0].messages
    const assistants = msgs.filter(m => (m as any).role === 'assistant')
    expect(assistants.length).toBe(2)
    expect((assistants[1] as any).content).toBe('二')
  })
})
