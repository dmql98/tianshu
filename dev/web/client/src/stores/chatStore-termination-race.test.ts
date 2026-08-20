import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RunEvent } from '@/types'

const mocks = vi.hoisted(() => {
  // 真实注册表：on/off 必须真的增删监听器（真实 eventBus 的 Set 语义），
  // 否则 sendMessage 的 cleanup 形同虚设，旧 run 的临时监听器会一直存活，
  // 把旧 run 的终态二次处理，污染新 run 的状态。
  const reg = new Map<string, Set<(d: unknown) => void>>()
  const fakeBus = {
    transport: 'sse' as const,
    connected: true,
    _reg: reg,
    on: vi.fn((type: string, cb: (d: unknown) => void) => {
      let s = reg.get(type)
      if (!s) { s = new Set(); reg.set(type, s) }
      s.add(cb)
    }),
    off: vi.fn((type: string, cb?: (d: unknown) => void) => {
      if (cb) reg.get(type)?.delete(cb)
      else reg.delete(type)
    }),
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

/** Real-bus semantics: dispatch an event to every currently-registered handler,
 *  in registration order (persistent listeners first, then the per-run temporary
 *  listener installed by sendMessage). Existing helpers only call the LAST
 *  handler, which hides double-processing through both listeners. */
function emitAll(type: string, data: unknown): void {
  const callbacks = mocks.fakeBus._reg.get(type)
  if (!callbacks) return
  for (const cb of [...callbacks]) cb(data)
}

describe('stop-then-resend race: stale terminal must not double-append the new run', () => {
  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.fakeBus._reg.clear()
    mocks.fakeBus.connected = true
    if (!('localStorage' in globalThis)) {
      const store = new Map<string, string>()
      ;(globalThis as any).localStorage = {
        getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
        setItem: (k: string, v: string) => { store.set(k, v) },
        removeItem: (k: string) => { store.delete(k) },
        clear: () => store.clear(),
        key: () => null,
        length: 0,
      }
    }
    vi.useFakeTimers()
    const { useChatStore } = await import('@/stores/chatStore')
    useChatStore.setState({
      activeSessionId: SID,
      sessions: [{
        id: SID, character_id: 'c1', session_type: 'chat',
        messages: [{ id: 'm0', role: 'user', content: '第一句', timestamp: Date.now() }],
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

  it('fresh first run, then a consecutive second run, never doubles', async () => {
    const { useChatStore } = await import('@/stores/chatStore')
    const send = useChatStore.getState().sendMessage

    // 第一条：从干净状态开始
    await send('你好')
    const runId1 = (mocks.fakeBus.emit.mock.calls.find(c => c[0] === 'chat-run')?.[1] as { run_id?: string })?.run_id || ''
    emitAll('run.started', { session_id: SID, run_id: runId1, type: 'run.started' } as RunEvent)
    emitAll('message.delta', { session_id: SID, run_id: runId1, delta: '我是码仔', type: 'message.delta' } as RunEvent)
    emitAll('message.delta', { session_id: SID, run_id: runId1, delta: '，你的助手', type: 'message.delta' } as RunEvent)
    vi.advanceTimersByTime(60)
    let asst = useChatStore.getState().sessions[0].messages.filter(m => (m as any).role === 'assistant')
    expect((asst[asst.length - 1] as any).content).toBe('我是码仔，你的助手')
    emitAll('message.metrics', { session_id: SID, run_id: runId1, type: 'message.metrics' } as RunEvent)

    // 第二条：同会话连续发送，不得带上一条的残留/翻倍
    await send('再发一条')
    const runId2 = (mocks.fakeBus.emit.mock.calls
      .filter(c => c[0] === 'chat-run')
      .map(c => (c[1] as { run_id?: string }).run_id).pop() || '')
    emitAll('run.started', { session_id: SID, run_id: runId2, type: 'run.started' } as RunEvent)
    emitAll('message.delta', { session_id: SID, run_id: runId2, delta: '第二段回复', type: 'message.delta' } as RunEvent)
    vi.advanceTimersByTime(60)
    asst = useChatStore.getState().sessions[0].messages.filter(m => (m as any).role === 'assistant')
    expect((asst[asst.length - 1] as any).content).toBe('第二段回复')
  })

  it('new conversation (create + switch) first run never doubles', async () => {
    const { useChatStore } = await import('@/stores/chatStore')
    // 新建一个会话并切换过去（对应 UI 的“新会话”按钮）
    await useChatStore.getState().createSession()
    const newId = useChatStore.getState().sessions.find(s => s.id !== SID)?.id
    expect(newId).toBeTruthy()
    await useChatStore.getState().switchSession(newId!)
    expect(useChatStore.getState().activeSessionId).toBe(newId)

    await useChatStore.getState().sendMessage('你好')
    const runId = (mocks.fakeBus.emit.mock.calls
      .filter(c => c[0] === 'chat-run')
      .map(c => (c[1] as { run_id?: string }).run_id).pop() || '')
    emitAll('run.started', { session_id: newId, run_id: runId, type: 'run.started' } as RunEvent)
    emitAll('message.delta', { session_id: newId, run_id: runId, delta: '新会话回复', type: 'message.delta' } as RunEvent)
    vi.advanceTimersByTime(60)
    const s = useChatStore.getState().sessions.find(x => x.id === newId)!
    const asst = s.messages.filter(m => (m as any).role === 'assistant')
    expect((asst[asst.length - 1] as any).content).toBe('新会话回复')
  })

  it('terminal of the aborted run landing after the new send must not double the new text', async () => {
    const { useChatStore } = await import('@/stores/chatStore')
    const send = useChatStore.getState().sendMessage

    // 第 1 次发送：run1 开始正常流式
    await send('第一句')
    const runId1 = (mocks.fakeBus.emit.mock.calls.find(c => c[0] === 'chat-run')?.[1] as { run_id?: string })?.run_id || ''
    expect(runId1).toBeTruthy()
    emitAll('run.started', { session_id: SID, run_id: runId1, type: 'run.started' } as RunEvent)
    emitAll('message.delta', { session_id: SID, run_id: runId1, delta: '第一段', type: 'message.delta' } as RunEvent)
    vi.advanceTimersByTime(60)
    let msgs = useChatStore.getState().sessions[0].messages
    expect((msgs[msgs.length - 1] as any).content).toBe('第一段')

    // 用户点停止：abort 发出，run1 的终态尚未回来
    useChatStore.getState().abortRun()
    expect(useChatStore.getState()._activeRunId).toBe(runId1)

    // 用户立刻发新消息：run2 开始流式
    await send('第二句')
    const runId2 = (mocks.fakeBus.emit.mock.calls
      .filter(c => c[0] === 'chat-run')
      .map(c => (c[1] as { run_id?: string }).run_id).pop() || '')
    expect(runId2).not.toBe(runId1)
    expect(useChatStore.getState()._activeRunId).toBe(runId2)
    emitAll('run.started', { session_id: SID, run_id: runId2, type: 'run.started' } as RunEvent)

    // ⚠ run1 的 run.cancelled 此刻才到：它属于旧 run，不应重置 run2 的运行状态
    emitAll('run.cancelled', { session_id: SID, run_id: runId1, type: 'run.cancelled', status: 'cancelled' } as RunEvent)

    // ⚠ run1 的迟到 delta 也必须被忽略，不能混进 run2 的消息
    emitAll('message.delta', { session_id: SID, run_id: runId1, delta: '旧run残留', type: 'message.delta' } as RunEvent)
    vi.advanceTimersByTime(60)

    // run2 继续输出：每个 chunk 只能被追加一次
    emitAll('message.delta', { session_id: SID, run_id: runId2, delta: '你好', type: 'message.delta' } as RunEvent)
    emitAll('message.delta', { session_id: SID, run_id: runId2, delta: '，我是雷姆', type: 'message.delta' } as RunEvent)
    vi.advanceTimersByTime(60)

    msgs = useChatStore.getState().sessions[0].messages
    const assistants = msgs.filter(m => (m as any).role === 'assistant')
    const last = assistants[assistants.length - 1] as any
    // 关键断言：不得出现“你好你好，我是雷姆，我是雷姆”这类重复，也不得夹带旧 run 残留
    expect(last.content).toBe('你好，我是雷姆')
  })

  it('the 10s abort safety timer must not null the streaming state of a newer run', async () => {
    const { useChatStore } = await import('@/stores/chatStore')
    const send = useChatStore.getState().sendMessage

    await send('第一句')
    const runId1 = (mocks.fakeBus.emit.mock.calls.find(c => c[0] === 'chat-run')?.[1] as { run_id?: string })?.run_id || ''
    useChatStore.getState().abortRun()
    // 终态事件从未到达（服务端进程重启等）：10s 安全定时器兜底
    await send('第二句')
    const runId2 = (mocks.fakeBus.emit.mock.calls
      .filter(c => c[0] === 'chat-run')
      .map(c => (c[1] as { run_id?: string }).run_id).pop() || '')
    expect(useChatStore.getState()._activeRunId).toBe(runId2)

    // 定时器触发
    vi.advanceTimersByTime(10_100)

    // run2 仍在流式：_activeRunId 不能被重置，否则后续 delta 被双写
    emitAll('message.delta', { session_id: SID, run_id: runId2, delta: '只有一份', type: 'message.delta' } as RunEvent)
    vi.advanceTimersByTime(60)
    const msgs = useChatStore.getState().sessions[0].messages
    const assistants = msgs.filter(m => (m as any).role === 'assistant')
    const last = assistants[assistants.length - 1] as any
    expect(last.content).toBe('只有一份')
  })
})