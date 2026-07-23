import * as path from 'path'
import type { Server, Socket } from 'socket.io'
import { sessionStore } from '../db/sessionStore.js'
import { messageStore } from '../db/messageStore.js'
import { characterMetaStore } from '../db/characterStore.js'
import { providerStore } from '../db/providerStore.js'
import { sessionLoop } from '../agent/loop.js'
import { enqueueRun } from '../agent/session-runner.js'
import { eventService } from './eventService.js'
import { evolutionConfig } from '../evolution/evolutionConfig.js'
import type { EventRow } from './types.js'

const PROJECT_ROOT = path.resolve(process.cwd(), '..')

function makeFakeSocket(io: Server): Socket {
  return {
    emit: (event: string, ...args: any[]) => { io.emit(event, ...args); return true },
    on: () => {},
    off: () => {},
    id: 'event-scheduler',
  } as any as Socket
}

export async function executeEvent(evt: EventRow, io: Server): Promise<void> {
  const payload = JSON.parse(evt.payload || '{}')
  const instruction = payload.instruction || ''
  const agentId = evt.assigned_agent_id

  const charMeta = characterMetaStore.getById(agentId)
  if (!charMeta) {
    await eventService.updateStatus(evt.id, 'failed', { error_log: `Agent "${agentId}" not found` })
    return
  }

  const sessionId = `evts_${evt.id}_${Date.now()}`

  let providerId: string | null | undefined = evt.provider_id
  let modelName: string | null | undefined = evt.model
  let ws: string | null | undefined = evt.workspace

  if (evt.source_type === 'agent' && evt.source_meta) {
    try {
      const meta = JSON.parse(evt.source_meta)
      if (meta.trigger === 'insight_detected') {
        const cfg = evolutionConfig.get()
        if (cfg.character_id) {
          providerId = cfg.provider_id || providerId || undefined
          modelName = cfg.model || modelName || undefined
          ws = cfg.workspace || ws || PROJECT_ROOT
        }
      }
    } catch {}
  }

  sessionStore.create({
    id: sessionId,
    character_id: agentId,
    title: instruction.slice(0, 50),
    provider_id: providerId || charMeta.provider || undefined,
    model: modelName || charMeta.model || undefined,
    workspace: ws || undefined,
    current_strategy: charMeta.default_strategy || null,
    session_type: 'event',
    event_id: evt.id,
  })

  messageStore.addMessage(sessionId, { role: 'user', content: instruction })

  io.emit('session:new', { sessionId, title: instruction.slice(0, 50), isEvent: true })

  const fakeSocket = makeFakeSocket(io)

  const result = await new Promise<import('../agent/outer.js').RunResult | null>(async (resolve) => {
    enqueueRun(sessionId, async (signal) => {
      const res = await sessionLoop(io, fakeSocket, sessionId, signal).catch(async (err) => {
        console.error('[event-executor] sessionLoop error:', err)
        const updated = eventService.incrementRetry(evt.id)
        if (updated) {
          eventService.updateStatus(evt.id, 'failed', { error_log: err.message || String(err) })
        }
        io.emit('event:status_changed', { eventId: evt.id, status: 'failed', error: err.message })
        return null
      })
      resolve(res)
    })
  })

  if (!result) return
  const msgs = messageStore.getMessages(sessionId, 1)
  const hadRun = msgs.some(m => m.role === 'assistant')

  if (!hadRun && result.status === 'stop') {
    const session = sessionStore.getById(sessionId)
    let errorLog = 'Session exited without LLM call'
    if (session) {
      if (!session.provider_id) errorLog = 'No provider configured for event session'
      else if (!providerStore.getById(session.provider_id)) errorLog = `Provider "${session.provider_id}" not found`
      else if (!session.model) errorLog = 'No model configured for event session'
    }
    await eventService.updateStatus(evt.id, 'failed', { error_log: errorLog })
    io.emit('event:status_changed', { eventId: evt.id, status: 'failed', error: errorLog })
    sessionStore.delete(sessionId)
    return
  }

  const status: import('./types.js').EventStatus = result.status === 'cancelled' ? 'failed' : 'completed'
  const lastMsg = msgs[msgs.length - 1]
  const resultSummary = lastMsg?.content
    ? (typeof lastMsg.content === 'string' ? lastMsg.content.slice(0, 500) : JSON.stringify(lastMsg.content).slice(0, 500))
    : undefined

  if (status === 'completed') {
    const newEvent = eventService.completeAndRequeue(evt.id, { result_summary: resultSummary })
    io.emit('event:status_changed', { eventId: evt.id, status: 'completed', result_summary: resultSummary })
    if (newEvent) {
      io.emit('event:created', newEvent)
    }
  } else {
    await eventService.updateStatus(evt.id, status, { result_summary: resultSummary })
    io.emit('event:status_changed', { eventId: evt.id, status, result_summary: resultSummary })
  }
}
