/**
 * Central registry for in-flight approval prompts. Approval waits are keyed by
 * (sessionId, toolCallId) instead of socket closures, so a client that
 * reconnects can still answer a pending approval without the original socket
 * callback being alive.
 */

export type ApprovalChoice = 'once' | 'always' | 'reject'

interface PendingApproval {
  runId?: string
  resolve: (choice: ApprovalChoice) => void
  timer: ReturnType<typeof setTimeout>
}

const pendingBySession = new Map<string, Map<string, PendingApproval>>()

export const approvalRegistry = {
  register(
    sessionId: string,
    toolCallId: string,
    runId: string | undefined,
    resolve: (choice: ApprovalChoice) => void,
    timeoutMs = 60000,
  ): void {
    let byCall = pendingBySession.get(sessionId)
    if (!byCall) {
      byCall = new Map()
      pendingBySession.set(sessionId, byCall)
    }
    const timer = setTimeout(() => {
      byCall.delete(toolCallId)
      resolve('reject')
    }, timeoutMs)
    byCall.set(toolCallId, { runId, resolve, timer })
  },

  respond(sessionId: string, toolCallId: string, choice: ApprovalChoice): { accepted: boolean; runId?: string } {
    const pending = pendingBySession.get(sessionId)?.get(toolCallId)
    if (!pending) return { accepted: false }
    pendingBySession.get(sessionId)!.delete(toolCallId)
    clearTimeout(pending.timer)
    pending.resolve(choice)
    return { accepted: true, runId: pending.runId }
  },

  hasPending(sessionId: string, toolCallId?: string): boolean {
    const byCall = pendingBySession.get(sessionId)
    if (!byCall) return false
    return toolCallId ? byCall.has(toolCallId) : byCall.size > 0
  },

  pendingFor(sessionId: string): Array<{ tool_call_id: string; run_id?: string }> {
    const byCall = pendingBySession.get(sessionId)
    if (!byCall) return []
    return [...byCall.entries()].map(([tool_call_id, pending]) => ({
      tool_call_id,
      run_id: pending.runId,
    }))
  },

  cancelSession(sessionId: string): void {
    const byCall = pendingBySession.get(sessionId)
    if (!byCall) return
    for (const pending of byCall.values()) {
      clearTimeout(pending.timer)
      pending.resolve('reject')
    }
    pendingBySession.delete(sessionId)
  },
}
