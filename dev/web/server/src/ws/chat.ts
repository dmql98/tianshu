import { Server, Socket } from 'socket.io'
import { bindLiveSocket, unbindSocketOwner } from '../agent/runtime/run-event-store.js'
import {
  handleHello, handleStrategySet, handleChatRun, handleAbort, handleApprovalRespond,
  socketIoChannel,
} from './handlers.js'

/**
 * socket.io transport adapter: thin wrapper over the transport-neutral handlers
 * in handlers.ts. The same handlers are reused by the SSE (routes/events.ts)
 * and Electron IPC (transport/ipc-server.ts) uplinks.
 */
export function registerChatSocket(io: Server, socket: Socket) {
  // Readiness handshake: the client waits for this ack after (re)connect before
  // replaying session/run state. Also rebinds run-event emission to this
  // (possibly new) socket so live streaming resumes after a reconnect.
  socket.on('app:hello', (data: { session_id?: string } | null, ack?: (resp: unknown) => void) => {
    if (data?.session_id) bindLiveSocket(data.session_id, socket)
    handleHello({ io }, socketIoChannel(socket, ack), data)
  })

  socket.on('disconnect', () => {
    // Drop live-socket bindings owned by this socket so a later reconnect with
    // a new socket re-binds cleanly (and we never emit to a dead socket).
    unbindSocketOwner(socket)
  })

  socket.on('strategy.set', (data: { session_id: string; strategy: unknown }, ack?: (resp: unknown) => void) => {
    handleStrategySet({ io }, socketIoChannel(socket, ack), data)
  })

  socket.on('chat-run', async (data: Record<string, unknown>, ack?: (resp: unknown) => void) => {
    const sessionId = data.session_id as string
    if (sessionId) bindLiveSocket(sessionId, socket)
    await handleChatRun({ io }, socketIoChannel(socket, ack), data)
  })

  socket.on('abort', (data: { session_id?: string }, ack?: (resp: unknown) => void) => {
    handleAbort({ io }, socketIoChannel(socket, ack), data)
  })

  socket.on('approval.respond', (
    data: { session_id?: string; tool_call_id?: string; choice?: string },
    ack?: (resp: unknown) => void,
  ) => {
    handleApprovalRespond({ io }, socketIoChannel(socket, ack), data)
  })
}
