// Transitional facade: callers use the durable RunCoordinator while the
// remaining Loop components are split into agent/loop in later phases.
import { runCoordinator } from './runtime/run-coordinator.js'
import { sessionStore } from '../db/sessionStore.js'
import { forceCancelSessionRuns } from './runtime/run-event-store.js'

export type RunState = 'idle' | 'running' | 'cancelling'

/**
 * 用户主动取消过的会话集合（含级联取消的子会话）。
 * 用途：子代理回传时若父会话已被用户取消，不再自动唤醒续跑（P3 抑制），
 * 避免「我停了父，子跑完又把我拉起来」。用户在会话内发新消息时清除。
 */
const userCancelledSessions = new Set<string>()

export const isUserCancelled = (sessionId: string): boolean => userCancelledSessions.has(sessionId)
export const clearUserCancelled = (sessionId: string): void => { userCancelledSessions.delete(sessionId) }

export function enqueueRun(
  sessionId: string,
  runId: string,
  runFn: (signal: AbortSignal) => Promise<void>,
  cancelQueued?: () => void,
) {
  return runCoordinator.enqueue(sessionId, runId, runFn, cancelQueued)
}

/** 单会话取消（含标记，供非级联路径使用）。 */
export const abortSession = (sessionId: string) => {
  userCancelledSessions.add(sessionId)
  return runCoordinator.cancelSession(sessionId)
}

/**
 * 级联取消：取消 sessionId 及其所有直接子会话（P5 并行场景：父停止 → 全部子 worker 停止）。
 * 每个被取消的会话：内存 coordinator 取消 + DB 兜底强制终态（非终态 run）。
 * 返回分组列表供调用方广播 force 事件。
 */
export function cancelSessionCascade(sessionId: string): Array<{
  sessionId: string
  accepted: boolean
  forceEvents: Array<{ runId: string; event: import('./runtime/run-event-store.js').RunEventRow }>
}> {
  const ids = [sessionId, ...sessionStore.getChildren(sessionId).map(c => c.id)]
  const out: Array<{
    sessionId: string
    accepted: boolean
    forceEvents: Array<{ runId: string; event: import('./runtime/run-event-store.js').RunEventRow }>
  }> = []
  for (const id of ids) {
    userCancelledSessions.add(id)
    const accepted = runCoordinator.cancelSession(id)
    out.push({ sessionId: id, accepted, forceEvents: forceCancelSessionRuns(id) })
  }
  return out
}

export const getRunState = (sessionId: string): RunState => runCoordinator.state(sessionId).state
export const getQueueLength = (sessionId: string): number => runCoordinator.state(sessionId).queueLength
export const totalActiveSessions = () => runCoordinator.totalActiveSessions()
export function cleanupIdleSession(_sessionId: string) { /* coordinator self-cleans */ }
