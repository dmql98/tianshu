import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RunEvent } from '@/types'

const mocks = vi.hoisted(() => {
  const fakeSocket = {
    connected: true,
    active: true,
    connect: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  }
  return {
    fakeSocket,
    connectSocket: vi.fn(() => fakeSocket),
    getSocket: vi.fn(() => fakeSocket),
    bumpConnectionGeneration: vi.fn(() => 1),
    isCurrentGeneration: vi.fn(() => true),
    waitForSocketReady: vi.fn(async () => true),
    cancelRun: vi.fn(async () => ({ cancelled: true })),
  }
})

vi.mock('@/api/socket', () => ({
  connectSocket: mocks.connectSocket,
  getSocket: mocks.getSocket,
  bumpConnectionGeneration: mocks.bumpConnectionGeneration,
  isCurrentGeneration: mocks.isCurrentGeneration,
  waitForSocketReady: mocks.waitForSocketReady,
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
  for (const [event, handler] of mocks.fakeSocket.on.mock.calls as [string, (data: unknown) => void][]) {
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
    mocks.fakeSocket.connected = true
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
    expect(mocks.fakeSocket.emit).toHaveBeenCalledWith('abort', { session_id: SID }, expect.any(Function))
    expect(mocks.cancelRun).not.toHaveBeenCalled()

    // Server acks the abort and then emits the terminal event: state clears.
    const abortAck = mocks.fakeSocket.emit.mock.calls.find(c => c[0] === 'abort')?.[2] as (r: unknown) => void
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
    const abortAck = mocks.fakeSocket.emit.mock.calls.find(c => c[0] === 'abort')?.[2] as (r: unknown) => void
    abortAck?.({ status: 'no_active_run' })

    expect(mocks.cancelRun).toHaveBeenCalledWith(RID, true)
  })

  it('falls back to HTTP cancel when the socket is not connected', async () => {
    mocks.fakeSocket.connected = false
    const { useChatStore } = await import('@/stores/chatStore')
    useChatStore.setState(runningState() as never)

    useChatStore.getState().abortRun()

    expect(mocks.fakeSocket.emit).not.toHaveBeenCalled()
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
