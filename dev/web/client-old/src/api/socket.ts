import { io, Socket } from 'socket.io-client'

let socket: Socket | null = null

const WS_URL = import.meta.env.VITE_API_URL || undefined

export function getSocket(): Socket {
  if (!socket) {
    socket = io(WS_URL, { transports: ['websocket', 'polling'], autoConnect: false })
  }
  return socket
}

export function connectSocket() { const s = getSocket(); if (!s.connected) s.connect(); return s }
export function disconnectSocket() { socket?.disconnect(); socket = null }

export type Strategy = 'Plan' | 'Ask' | 'Bypass'

export interface RunEvent {
  session_id: string
  delta?: string
  reasoning?: string
  tool_call_id?: string
  tool_name?: string
  tool_input?: string
  tool_output?: string
  tool_status?: string
  output?: string
  error?: string
  usage?: { input_tokens: number; output_tokens: number }
  strategy?: Strategy
  status?: string
  cache?: { hitTokens: number; missTokens: number; hitRatio: string }
}
