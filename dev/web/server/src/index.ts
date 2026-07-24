import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { Server } from 'socket.io'
import { registerChatSocket } from './ws/chat.js'
import providersRouter from './routes/providers.js'
import sessionsRouter from './routes/sessions.js'
import charactersRouter from './routes/characters.js'
import skillsRouter from './routes/skills.js'
import toolsRouter from './routes/tools.js'
import workspaceRouter from './routes/workspace.js'
import eventsRouter from './routes/events.js'
import evolutionRouter from './routes/evolution.js'
import promptsRouter from './routes/prompts.js'
import { getDb } from './db/schema.js'
import { init as initTools } from './tools/registry.js'
import { startEventScheduler } from './event/index.js'
import { startCronRegistry } from './scheduler/cronRegistry.js'

process.on('uncaughtException', (err) => { console.error('[FATAL]', err) })
process.on('unhandledRejection', (err) => { console.error('[FATAL]', err) })

getDb()

// Tool registry auto-discovers all tool directories with tool.json
initTools().catch(err => console.error('[registry] Tool init failed:', err))

const app = new Hono()
app.use('*', cors())
app.use('*', logger())
app.route('/api/providers', providersRouter)
app.route('/api/sessions', sessionsRouter)
app.route('/api/characters', charactersRouter)
app.route('/api/skills', skillsRouter)
app.route('/api/tools', toolsRouter)
app.route('/api/workspace', workspaceRouter)
app.route('/api/events', eventsRouter)
app.route('/api/evolution-config', evolutionRouter)
app.route('/api/prompts', promptsRouter)
app.get('/health', (c) => c.json({ ok: true }))

const port = Number(process.env.PORT) || 3001
const httpServer = serve({ fetch: app.fetch, port }, () => {
  console.log(`Yi-Lin server on :${port}`)
})
httpServer.on('error', (err: any) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use. Kill the other process or change PORT env var.`)
  } else {
    console.error('Server error:', err)
  }
  process.exit(1)
})

const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  // Desktop app sends attachment bytes (base64) through socket.io directly.
  // A 5 MB photo → ~7 MB base64; accommodate multi-image batches.
  maxHttpBufferSize: 50 * 1024 * 1024,
})
io.on('connection', (socket) => registerChatSocket(io, socket))
startEventScheduler(io)
startCronRegistry()
