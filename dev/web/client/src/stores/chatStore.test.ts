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

vi.mock('@/api/eventBus', () => ({
  getEventBus: mocks.getEventBus,
}))

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
  createSession: vi.fn(async () => ({})),
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
const RID = 'r1'

function socketHandlers(): Map<string, (data: unknown) => void> {
  const map = new Map<string, (data: unknown) => void>()
  for (const [event, handler] of mocks.fakeBus.on.mock.calls as [string, (data: unknown) => void][]) {
    map.set(event, handler)
  }
  return map
}

function runningState() {
  return {
    sessions: [] as never[],
    activeSessionId: SID,
    isStreaming: true,
    activeRun: { runId: RID, continuationRootRunId: RID, phase: 'running' as const, nextRunId: null, limitWarning: null },
    sessionRuns: {
      [SID]: {
        isStreaming: true,
        activeRun: { runId: RID, continuationRootRunId: RID, phase: 'running' as const, nextRunId: null, limitWarning: null },
        activeRunId: RID,
      },
    },
    _activeRunId: RID,
  }
}

describe('abortRun (stop button)', () => {
  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.fakeBus.connected = true
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps a stopping state until the terminal event instead of flipping back', async () => {
    const { useChatStore } = await import('@/stores/chatStore')
    useChatStore.setState(runningState() as never)

    useChatStore.getState().abortRun()

    // The button stays in "stopping": phase cancelling, still streaming.
    const after = useChatStore.getState()
    expect(after.sessionRuns[SID].activeRun.phase).toBe('cancelling')
    expect(after.isStreaming).toBe(true)
    expect(mocks.fakeBus.emit).toHaveBeenCalledWith('abort', { session_id: SID }, expect.any(Function))
    expect(mocks.cancelRun).not.toHaveBeenCalled()

    // Server acks the abort and then emits the terminal event: state clears.
    const abortAck = mocks.fakeBus.emit.mock.calls.find(c => c[0] === 'abort')?.[2] as (r: unknown) => void
    abortAck?.({ status: 'ok' })
    const handlers = socketHandlers()
    handlers.get('run.cancelled')?.({ session_id: SID, run_id: RID, status: 'cancelled', type: 'run.cancelled' } as RunEvent)

    const settled = useChatStore.getState()
    expect(settled.sessionRuns[SID].activeRun.phase).toBe('idle')
    expect(settled.isStreaming).toBe(false)
    expect(settled.sessionRuns[SID].activeRunId).toBeNull()
  })

  it('falls back to HTTP cancel when the ack reports no active run', async () => {
    const { useChatStore } = await import('@/stores/chatStore')
    useChatStore.setState(runningState() as never)

    useChatStore.getState().abortRun()
    const abortAck = mocks.fakeBus.emit.mock.calls.find(c => c[0] === 'abort')?.[2] as (r: unknown) => void
    abortAck?.({ status: 'no_active_run' })

    expect(mocks.cancelRun).toHaveBeenCalledWith(RID, true)
  })

  it('falls back to HTTP cancel when the socket is not connected', async () => {
    mocks.fakeBus.connected = false
    const { useChatStore } = await import('@/stores/chatStore')
    useChatStore.setState(runningState() as never)

    useChatStore.getState().abortRun()

    expect(mocks.fakeBus.emit).not.toHaveBeenCalled()
    expect(mocks.cancelRun).toHaveBeenCalledWith(RID, true)
    expect(useChatStore.getState().sessionRuns[SID].activeRun.phase).toBe('cancelling')
  })

  it('ignores run.started / run.retrying while the abort is in flight', async () => {
    const { useChatStore } = await import('@/stores/chatStore')
    useChatStore.setState(runningState() as never)

    useChatStore.getState().abortRun()
    const handlers = socketHandlers()

    // A successor run tries to start while we are aborting: must not re-arm.
    handlers.get('run.started')?.({ session_id: SID, run_id: 'r2', type: 'run.started' } as RunEvent)
    handlers.get('run.retrying')?.({ session_id: SID, run_id: 'r2', type: 'run.retrying' } as RunEvent)

    const after = useChatStore.getState()
    expect(after.sessionRuns[SID].activeRun.phase).toBe('cancelling')
    expect(after.sessionRuns[SID].activeRunId).toBe(RID)
    expect(after.isStreaming).toBe(true)
  })

  it('run.interrupted resets the streaming state (stalled-run recovery)', async () => {
    const { useChatStore } = await import('@/stores/chatStore')
    useChatStore.setState(runningState() as never)

    const handlers = socketHandlers()
    handlers.get('run.interrupted')?.({ session_id: SID, run_id: RID, type: 'run.interrupted', reason: 'stalled' } as RunEvent)

    const settled = useChatStore.getState()
    expect(settled.sessionRuns[SID].activeRun.phase).toBe('idle')
    expect(settled.isStreaming).toBe(false)
    expect(settled.sessionRuns[SID].activeRunId).toBeNull()
  })

  it('run.max_turns falls through to the persistent handler when the temporary listener does not cover it', async () => {
    const { useChatStore } = await import('@/stores/chatStore')
    // A temporary listener is active, but it does NOT register run.max_turns —
    // the persistent handler must still process it, otherwise the session
    // stays stuck streaming forever.
    useChatStore.setState({ ...runningState(), _currentCleanup: () => {} } as never)

    const handlers = socketHandlers()
    handlers.get('run.max_turns')?.({ session_id: SID, run_id: RID, type: 'run.max_turns', status: 'max_turns' } as RunEvent)

    const settled = useChatStore.getState()
    expect(settled.sessionRuns[SID].activeRun.phase).toBe('idle')
    expect(settled.isStreaming).toBe(false)
  })

  it('run.interrupted is claimed by the temporary listener when one is active', async () => {
    const { useChatStore } = await import('@/stores/chatStore')
    useChatStore.setState({ ...runningState(), _currentCleanup: () => {} } as never)

    const handlers = socketHandlers()
    handlers.get('run.interrupted')?.({ session_id: SID, run_id: RID, type: 'run.interrupted', reason: 'stalled' } as RunEvent)

// The temporary listener owns run.interrupted in production (it resets +
// cleans up); the persistent handler must not have reset state here.
    expect(useChatStore.getState().sessionRuns[SID].activeRun.phase).toBe('running')
  })
})

