import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const fakeSocket = {
    connected: false,
    active: true,
    connect: vi.fn(),
    on: vi.fn(),
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
