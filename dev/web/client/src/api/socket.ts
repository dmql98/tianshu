import { io, Socket } from 'socket.io-client'
import type { RunEvent } from '@/types'

let socket: Socket | null = null

// Connection generation: bumped on every connect/disconnect so in-flight
// replay results from a dead connection generation can be discarded instead of
// overwriting fresh state (the same generation-guard idea deepseek-harness
// uses for its reconnect loop).
let connectionGeneration = 0

/** Start a new connection generation; returns its id. */
export function bumpConnectionGeneration(): number {
  return ++connectionGeneration
}

/** Whether `gen` is still the live connection generation. */
export function isCurrentGeneration(gen: number): boolean {
  return gen === connectionGeneration
}

export function connectSocket(): Socket {
  // Keep one Socket for the lifetime of the renderer. Socket.IO preserves the
  // listeners on this instance while its manager reconnects. Replacing a
  // temporarily disconnected instance strands all chat stream listeners on
  // the old Socket and makes live output stop until the app is restarted.
  if (socket) {
    if (!socket.connected && !socket.active) socket.connect()
    return socket
  }

  socket = io(window.location.origin, {
    path: '/socket.io',
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,
    reconnectionDelayMax: 5000,
    timeout: 10000,
  })

  socket.on('connect', () => {
    console.log('[Socket] connected')
  })

  socket.on('disconnect', reason => {
    console.log('[Socket] disconnected:', reason)
    // A server-requested disconnect disables Socket.IO's automatic retry.
    // The desktop server can restart underneath the renderer, so retry it too.
    if (reason === 'io server disconnect') socket?.connect()
  })

  return socket
}

export function getSocket(): Socket | null {
  return socket
}

const READY_ACK_TIMEOUT_MS = 5_000

/**
 * Readiness handshake: emit `app:hello` and wait for the server's ack (added
 * in ws/chat.ts). Resolves true when the server answered `{ status: 'ok' }`;
 * resolves false on timeout or a disconnected socket so callers never block
 * the reconnect replay forever (e.g. an older server without the handler).
 */
export function waitForSocketReady(
  socket: Socket,
  timeoutMs: number = READY_ACK_TIMEOUT_MS,
): Promise<boolean> {
  return new Promise((resolve) => {
    if (!socket.connected) {
      resolve(false)
      return
    }
    let settled = false
    const done = (ok: boolean): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(ok)
    }
    const timer = setTimeout(() => done(false), timeoutMs)
    socket.emit('app:hello', {}, (resp: unknown) => {
      done(typeof resp === 'object' && resp !== null && (resp as { status?: string }).status === 'ok')
    })
  })
}

export type { RunEvent }
