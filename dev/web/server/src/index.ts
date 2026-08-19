import { startTianshuServer, type TianshuServer } from './app.js'

// The IPC message shapes below match dev/shared/server-ipc.ts (ServerMessage /
// DesktopMessage), which is the single source of truth consumed by the desktop
// shell. Guarded by web/server/test/ipc-contract.test.ts.
let server: TianshuServer | null = null
let shuttingDown = false

async function shutdown(code: number): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  try {
    if (server) await server.close()
  } catch (err) {
    console.error('[shutdown] error while closing server:', err)
  }
  process.exit(code)
}

process.on('message', (message: unknown) => {
  const msg = message as { type?: string } | null
  if (msg?.type !== 'shutdown') return
  void shutdown(0)
})

process.on('SIGINT', () => void shutdown(0))
process.on('SIGTERM', () => void shutdown(0))

// Crash is a state Electron can observe: log, attempt a clean close, then exit
// non-zero instead of continuing in a corrupted state.
process.on('uncaughtException', (err) => {
  console.error('[FATAL] uncaughtException:', err)
  void shutdown(1)
})
process.on('unhandledRejection', (err) => {
  console.error('[FATAL] unhandledRejection:', err)
  void shutdown(1)
})

try {
  server = await startTianshuServer({
    host: process.env.HOST || '127.0.0.1',
    port: Number(process.env.PORT || 3456),
    clientDist: process.env.TIANSHU_CLIENT_DIST,
  })
} catch (err) {
  console.error('[FATAL] failed to start server:', err)
  process.exit(1)
}

// Electron IPC transport (renderer ↔ main ↔ this child). Registered whenever
// the process is a child of the desktop shell; a plain `node dist/index.js`
// run simply has no parent to talk to (process.send is undefined → no-op).
if (typeof process.send === 'function') {
  const { registerIpcTransport } = await import('./transport/ipc-server.js')
  registerIpcTransport()
}

if (typeof process.send === 'function') {
  process.send({ type: 'ready', port: server.port })
} else {
  console.log(`TianShu server on http://${server.host}:${server.port}`)
}
