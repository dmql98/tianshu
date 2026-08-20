import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RunEvent } from '@/types'

const mocks = vi.hoisted(() => {
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

function emitAll(type: string, data: unknown): void {
  const callbacks = mocks.fakeBus._reg.get(type)
  if (!callbacks) return
  for (const cb of [...callbacks]) cb(data)
}

function lastRunId(): string {
  const calls = (mocks.fakeBus.emit.mock.calls as [string, any][])
    .filter(c => c[0] === 'chat-run')
  const last = calls[calls.length - 1]
  return (last?.[1] as { run_id?: string })?.run_id || ''
}

describe('repro: first reply doubling in real event flow', () => {
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
        messages: [],
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

  it('first message reasoning + content never doubles', async () => {
    const { useChatStore } = await import('@/stores/chatStore')
    const send = useChatStore.getState().sendMessage

    await send('你好')
    const runId = lastRunId()
    expect(runId).toBeTruthy()

    emitAll('run.started', { session_id: SID, run_id: runId, type: 'run.started' } as RunEvent)
    // reasoning chunks
    emitAll('message.delta', { session_id: SID, run_id: runId, reasoning: '用户只是', type: 'message.delta' } as RunEvent)
    emitAll('message.delta', { session_id: SID, run_id: runId, reasoning: '打了个招呼', type: 'message.delta' } as RunEvent)
    // content chunks
    emitAll('message.delta', { session_id: SID, run_id: runId, delta: '你好', type: 'message.delta' } as RunEvent)
    vi.advanceTimersByTime(60)
    emitAll('message.metrics', { session_id: SID, run_id: runId, message_id: 42, type: 'message.metrics' } as RunEvent)
    emitAll('run.completed', { session_id: SID, run_id: runId, type: 'run.completed' } as RunEvent)

    const msgs = useChatStore.getState().sessions[0].messages
    const asst = msgs.filter(m => (m as any).role === 'assistant')
    expect(asst.length).toBe(1)
    expect((asst[0] as any).content).toBe('你好')
    expect((asst[0] as any).reasoning).toBe('用户只是打了个招呼')
  })

  it('second message after natural completion never doubles', async () => {
    const { useChatStore } = await import('@/stores/chatStore')
    const send = useChatStore.getState().sendMessage

    await send('第一句')
    const runId1 = lastRunId()
    emitAll('run.started', { session_id: SID, run_id: runId1, type: 'run.started' } as RunEvent)
    emitAll('message.delta', { session_id: SID, run_id: runId1, delta: '第一段回复', type: 'message.delta' } as RunEvent)
    vi.advanceTimersByTime(60)
    emitAll('message.metrics', { session_id: SID, run_id: runId1, message_id: 42, type: 'message.metrics' } as RunEvent)
    emitAll('run.completed', { session_id: SID, run_id: runId1, type: 'run.completed' } as RunEvent)
    vi.advanceTimersByTime(60)

    await send('第二句')
    const runId2 = lastRunId()
    expect(runId2).not.toBe(runId1)
    emitAll('run.started', { session_id: SID, run_id: runId2, type: 'run.started' } as RunEvent)
    emitAll('message.delta', { session_id: SID, run_id: runId2, reasoning: '思考两', type: 'message.delta' } as RunEvent)
    emitAll('message.delta', { session_id: SID, run_id: runId2, delta: '第二段回复', type: 'message.delta' } as RunEvent)
    vi.advanceTimersByTime(60)
    emitAll('message.metrics', { session_id: SID, run_id: runId2, message_id: 43, type: 'message.metrics' } as RunEvent)
    emitAll('run.completed', { session_id: SID, run_id: runId2, type: 'run.completed' } as RunEvent)

    const msgs = useChatStore.getState().sessions[0].messages
    const asst = msgs.filter(m => (m as any).role === 'assistant')
    expect(asst.length).toBe(2)
    expect((asst[0] as any).content).toBe('第一段回复')
    expect((asst[1] as any).content).toBe('第二段回复')
    expect((asst[1] as any).reasoning).toBe('思考两')
  })
})