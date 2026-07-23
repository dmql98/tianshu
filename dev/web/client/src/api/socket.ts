import { io, Socket } from 'socket.io-client'
import type { RunEvent } from '@/types'

let socket: Socket | null = null

export function connectSocket(): Socket {
  if (socket?.connected) return socket

  socket = io(window.location.origin, {
    path: '/socket.io',
    transports: ['websocket', 'polling'],
  })

  socket.on('connect', () => {
    console.log('[Socket] connected')
  })

  socket.on('disconnect', () => {
    console.log('[Socket] disconnected')
  })

  return socket
}

export function getSocket(): Socket | null {
  return socket
}

export type { RunEvent }
