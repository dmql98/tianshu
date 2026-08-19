import type { TransportBroadcaster } from '../transport/runtime.js'
import { eventDefinitionStore, type EventDefinitionRow } from './definition-store.js'
import { eventOccurrenceStore, type EventOccurrenceRow } from './occurrence-store.js'
import { scheduleOccurrence } from './event-run-adapter.js'
import { nextFireTime } from './cron-parser.js'

/**
 * Event scheduler: polls active cron definitions, claims due fires with a
 * compare-and-swap (single winner per fire), creates occurrences, and
 * enforces the definition's overlap policy (skip / queue).
 */

let pollTimer: ReturnType<typeof setInterval> | null = null
let isPolling = false
let pendingImmediate = false

export function startEventScheduler(io: TransportBroadcaster, intervalSec = 10) {
  if (pollTimer) return
  const intervalMs = Math.max(1000, intervalSec * 1000)
  console.log('[event-scheduler] Starting (poll every %dms)', intervalMs)
  pollTimer = setInterval(() => void poll(io), intervalMs)
  void poll(io)
}

export function stopEventScheduler() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  isPolling = false
}

export function scheduleImmediate(io: TransportBroadcaster) {
  if (isPolling) { pendingImmediate = true; return }
  void poll(io)
}

export function claimDue(definition: EventDefinitionRow, now: number): boolean {
  const nextFire = nextFireTime(definition.cron_expr!, definition.timezone, { fromMs: now })
  if (nextFire === null) {
    // Expression can never fire again — park it.
    return eventDefinitionStore.casNextFireAt(definition.id, definition.next_fire_at!, 0)
  }
  return eventDefinitionStore.casNextFireAt(definition.id, definition.next_fire_at!, nextFire)
}

/**
 * Create the occurrence for a due definition and honor the overlap policy:
 * - skip: if an occurrence is already pending/running, drop this fire.
 * - queue: leave the occurrence pending; the running one drains it on finish.
 */
export function fireDefinition(definition: EventDefinitionRow): EventOccurrenceRow | null {
  const now = Date.now()
  const overlapping = eventOccurrenceStore.hasActive(definition.id)
  if (overlapping && definition.overlap_policy === 'skip') {
    const skipped = eventOccurrenceStore.create(definition, {
      triggerType: 'scheduled',
      scheduledFor: now,
    })
    eventOccurrenceStore.markSkipped(skipped.id)
    return null
  }
  const occurrence = eventOccurrenceStore.create(definition, {
    triggerType: 'scheduled',
    scheduledFor: now,
  })
  if (overlapping && definition.overlap_policy === 'queue') {
    // Stays pending; drainQueue picks it up when the running one finishes.
    return occurrence
  }
  scheduleOccurrence(occurrence.id)
  return occurrence
}

async function poll(io: TransportBroadcaster) {
  if (isPolling) return
  isPolling = true
  try {
    const now = Date.now()
    const due = eventDefinitionStore.due(now)
    for (const definition of due) {
      if (!claimDue(definition, now)) continue // another tick won the CAS
      try {
        fireDefinition(definition)
      } catch (error: any) {
        console.error(`[event-scheduler] fire ${definition.id} failed:`, error.message)
      }
    }
  } catch (error: any) {
    console.error('[event-scheduler] poll failed:', error.message)
  } finally {
    isPolling = false
    if (pendingImmediate) { pendingImmediate = false; void poll(io) }
  }
}
