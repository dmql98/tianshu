import { Hono, type Context } from 'hono'
import { serve } from '@hono/node-server'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { Server } from 'socket.io'
import { readFile, stat } from 'fs/promises'
import { extname, join, normalize, relative, resolve, isAbsolute as pathIsAbsolute } from 'path'
import { registerChatSocket } from './ws/chat.js'
import providersRouter from './routes/providers.js'
import sessionsRouter from './routes/sessions.js'
import charactersRouter from './routes/characters.js'
import skillsRouter from './routes/skills.js'
import toolsRouter from './routes/tools.js'
import workspaceRouter from './routes/workspace.js'
import evolutionRouter from './routes/evolution.js'
import promptsRouter from './routes/prompts.js'
import configRouter from './routes/config.js'
import messagesRouter from './routes/messages.js'
import eventDefinitionsRouter from './routes/event-definitions.js'
import goalsRouter, { setGoalRuntime } from './routes/goals.js'
import runsRouter, { setRunsRuntime } from './routes/runs.js'
import themesRouter, { initThemeStore } from './routes/themes.js'
import iconPacksRouter from './routes/iconpacks.js'
import eventsRouter from './routes/events.js'
import { setTransportIo } from './transport/runtime.js'
import { setEventDefinitionRuntime } from './event/event-run-adapter.js'
import { getDb, closeDb } from './db/schema.js'
import { init as initTools } from './tools/registry.js'
import { startEventScheduler, stopEventScheduler } from './event/event-scheduler.js'
import { startAssetGC, stopAssetGC } from './character/asset-gc.js'
import { runStore } from './agent/runtime/run-store.js'
import { forceCancelSessionRuns, recoverContinuationState } from './agent/runtime/run-event-store.js'
import { startRunStallWatchdog } from './agent/runtime/run-stall-watchdog.js'

export interface StartServerOptions {
  host?: string
  port?: number
  clientDist?: string
  corsOrigins?: string[]
}

export interface TianshuServer {
  host: string
  port: number
  url: string
  close(): Promise<void>
}

const DEV_CORS_ORIGINS = ['http://127.0.0.1:3457', 'http://localhost:3457']

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
}

/** Loopback-only origin check. The server is bound to 127.0.0.1, so only
 *  origins served from this machine are legitimate (covers dynamic ports). */
function isLoopbackOrigin(origin: string | undefined): boolean {
  if (!origin) return true
  try {
    const hostname = new URL(origin).hostname
    return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]'
  } catch {
    return false
  }
}

function serveClientHandler(clientDist: string) {
  const root = resolve(clientDist)
  return async (c: Context) => {
    const method = c.req.method
    if (method !== 'GET' && method !== 'HEAD') {
      return c.json({ error: 'Not found' }, 404)
    }
    const reqPath = c.req.path
    // API and Socket.IO traffic is never served as static files.
    if (reqPath.startsWith('/api') || reqPath.startsWith('/socket.io')) {
      return c.json({ error: 'Not found' }, 404)
    }
    let urlPath: string
    try {
      urlPath = decodeURIComponent(reqPath)
    } catch {
      return c.json({ error: 'Bad request' }, 400)
    }
    urlPath = urlPath.replace(/\\/g, '/')

    // Resolve against clientDist and reject any `..` escape attempts.
    const filePath = normalize(join(root, urlPath))
    const rel = relative(root, filePath)
    if (rel.startsWith('..') || pathIsAbsolute(rel)) {
      return c.json({ error: 'Forbidden' }, 403)
    }

    let fileStat
    try {
      fileStat = await stat(filePath)
    } catch {
      fileStat = null
    }
    if (fileStat && fileStat.isFile()) {
      const buf = await readFile(filePath)
      const ext = extname(filePath).toLowerCase()
      c.header('Content-Type', MIME[ext] || 'application/octet-stream')
      if (urlPath.startsWith('/assets/')) {
        c.header('Cache-Control', 'public, max-age=31536000, immutable')
      } else {
        c.header('Cache-Control', 'no-cache')
      }
      return c.body(new Uint8Array(buf))
    }

    // SPA fallback: unmatched GET (non-API, non-asset) serves index.html so
    // React Router deep links work after a refresh. Missing asset files 404.
    if (urlPath.startsWith('/assets/')) {
      return c.json({ error: 'Not found' }, 404)
    }
    try {
      const indexPath = join(root, 'index.html')
      const st = await stat(indexPath)
      if (st.isFile()) {
        const buf = await readFile(indexPath)
        c.header('Content-Type', 'text/html; charset=utf-8')
        c.header('Cache-Control', 'no-cache')
        return c.body(new Uint8Array(buf))
      }
    } catch {
      /* fall through */
    }
    return c.json({ error: 'Not found' }, 404)
  }
}

