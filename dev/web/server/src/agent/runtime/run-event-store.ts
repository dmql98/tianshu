import { randomUUID } from 'crypto'
import type { TransportBroadcaster } from '../../transport/runtime.js'
import { getDb } from '../../db/schema.js'
import { withTransaction } from '../../db/sqlite-db.js'
import { runStore, isParked, type RunPhase } from './run-store.js'
import { checkpointStore } from './checkpoint-store.js'
import { fanOutToSinks } from '../../transport/event-sinks.js'

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
    return withTransaction(db, () => {
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
        // A run parked on approval/input/pause resumes as soon as real tool
        // or model activity arrives. Note `tool.started` is emitted BEFORE
        // `approval.requested` for a single call, so the resuming signal is
        // usually the post-approval `tool.output` / `tool.completed` — the
        // resume must accept any activity, not just a fresh `tool.started`.
        if (current && isParked(current.status) && /^(tool\.|message\.)/.test(type)) {
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
    })
  },
}

export function publishRunEvent(
  target: TransportBroadcaster,
  runId: string,
  type: string,
  payload: Record<string, unknown>,
): RunEventRow | null {
  const row = runEventStore.append(runId, type, payload)
  if (!row) return null
  // The packaged desktop server is a forked Node child. Send approval prompts
  // directly to Electron's main process as well as the sinks so a suspended or
  // disconnected renderer cannot hide a request that is blocking the run.
  if (type === 'approval.requested' && typeof process.send === 'function') {
    const session = getDb().prepare('SELECT title FROM sessions WHERE id = ?').get(row.session_id) as
      | { title?: string }
      | undefined
    try {
      process.send({
        type: 'approval-required',
        sessionId: row.session_id,
        runId: row.run_id,
        toolCallId: typeof payload.tool_call_id === 'string' ? payload.tool_call_id : '',
        sessionTitle: session?.title,
        toolName: typeof payload.tool_name === 'string' ? payload.tool_name : undefined,
        approvalKind: payload.approval_kind === 'workspace' ? 'workspace' : 'risk',
      })
    } catch {
      /* desktop IPC may already be closing; sink delivery still proceeds */
    }
  }
  // The transaction above has committed before anything reaches a transport.
  // Delivery is transport-neutral: emit to the run's target AND fan out to
  // every registered sink (SSE connections + Electron IPC).
  const envelope = {
    ...payload,
    event_id: row.event_id,
    session_id: row.session_id,
    run_id: row.run_id,
    seq: row.seq,
    type: row.type,
    occurred_at: row.created_at,
  }
  target.emit(type, envelope)
  // Sinks receive the same envelope; errors are contained inside fanOutToSinks.
  fanOutToSinks(type, envelope)
  return row
}

const DURABLE_EVENT = /^(run\.|message\.|tool\.|approval\.|control\.|plan\.|goal\.|agent_task\.|character\.|sub_agent\.|usage$|ask_user$)/

export function createDurableSocket(socket: TransportBroadcaster, runId: string): TransportBroadcaster {
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

export function unwrapDurableSocket(socket: TransportBroadcaster): TransportBroadcaster {
  return (socket as TransportBroadcaster & { [RAW_SOCKET]?: TransportBroadcaster })[RAW_SOCKET] || socket
}

/** Force a run to the terminal `cancelled` state at the DB level, bypassing
 *  any in-memory coordinator entry. Returns the persisted terminal event (or
 *  null if the run was already terminal / unknown). Callers must still publish
 *  it through the durable socket to notify clients. */
export function forceCancelRun(runId: string, reason = 'user_requested'): RunEventRow | null {
  const run = runStore.get(runId)
  if (!run) return null
  return runEventStore.append(runId, 'run.cancelled', { status: 'cancelled', reason })
}

/** Force-cancel every non-terminal run of a session (e.g. one stuck in
 *  `awaiting_approval` with no live coordinator entry after a restart). */
export function forceCancelSessionRuns(sessionId: string, reason = 'user_requested'): Array<{ runId: string; event: RunEventRow }> {
  const cancelled: Array<{ runId: string; event: RunEventRow }> = []
  for (const run of runStore.listForSession(sessionId, 50)) {
    if (isTerminalStatus(run.status)) continue
    const event = forceCancelRun(run.id, reason)
    if (event) cancelled.push({ runId: run.id, event })
  }
  return cancelled
}

function isTerminalStatus(status: string): boolean {
  return ['completed', 'failed', 'cancelled', 'max_turns', 'budget_exhausted', 'interrupted'].includes(status)
}

/**
 * Startup recovery for the continuation chain (§11.4). Runs at boot, before any
 * traffic, so a previous process crash cannot leave the durable event log and
 * run rows inconsistent.
 *
 * Returns a summary of what was repaired.
 */
export function recoverContinuationState(): { interrupted: string[]; repairedEvents: string[]; cancelledQueued: string[] } {
  const interrupted: string[] = []
  const repairedEvents: string[] = []
  const cancelledQueued: string[] = []

  // 1. Orphaned running/preparing/cancelling runs (their in-memory coordinator
  //    + run closures died with the previous process). Mark interrupted rather
  //    than re-executing tools — never duplicate side effects. append()
  //    performs the status transition to `interrupted` and persists the event.
  const orphans = getDb().prepare(
    `SELECT id FROM runs WHERE status IN ('running', 'preparing', 'cancelling')`,
  ).all() as Array<{ id: string }>
  for (const row of orphans) {
    const event = runEventStore.append(row.id, 'run.interrupted', { reason: 'orphaned_after_restart' })
    if (event) interrupted.push(row.id)
  }

  // 2. Repair missing `run.queued` durable events for queued runs (mapping
  //    exists in runs, but the event row was lost). Idempotent.
  const queued = getDb().prepare(
    `SELECT id FROM runs WHERE status = 'queued'`,
  ).all() as Array<{ id: string }>
  for (const row of queued) {
    const hasQueued = getDb().prepare(
      `SELECT 1 FROM run_events WHERE run_id = ? AND type = 'run.queued' LIMIT 1`,
    ).get(row.id)
    if (!hasQueued) {
      runEventStore.append(row.id, 'run.queued', {
        run_id: row.id,
        status: 'queued',
      })
      repairedEvents.push(row.id)
    }
  }

  // 3. Cancel orphaned queued runs: the coordinator that would have started
  //    them died with the previous process, so they will never execute. Without
  //    this, a queued run stays non-terminal forever and re-sticks the client
  //    (resumeActiveRun treats any non-terminal run as "running").
  for (const row of queued) {
    const event = runEventStore.append(row.id, 'run.cancelled', { status: 'cancelled', reason: 'orphaned_after_restart' })
    if (event) cancelledQueued.push(row.id)
  }

  return { interrupted, repairedEvents, cancelledQueued }
}
