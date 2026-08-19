/**
 * Shared transport runtime: the socket.io Server instance needed by the
 * transport-neutral handlers (SSE route + Electron IPC server). Socket.io
 * itself stays optional — the Server object is only used for sub-agent /
 * sessionLoop internals that require io.
 */
import type { Server } from 'socket.io'

let ioRef: Server | null = null

export function setTransportIo(io: Server): void {
  ioRef = io
}

export function getTransportIo(): Server {
  if (!ioRef) throw new Error('Transport runtime not ready: setTransportIo() not called')
  return ioRef
}

export function hasTransportIo(): boolean {
  return ioRef !== null
}