export async function startTianshuServer(
  options: StartServerOptions = {},
): Promise<TianshuServer> {
  const host = options.host || '127.0.0.1'
  const port = options.port ?? 3456
  const clientDist = options.clientDist
  const corsOrigins = options.corsOrigins && options.corsOrigins.length > 0
    ? options.corsOrigins
    : DEV_CORS_ORIGINS

  // Initialize DB and tool registry before serving traffic.
  getDb()
  try {
    await initTools()
  } catch (err) {
    console.error('[registry] Tool init failed:', err)
  }
  // Reclaim orphaned runs left behind by a previous process. Approval/ask
  // waits live only in-memory, so after a restart any run still parked in
  // awaiting_approval/awaiting_input/paused is dead: without this sweep the
  // client would keep showing the session as "working" forever.
  {
    const db = getDb()
    const orphaned = db.prepare(`
      SELECT session_id FROM runs
      WHERE status IN ('awaiting_approval','awaiting_input','paused')
    `).all() as Array<{ session_id: string }>
    const reclaimed = new Set<string>()
    for (const row of orphaned) {
      if (reclaimed.has(row.session_id)) continue
      reclaimed.add(row.session_id)
      const cancelled = forceCancelSessionRuns(row.session_id, 'orphaned_after_restart')
      if (cancelled.length > 0) {
        console.log(`[startup] reclaimed ${cancelled.length} orphaned run(s) for session ${row.session_id}`)
      }
    }
  }
  // Continuation chain recovery (§11.4): interrupt orphaned running/preparing
  // runs and repair missing `run.queued` durable events. Never re-executes
  // tools or resurrects historical max_turns runs.
  {
    const { interrupted, repairedEvents, cancelledQueued } = recoverContinuationState()
    if (interrupted.length > 0) console.log(`[startup] interrupted ${interrupted.length} orphaned run(s)`)
    if (repairedEvents.length > 0) console.log(`[startup] repaired ${repairedEvents.length} queued run event(s)`)
    if (cancelledQueued.length > 0) console.log(`[startup] cancelled ${cancelledQueued.length} orphaned queued run(s)`)
  }

  const app = new Hono()

  // Production is same-origin (loopback dynamic port): no CORS middleware.
  // Development (vite proxy at :3457) gets a strict loopback allowlist.
  if (!clientDist) {
    app.use('*', cors({ origin: corsOrigins }))
  }
  app.use('*', logger())

  app.route('/api/providers', providersRouter)
  app.route('/api/sessions', sessionsRouter)
  app.route('/api/characters', charactersRouter)
  app.route('/api/skills', skillsRouter)
  app.route('/api/tools', toolsRouter)
  app.route('/api/workspace', workspaceRouter)
  app.route('/api/evolution-config', evolutionRouter)
  app.route('/api/prompts', promptsRouter)
  app.route('/api/config', configRouter)
  app.route('/api/runs', runsRouter)
  app.route('/api/messages', messagesRouter)
  app.route('/api/event-definitions', eventDefinitionsRouter)
  app.route('/api/goals', goalsRouter)
  app.route('/api/themes', themesRouter)
  app.route('/api/iconpacks', iconPacksRouter)
  app.route('/api/events', eventsRouter)
  app.get('/health', (c) => c.json({ ok: true }))

  // Any unmatched /api path must return JSON 404, not the SPA shell.
  app.get('/api/*', (c) => c.json({ error: 'Not found' }, 404))

  if (clientDist) {
    app.get('*', serveClientHandler(clientDist))
  }

  const httpServer = await new Promise<ReturnType<typeof serve>>((resolveServer, reject) => {
    const srv = serve(
      {
        fetch: app.fetch,
        hostname: host,
        port,
      },
      () => {
        resolveServer(srv)
      },
    )
    srv.on('error', reject)
  })

  const address = httpServer.address()
  const actualPort = typeof address === 'object' && address ? address.port : port
  const url = `http://${host}:${actualPort}`

  const io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => callback(null, isLoopbackOrigin(origin)),
      methods: ['GET', 'POST'],
    },
    maxHttpBufferSize: 50 * 1024 * 1024,
    // Keep-alive tuning for the localhost desktop/dev carrier:
    // - pingInterval 25s (default) keeps the socket alive;
    // - pingTimeout 60s tolerates event-loop stalls (DB, asset GC, LLM
    //   streaming) without dropping clients — the 20s default kicks sockets
    //   whenever the process is busy that long, which reads as random
    //   disconnects;
    // - connectTimeout guards the initial handshake on a busy restart.
    pingInterval: 25_000,
    pingTimeout: 60_000,
    connectTimeout: 15_000,
  })
  setEventDefinitionRuntime(io)
  setGoalRuntime(io)
  setRunsRuntime(io)
  setTransportIo(io)
  io.on('connection', (socket) => registerChatSocket(io, socket))
  startEventScheduler(io)
  startAssetGC()
  // Interrupt runs that stopped making progress (hung tool / MCP / LLM path),
  // so a stalled run can never pin the UI in thinking/speaking forever.
  const stopStallWatchdog = startRunStallWatchdog(io)
  initThemeStore()

  let closed = false

  const withTimeout = (fn: (done: () => void) => void, ms: number) =>
    new Promise<void>((resolveDone) => {
      const timer = setTimeout(resolveDone, ms)
      fn(() => {
        clearTimeout(timer)
        resolveDone()
      })
    })

  return {
    host,
    port: actualPort,
    url,
    close: async () => {
      if (closed) return
      closed = true
      // Order: timers → Socket.IO → HTTP server → DB.
      stopEventScheduler()
      stopAssetGC()
      stopStallWatchdog()
      await withTimeout((done) => {
        try {
          io.close(() => done())
        } catch {
          done()
        }
      }, 5000)
      await withTimeout((done) => {
        try {
          const closeAll = (httpServer as unknown as { closeAllConnections?: () => void }).closeAllConnections
          closeAll?.()
          httpServer.close(() => done())
        } catch {
          done()
        }
      }, 5000)
      closeDb()
    },
  }
}
