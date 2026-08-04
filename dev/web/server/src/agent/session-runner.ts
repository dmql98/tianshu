// Transitional facade: callers use the durable RunCoordinator while the
// remaining Loop components are split into agent/loop in later phases.
import { runCoordinator } from './runtime/run-coordinator.js'

export type RunState = 'idle' | 'running' | 'cancelling'

export function enqueueRun(
  sessionId: string,
  runId: string,
  runFn: (signal: AbortSignal) => Promise<void>,
  cancelQueued?: () => void,
) {
  return runCoordinator.enqueue(sessionId, runId, runFn, cancelQueued)
}

export const abortSession = (sessionId: string) => runCoordinator.cancelSession(sessionId)
export const getRunState = (sessionId: string): RunState => runCoordinator.state(sessionId).state
export const getQueueLength = (sessionId: string): number => runCoordinator.state(sessionId).queueLength
export const totalActiveSessions = () => runCoordinator.totalActiveSessions()
export function cleanupIdleSession(_sessionId: string) { /* coordinator self-cleans */ }

