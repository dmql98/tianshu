/**
 * Node IPC contract between the Electron main process and the bundled
 * Hono/Socket.IO server child process.
 *
 * The server sends these messages to its parent; the parent sends
 * DesktopMessage back. The server MUST NOT rely on a public shutdown HTTP API.
 */

export type ServerMessage =
  | { type: 'ready'; port: number }
  | { type: 'fatal'; message: string }
  | { type: 'log'; level: string; message: string }

export type DesktopMessage =
  | { type: 'shutdown' }
