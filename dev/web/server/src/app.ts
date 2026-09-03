import { Hono, type Context } from 'hono'
import { serve } from '@hono/node-server'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { readFile, stat } from 'fs/promises'
import { extname, join, normalize, relative, resolve, isAbsolute as pathIsAbsolute } from 'path'
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
import preferencesRouter from './routes/preferences.js'
import skinsRouter from './routes/skins.js'
import statisticsRouter from './routes/statistics.js'
import pricingRouter from './routes/pricing.js'
import { providerOAuthRoutes, createProviderOAuthService } from './routes/provider-oauth.js'
import { setTransportBroadcaster, createBroadcaster } from './transport/runtime.js'
import { setEventDefinitionRuntime } from './event/event-run-adapter.js'
import { getDb, closeDb } from './db/schema.js'
import { acquireServerLock, type ServerLock } from './db/server-lock.js'
import { getDataDir } from './config.js'
import { init as initTools } from './tools/registry.js'
import { startEventScheduler, stopEventScheduler } from './event/event-scheduler.js'
import { startAssetGC, stopAssetGC } from './character/asset-gc.js'
import { runStore } from './agent/runtime/run-store.js'
import { forceCancelSessionRuns, recoverContinuationState } from './agent/runtime/run-event-store.js'
import { sweepDataRetention } from './db/data-retention.js'
import { materializeAllBuiltinContent, materializeSummary } from './content/materialize-builtin.js'
import { migrateAllCharacterVisualsToSkin } from './skin/migrate.js'
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
    // API traffic is never served as static files.
    if (reqPath.startsWith('/api')) {
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

  // M0.3：独立启动（node dist/index.js / desktop shell）时获取 dataDir 排他锁，
  // 防止两个实例同时打开并写同一个 sessions.db（WAL 多连接 + 启动 sweep 互踩）。
  // 测试进程经 TIANSHU_DISABLE_SERVER_LOCK=1 跳过（见 test/setup-data-dir.ts）；
  // 获取失败会抛错 → 启动即失败并给出友好提示（见 server-lock.ts）。
  let serverLock: ServerLock | null = null
  if (process.env.TIANSHU_DISABLE_SERVER_LOCK !== '1') {
    serverLock = acquireServerLock(getDataDir())
  }

  // Initialize DB and tool registry before serving traffic.
  getDb()
  try {
    await initTools()
  } catch (err) {
    console.error('[registry] Tool init failed:', err)
  }
  // 启动时把 builtin/content 全量物化到 dataDir：用户层副本始终存在，
  // 技能/角色指南的路径可统一指向 <dataDir>。幂等、不覆盖用户修改。
  {
    const result = materializeAllBuiltinContent()
    console.log(materializeSummary(result))
  }
  // 皮肤解耦：把现有角色的 visual 抽取为 <dataDir>/skin/<id>/ 皮肤并绑定角色
  // （SKIN_DECOUPLE_PLAN）。幂等；在 builtin 物化之后执行，确保角色齐全。
  {
    const result = migrateAllCharacterVisualsToSkin()
    console.log(`[startup] migrated ${result.migrated} character visual(s) to skin, skipped ${result.skipped}`)
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
  // Diagnostic-data retention: run_events / llm_calls 只在删除会话时级联清理，
  // 长时间使用会无界增长。启动时按窗口清理已终态 run 的旧事件与旧 LLM 快照
  // （默认 30 天，TSS_RUN_EVENTS_RETENTION_DAYS / TSS_LLM_CALLS_RETENTION_DAYS
  // 可调，设 0 禁用）。放在 recover 之后：刚被标记 interrupted 的孤儿 run 是
  // 新时间戳，绝不会被本次 sweep 误删。
  {
    const retention = sweepDataRetention()
    if (retention.runEventsRemoved > 0 || retention.llmCallsRemoved > 0) {
      console.log(
        `[startup] retention sweep removed ${retention.runEventsRemoved} run event(s), ` +
        `${retention.llmCallsRemoved} llm call(s) ` +
        `(run_events ${retention.runEventsRetentionDays}d, llm_calls ${retention.llmCallsRetentionDays}d)`,
      )
    }
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
  app.route('/api/preferences', preferencesRouter)
  app.route('/api/skins', skinsRouter)
  app.route('/api/statistics', statisticsRouter)
  app.route('/api/pricing', pricingRouter)
  app.route('/api/provider-oauth', providerOAuthRoutes(createProviderOAuthService()))
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

  // Transport runtime: the run path only needs an emit-capable broadcaster
  // whose events fan out to the registered sinks (SSE connections + Electron
  // IPC). No heartbeat, no reconnect, no stream lifecycle to manage.
  const broadcaster = createBroadcaster()
  setEventDefinitionRuntime(broadcaster)
  setGoalRuntime(broadcaster)
  setRunsRuntime(broadcaster)
  setTransportBroadcaster(broadcaster)
  startEventScheduler(broadcaster)
  startAssetGC()
  // Interrupt runs that stopped making progress (hung tool / MCP / LLM path),
  // so a stalled run can never pin the UI in thinking/speaking forever.
  const stopStallWatchdog = startRunStallWatchdog(broadcaster)
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
      // Order: timers → HTTP server → DB.
      stopEventScheduler()
      stopAssetGC()
      stopStallWatchdog()
      await withTimeout((done) => {
        try {
          httpServer.close(() => done())
        } catch {
          // Some Node/ESM combos make http.Server.close() throw reading an unset
          // internal symbol (kConnections). Force-close connections and the
          // underlying handle so the port is released regardless.
          try { (httpServer as unknown as { closeAllConnections?: () => void }).closeAllConnections?.() } catch { /* ignore */ }
          try { (httpServer as unknown as { _handle?: { close(): void } })._handle?.close() } catch { /* ignore */ }
          done()
        }
      }, 5000)
      closeDb()
      // 释放排他锁（幂等；close 多次/并发调用安全）。
      serverLock?.release()
    },
  }
}
