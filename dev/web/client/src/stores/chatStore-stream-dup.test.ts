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

describe('streaming thinking text must not duplicate across flush windows', () => {
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
        messages: [{ id: 'm0', role: 'user', content: 'hi', timestamp: Date.now() }],
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

  it('reasoning deltas across two flush windows concatenate exactly once each', async () => {
    const { useChatStore } = await import('@/stores/chatStore')
    const send = useChatStore.getState().sendMessage
    await send('hi')
    const runId = (mocks.fakeBus.emit.mock.calls.find(c => c[0] === 'chat-run')?.[1] as { run_id?: string })?.run_id || ''
    const h = handlers()

    // 第一窗口：思考文本逐词到达（模拟 model 思考输出）
    const words1 = ['用户想', '让我研究', '一下今天', '关于', 'agent skill', '的新闻。']
    for (const w of words1) {
      h.get('message.delta')?.({ session_id: SID, run_id: runId, reasoning: w, type: 'message.delta' } as RunEvent)
    }
    vi.advanceTimersByTime(60)
    let msgs = useChatStore.getState().sessions[0].messages
    let last = msgs[msgs.length - 1]
    expect((last as any).reasoning).toBe('用户想让我研究一下今天关于agent skill的新闻。')
    expect((last as any).reasoning.length).toBe(28)

    // 第二窗口：继续输出，必须只追加一次
    h.get('message.delta')?.({ session_id: SID, run_id: runId, reasoning: '这需要', type: 'message.delta' } as RunEvent)
    h.get('message.delta')?.({ session_id: SID, run_id: runId, reasoning: '搜索最新', type: 'message.delta' } as RunEvent)
    vi.advanceTimersByTime(60)
    msgs = useChatStore.getState().sessions[0].messages
    last = msgs[msgs.length - 1]
    expect((last as any).reasoning).toBe('用户想让我研究一下今天关于agent skill的新闻。这需要搜索最新')
    expect((last as any).reasoning.length).toBe(35)

    // 最终 metrics 结束
    h.get('message.metrics')?.({ session_id: SID, run_id: runId, type: 'message.metrics' } as RunEvent)
    msgs = useChatStore.getState().sessions[0].messages
    last = msgs[msgs.length - 1]
    // 终结后不能出现重复（不能是 44 或 62 之类的翻倍长度）
    expect((last as any).reasoning).toBe('用户想让我研究一下今天关于agent skill的新闻。这需要搜索最新')
  })
})