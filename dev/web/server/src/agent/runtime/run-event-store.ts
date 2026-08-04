import { randomUUID } from 'crypto'
import type { Server, Socket } from 'socket.io'
import { getDb } from '../../db/schema.js'
import { runStore, type RunPhase } from './run-store.js'
import { checkpointStore } from './checkpoint-store.js'

export const RAW_SOCKET = Symbol('tianshu.rawSocket')

export interface RunEventRow {
  event_id: string
  run_id: string
  session_id: string
  seq: number
  type: string
  payload: string
  created_at: number
}

const PHASE_BY_EVENT: Array<[RegExp, RunPhase]> = [
  [/^message\.|^run\.retrying$|^usage$|^message\.metrics$/, 'model'],
  [/^tool\.|^approval\./, 'tools'],
  [/^agent_task\.|^sub_agent\./, 'delegate'],
  [/^plan\.|^goal\./, 'verify'],
]

function terminalStatus(type: string, payload: Record<string, unknown>) {
  if (type === 'run.failed') return 'failed' as const
  if (type === 'run.cancelled') return 'cancelled' as const
  if (type === 'run.max_turns') return 'max_turns' as const
  if (type === 'run.budget_exhausted') return 'budget_exhausted' as const
  if (type === 'run.interrupted') return 'interrupted' as const
  if (type !== 'run.completed') return null
  if (payload.status === 'cancelled') return 'cancelled' as const
  if (payload.status === 'max_turns') return 'max_turns' as const
  return 'completed' as const
}

export const runEventStore = {
  list(runId: string, afterSeq = 0, limit = 1000): RunEventRow[] {
    return getDb().prepare(`
      SELECT * FROM run_events
      WHERE run_id = ? AND seq > ?
      ORDER BY seq ASC LIMIT ?
    `).all(runId, afterSeq, limit) as RunEventRow[]
  },

  append(runId: string, type: string, payload: Record<string, unknown>): RunEventRow | null {
    const db = getDb()
    return db.transaction(() => {
      const run = runStore.get(runId)
      if (!run) throw new Error(`Run "${runId}" not found`)
      const terminal = terminalStatus(type, payload)
      if (terminal) {
        const accepted = runStore.finish(runId, terminal, {
          usage: payload.usage,
          result: payload.result,
          error: typeof payload.error === 'string' ? payload.error : undefined,
        })
        if (!accepted) return null
      } else if (type === 'run.started') {
        runStore.transition(runId, 'running', 'model')
      } else if (type === 'approval.requested') {
        runStore.transition(runId, 'awaiting_approval', 'tools')
        checkpointStore.create(runId, {
          reason: 'approval.requested',
          pendingRequest: JSON.stringify(payload),
        })
      } else {
        const current = runStore.get(runId)
        if (current?.status === 'awaiting_approval' && type === 'tool.started') {
          runStore.transition(runId, 'queued', 'tools')
          runStore.transition(runId, 'preparing', 'tools')
          runStore.transition(runId, 'running', 'tools')
        }
        const phase = PHASE_BY_EVENT.find(([pattern]) => pattern.test(type))?.[1]
        if (phase) runStore.setPhase(runId, phase)
      }
      const seqRow = db.prepare(
        'SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM run_events WHERE run_id = ?',
      ).get(runId) as { seq: number }
      const row: RunEventRow = {
        event_id: `reve_${randomUUID()}`,
        run_id: runId,
        session_id: run.session_id,
        seq: seqRow.seq,
        type,
        payload: JSON.stringify(payload),
        created_at: Date.now(),
      }
      db.prepare(`
        INSERT INTO run_events
          (event_id, run_id, session_id, seq, type, payload, created_at)
        VALUES
          (@event_id, @run_id, @session_id, @seq, @type, @payload, @created_at)
      `).run(row)
      return row
    })()
  },
}

export function publishRunEvent(
  target: Pick<Socket | Server, 'emit'>,
  runId: string,
  type: string,
  payload: Record<string, unknown>,
): RunEventRow | null {
  const row = runEventStore.append(runId, type, payload)
  if (!row) return null
  // The transaction above has committed before anything reaches Socket.IO.
  target.emit(type, {
    ...payload,
    event_id: row.event_id,
    session_id: row.session_id,
    run_id: row.run_id,
    seq: row.seq,
    type: row.type,
    occurred_at: row.created_at,
  })
  return row
}

const DURABLE_EVENT = /^(run\.|message\.|tool\.|approval\.|control\.|plan\.|goal\.|agent_task\.|character\.|sub_agent\.|usage$)/

export function createDurableSocket(socket: Socket, runId: string): Socket {
  return new Proxy(socket, {
    get(target, prop, receiver) {
      if (prop === RAW_SOCKET) return target
      if (prop !== 'emit') return Reflect.get(target, prop, receiver)
      return (type: string, payload?: Record<string, unknown>, ...rest: unknown[]) => {
        if (DURABLE_EVENT.test(type) && payload && typeof payload === 'object') {
          return !!publishRunEvent(target, runId, type, { ...payload, run_id: runId })
        }
        return target.emit(type, payload, ...rest)
      }
    },
  })
}

export function unwrapDurableSocket(socket: Socket): Socket {
  return (socket as Socket & { [RAW_SOCKET]?: Socket })[RAW_SOCKET] || socket
}
