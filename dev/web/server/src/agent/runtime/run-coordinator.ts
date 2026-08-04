import { CancelScope } from '../cancel-scope.js'
import { runStore } from './run-store.js'

interface QueuedRun {
  runId: string
  run: (signal: AbortSignal) => Promise<void>
  cancelQueued?: () => void
}

interface SessionEntry {
  state: 'idle' | 'running' | 'cancelling'
  scope: CancelScope
  activeRunId: string | null
  queue: QueuedRun[]
}

const sessions = new Map<string, SessionEntry>()

function getEntry(sessionId: string): SessionEntry {
  let entry = sessions.get(sessionId)
  if (!entry) {
    entry = {
      state: 'idle',
      scope: new CancelScope(),
      activeRunId: null,
      queue: [],
    }
    sessions.set(sessionId, entry)
  }
  return entry
}

function executeRun(entry: SessionEntry, sessionId: string, queued: QueuedRun) {
  entry.state = 'running'
  entry.activeRunId = queued.runId
  entry.scope = new CancelScope()
  runStore.transition(queued.runId, 'preparing', 'context')
  queued.run(entry.scope.signal).then(
    () => completeRun(sessionId, queued.runId),
    () => completeRun(sessionId, queued.runId),
  )
}

function completeRun(sessionId: string, runId: string) {
  const entry = sessions.get(sessionId)
  if (!entry || entry.activeRunId !== runId) return
  entry.state = 'idle'
  entry.activeRunId = null
  if (entry.queue.length > 0) {
    executeRun(entry, sessionId, entry.queue.shift()!)
  } else {
    sessions.delete(sessionId)
  }
}

export const runCoordinator = {
  enqueue(
    sessionId: string,
    runId: string,
    run: (signal: AbortSignal) => Promise<void>,
    cancelQueued?: () => void,
  ): { queued: boolean; queueLength: number } {
    const entry = getEntry(sessionId)
    if (entry.state === 'idle') {
      executeRun(entry, sessionId, { runId, run, cancelQueued })
      return { queued: false, queueLength: 0 }
    }
    entry.queue.push({ runId, run, cancelQueued })
    return { queued: true, queueLength: entry.queue.length }
  },

  cancelSession(sessionId: string): boolean {
    const entry = sessions.get(sessionId)
    if (!entry) return false
    // Keep the entry and mutex until the active Promise actually settles.
    entry.state = 'cancelling'
    if (entry.activeRunId) runStore.transition(entry.activeRunId, 'cancelling')
    entry.scope.cancel()
    for (const queued of entry.queue.splice(0)) queued.cancelQueued?.()
    return true
  },

  state(sessionId: string) {
    const entry = sessions.get(sessionId)
    return {
      state: entry?.state || 'idle',
      activeRunId: entry?.activeRunId || null,
      queueLength: entry?.queue.length || 0,
    }
  },

  totalActiveSessions(): number {
    let count = 0
    for (const entry of sessions.values()) {
      if (entry.state !== 'idle') count++
    }
    return count
  },
}