describe('stream delta coalescing (50ms window)', () => {
  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.fakeBus.connected = true
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function sessionState() {
    return {
      ...runningState(),
      sessions: [{
        id: SID,
        character_id: 'c1',
        session_type: 'chat',
        messages: [] as never[],
      }] as never[],
    } as never
  }

  it('accumulates multiple deltas and applies them in one update after the window', async () => {
    const { useChatStore } = await import('@/stores/chatStore')
    useChatStore.setState(sessionState())

    const handlers = socketHandlers()
    handlers.get('message.delta')?.({ session_id: SID, run_id: RID, delta: 'Hello', type: 'message.delta' } as RunEvent)
    handlers.get('message.delta')?.({ session_id: SID, run_id: RID, delta: ' world', type: 'message.delta' } as RunEvent)

    // Within the window: nothing applied yet.
    expect(useChatStore.getState().sessions[0].messages).toHaveLength(0)

    vi.advanceTimersByTime(60)

    const msgs = useChatStore.getState().sessions[0].messages
    expect(msgs).toHaveLength(1)
    expect(msgs[0].content).toBe('Hello world')
    expect(msgs[0].is_streaming).toBe(true)
  })

  it('flushes pending deltas before message.metrics so no text is lost', async () => {
    const { useChatStore } = await import('@/stores/chatStore')
    useChatStore.setState(sessionState())

    const handlers = socketHandlers()
    handlers.get('message.delta')?.({ session_id: SID, run_id: RID, delta: 'partial', type: 'message.delta' } as RunEvent)
    // Terminal-ish event arrives before the 50ms window elapses.
    handlers.get('message.metrics')?.({ session_id: SID, run_id: RID, type: 'message.metrics', token_speed: 42 } as RunEvent)

    const msgs = useChatStore.getState().sessions[0].messages
    expect(msgs).toHaveLength(1)
    expect(msgs[0].content).toBe('partial')
    expect(msgs[0].is_streaming).toBe(false)
    expect(msgs[0].token_speed).toBe(42)
  })

  it('buffers tool.output chunks and applies them once per window', async () => {
    const { useChatStore } = await import('@/stores/chatStore')
    const base = sessionState() as { sessions: { id: string; character_id: string; session_type: string; messages: never[] }[] }
    useChatStore.setState({
      ...base,
      sessions: [{
        id: SID,
        character_id: 'c1',
        session_type: 'chat',
        messages: [{
          id: 't1', role: 'tool', content: '', tool_name: 'bash',
          tool_call_id: 'call1', tool_status: 'running', timestamp: Date.now(),
        }] as never[],
      }] as never[],
    } as never)

    const handlers = socketHandlers()
    handlers.get('tool.output')?.({ session_id: SID, run_id: RID, tool_call_id: 'call1', output: 'a', type: 'tool.output' } as RunEvent)
    handlers.get('tool.output')?.({ session_id: SID, run_id: RID, tool_call_id: 'call1', output: 'b', type: 'tool.output' } as RunEvent)
    expect(useChatStore.getState().sessions[0].messages[0].tool_output).toBeUndefined()

    vi.advanceTimersByTime(60)

    expect(useChatStore.getState().sessions[0].messages[0].tool_output).toBe('ab')
  })
})
