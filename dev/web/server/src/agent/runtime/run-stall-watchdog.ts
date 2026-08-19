/**
 * Run stall watchdog.
 *
 * A run can end up non-terminal with no live loop actually executing it:
 * a tool that ignores its abort signal, a hung MCP/HTTP call, a coordinator
 * bug, or a process crash whose recovery ran before the run was created.
 * Without a safety net such a run pins its session's UI (and the presence
 * projector, which derives from the LAST persisted event) in "thinking" /
 * "speaking" / "working" forever — even across client restarts, because the
 * state is server-side.
 *
 * This module periodically sweeps runs that are neither terminal nor parked
 * and interrupts any that stopped making progress (`runs.updated_at` is
 * refreshed on every persisted event via setPhase/transition, so a live run
 * keeps bumping it; a silent one freezes). Interrupting appends a durable
 * `run.interrupted` (or `run.cancelled` for `queued`, which cannot transition
 * to interrupted) event and broadcasts it, so live clients and the presence
 * projector recover immediately.
 */
import type { Server } from 'socket.io'
import { getDb } from '../../db/schema.js'
import { runStore } from './run-store.js'
import { runEventStore } from './run-event-store.js'
import { runCoordinator } from './run-coordinator.js'
import { fanOutToSinks } from '../../transport/event-sinks.js'

const STALL_CHECK_INTERVAL_MS = 60_000

/** No coordinator entry AND silent this long → the run is dead. */
const INACTIVE_STALL_MS = 5 * 60_000

/** The coordinator is actively running it but it has been silent this long. */
const ACTIVE_STALL_MS = 30 * 60_000

const NON_TERMINAL_NON_PARKED = `status NOT IN (
  'completed', 'failed', 'cancelled', 'max_turns', 'budget_exhausted', 'interrupted',
  'awaiting_approval', 'awaiting_input', 'paused'
)`

/**
 * Interrupt every stale run. Returns the ids interrupted (exported for tests).
 * @param io - Socket.IO server used to broadcast the terminal events.
 */
export function sweepStalledRuns(io: Server): string[] {
  const interrupted: string[] = []
  const now = Date.now()
  const rows = getDb().prepare(`SELECT id FROM runs WHERE ${NON_TERMINAL_NON_PARKED}`).all() as Array<{ id: string }>
  for (const { id } of rows) {
    const run = runStore.get(id)
    if (!run) continue
    const coord = runCoordinator.state(run.session_id)
    const live = coord.activeRunId === run.id
      || (run.status === 'queued' && coord.activeRunId !== null)
    const threshold = live ? ACTIVE_STALL_MS : INACTIVE_STALL_MS
    if (now - run.updated_at < threshold) continue
    // `queued` cannot transition to `interrupted`; cancel it instead.
    const type = run.status === 'queued' ? 'run.cancelled' : 'run.interrupted'
    const reason = live ? 'stalled_active' : 'stalled'
    const event = runEventStore.append(run.id, type, {
      ...(type === 'run.cancelled' ? { status: 'cancelled' } : {}),
      reason,
    })
    if (!event) continue
    const envelope = {
      ...JSON.parse(event.payload),
      event_id: event.event_id,
      session_id: event.session_id,
      run_id: event.run_id,
      seq: event.seq,
      type: event.type,
      occurred_at: event.created_at,
    }
    io.emit(type, envelope)
    fanOutToSinks(type, envelope)
    interrupted.push(run.id)
    console.warn(
      `[stall-watchdog] interrupted stalled run ${run.id} (status=${run.status}, live=${String(live)}, silent=${Math.round((now - run.updated_at) / 1000)}s)`,
    )
  }
  return interrupted
}

/** Start the periodic sweep; returns a disposer. */
export function startRunStallWatchdog(io: Server): () => void {
  const timer = setInterval(() => {
    try {
      sweepStalledRuns(io)
    } catch (error) {
      console.error('[stall-watchdog] sweep failed:', error)
    }
  }, STALL_CHECK_INTERVAL_MS)
  // Do not keep the process alive on the sweep timer alone.
  timer.unref?.()
  return () => clearInterval(timer)
}
