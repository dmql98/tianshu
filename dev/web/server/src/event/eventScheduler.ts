import { eventService } from './eventService.js'
import { executeEvent } from './eventExecutor.js'
import type { Server } from 'socket.io'

let pollTimer: ReturnType<typeof setInterval> | null = null
let isPolling = false
let pendingImmediate = false
let ioRef: Server | null = null

const MAX_CONCURRENT = 5

export function startEventScheduler(io: Server, intervalSec = 10) {
  if (pollTimer) return
  ioRef = io
  const intervalMs = Math.max(1000, intervalSec * 1000)
  console.log('[event-scheduler] Starting (poll every %dms)', intervalMs)
  pollTimer = setInterval(() => poll(), intervalMs)
  poll()
}

export function stopEventScheduler() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  ioRef = null
  isPolling = false
}

export function scheduleImmediate() {
  if (isPolling) { pendingImmediate = true; return }
  poll()
}

export async function triggerAndRun(eventId: string): Promise<boolean> {
  const io = ioRef
  if (!io) return false
  const evt = eventService.getById(eventId)
  if (!evt || evt.status !== 'pending') return false
  eventService.updateStatus(evt.id, 'running')
  io.emit('event:status_changed', { eventId: evt.id, status: 'running' })
  executeEvent(evt, io).catch(async (err) => {
    console.error('[event-scheduler] Event %s failed:', evt.id, err)
    eventService.updateStatus(evt.id, 'failed', { error_log: err.message || String(err) })
    io.emit('event:status_changed', { eventId: evt.id, status: 'failed', error: err.message })
  })
  return true
}

async function poll() {
  if (isPolling) return
  isPolling = true
  try {
    const io = ioRef
    if (!io) return
    const events = eventService.getPending(MAX_CONCURRENT)
    for (const evt of events) {
      eventService.updateStatus(evt.id, 'running')
      io.emit('event:status_changed', { eventId: evt.id, status: 'running' })
      executeEvent(evt, io).catch(async (err) => {
        console.error('[event-scheduler] Event %s failed:', evt.id, err)
        const updated = eventService.incrementRetry(evt.id)
        if (updated) {
          eventService.updateStatus(evt.id, 'failed', { error_log: err.message || String(err) })
        }
        io.emit('event:status_changed', { eventId: evt.id, status: 'failed', error: err.message })
      })
    }
  } finally {
    isPolling = false
    if (pendingImmediate) { pendingImmediate = false; poll() }
  }
}
