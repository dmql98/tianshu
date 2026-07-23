import { CancelScope } from './cancel-scope.js'

export type RunState = 'idle' | 'running'

interface QueuedRun {
  run: (signal: AbortSignal) => Promise<void>
}

interface SessionEntry {
  state: RunState
  scope: CancelScope
  queue: QueuedRun[]
}

const sessions = new Map<string, SessionEntry>()

function getEntry(sessionId: string): SessionEntry {
  let entry = sessions.get(sessionId)
  if (!entry) {
    entry = { state: 'idle', scope: new CancelScope(), queue: [] }
    sessions.set(sessionId, entry)
  }
  return entry
}

export function enqueueRun(
  sessionId: string,
  runFn: (signal: AbortSignal) => Promise<void>,
): { signal: AbortSignal } {
  const entry = getEntry(sessionId)

  if (entry.state === 'idle') {
    executeRun(entry, sessionId, runFn)
    return { signal: entry.scope.signal }
  }

  entry.queue.push({ run: runFn })
  return { signal: entry.scope.signal }
}

function executeRun(entry: SessionEntry, sessionId: string, runFn: (signal: AbortSignal) => Promise<void>) {
  entry.state = 'running'
  entry.scope = new CancelScope()
  runFn(entry.scope.signal).then(
    () => completeRun(sessionId),
    () => completeRun(sessionId),
  )
}

function completeRun(sessionId: string) {
  const entry = sessions.get(sessionId)
  if (!entry) return
  entry.state = 'idle'
  if (entry.queue.length > 0) {
    drainQueue(sessionId)
  } else {
    sessions.delete(sessionId)
  }
}

function drainQueue(sessionId: string) {
  const entry = sessions.get(sessionId)
  if (!entry || entry.state !== 'idle') return
  if (entry.queue.length === 0) return
  const next = entry.queue.shift()!
  executeRun(entry, sessionId, next.run)
}

export function abortSession(sessionId: string) {
  const entry = sessions.get(sessionId)
  if (!entry) return
  entry.scope.cancel()
  entry.queue = []
  sessions.delete(sessionId)
}

export function cleanupIdleSession(sessionId: string) {
  const entry = sessions.get(sessionId)
  if (!entry || entry.state !== 'idle') return
  if (entry.queue.length > 0) return
  sessions.delete(sessionId)
}

export function getRunState(sessionId: string): RunState {
  return sessions.get(sessionId)?.state || 'idle'
}

export function getQueueLength(sessionId: string): number {
  return sessions.get(sessionId)?.queue.length || 0
}

export function totalActiveSessions(): number {
  let count = 0
  for (const entry of sessions.values()) {
    if (entry.state === 'running') count++
  }
  return count
}

// Periodically clean stale idle entries
setInterval(() => {
  for (const [id, entry] of sessions) {
    if (entry.state === 'idle' && entry.queue.length === 0) {
      sessions.delete(id)
    }
  }
}, 60000).unref()
