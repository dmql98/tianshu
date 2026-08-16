import { io, Socket } from 'socket.io-client'
import type { RunEvent } from '@/types'

let socket: Socket | null = null

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

export type { RunEvent }
