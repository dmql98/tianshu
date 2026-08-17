import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const fakeSocket = {
    connected: false,
    active: true,
    connect: vi.fn(),
    on: vi.fn(),
    emit: vi.fn(),
  }
  return { fakeSocket, io: vi.fn(() => fakeSocket) }
})

vi.mock('socket.io-client', () => ({ io: mocks.io }))

describe('connectSocket', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.fakeSocket.connected = false
    mocks.fakeSocket.active = true
    vi.stubGlobal('window', { location: { origin: 'http://localhost:3456' } })
  })

  it('keeps the listener-owning socket while it reconnects', async () => {
    const { connectSocket } = await import('./socket')
    const first = connectSocket()

    expect(connectSocket()).toBe(first)
    expect(mocks.io).toHaveBeenCalledTimes(1)

    mocks.fakeSocket.active = false
    expect(connectSocket()).toBe(first)
    expect(mocks.fakeSocket.connect).toHaveBeenCalledTimes(1)
    expect(mocks.io).toHaveBeenCalledTimes(1)
  })
})

describe('connection generation', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('bumps monotonically and invalidates older generations', async () => {
    const { bumpConnectionGeneration, isCurrentGeneration } = await import('./socket')
    const g1 = bumpConnectionGeneration()
    expect(isCurrentGeneration(g1)).toBe(true)

    const g2 = bumpConnectionGeneration()
    expect(isCurrentGeneration(g1)).toBe(false)
    expect(isCurrentGeneration(g2)).toBe(true)
  })
})

describe('waitForSocketReady', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.fakeSocket.connected = false
  })

  it('resolves true when the server acks app:hello', async () => {
    const { waitForSocketReady } = await import('./socket')
    mocks.fakeSocket.connected = true
    mocks.fakeSocket.emit = vi.fn((_event: string, _data: unknown, ack?: (resp: unknown) => void) => {
      ack?.({ status: 'ok' })
    })

    await expect(waitForSocketReady(mocks.fakeSocket as never, 1_000)).resolves.toBe(true)
    expect(mocks.fakeSocket.emit).toHaveBeenCalledWith('app:hello', {}, expect.any(Function))
  })

  it('resolves false when the socket is not connected', async () => {
    const { waitForSocketReady } = await import('./socket')
    mocks.fakeSocket.connected = false
    await expect(waitForSocketReady(mocks.fakeSocket as never, 100)).resolves.toBe(false)
    expect(mocks.fakeSocket.emit).not.toHaveBeenCalled()
  })

  it('resolves false on ack timeout', async () => {
    const { waitForSocketReady } = await import('./socket')
    mocks.fakeSocket.connected = true
    mocks.fakeSocket.emit = vi.fn()
    vi.useFakeTimers()
    try {
      const pending = waitForSocketReady(mocks.fakeSocket as never, 100)
      vi.advanceTimersByTime(150)
      await expect(pending).resolves.toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
