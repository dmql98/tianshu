import { checkpointStore, type CheckpointRow } from '../runtime/checkpoint-store.js'

/**
 * Checkpoint service: run-loop facing helpers over the persisted checkpoints
 * table (context snapshots, pending approval state).
 */

export interface PendingApprovalState {
  run_id: string
  tool_call_id: string
  tool_name: string
  tool_input: string
}

export const checkpointService = {
  /** Record a context checkpoint for a run (e.g. before a long tool phase). */
  createContext(runId: string, input: {
    messageCursor?: number
    usageSnapshot?: { input_tokens: number; output_tokens: number }
  }): CheckpointRow {
    return checkpointStore.create(runId, {
      reason: 'context',
      messageCursor: input.messageCursor ?? null,
      usageSnapshot: input.usageSnapshot ? JSON.stringify(input.usageSnapshot) : null,
    })
  },

  /** The run's most recent checkpoint. */
  latest(runId: string): CheckpointRow | null {
    return checkpointStore.latestForRun(runId)
  },

  /** Whether the run is parked awaiting a user approval. */
  isAwaitingApproval(runId: string): boolean {
    const latest = checkpointStore.latestForRun(runId)
    return !!latest && latest.reason === 'approval.requested'
  },

  /** Decode the pending approval payload persisted with approval.requested. */
  pendingApproval(runId: string): PendingApprovalState | null {
    const latest = checkpointStore.latestForRun(runId)
    if (!latest || latest.reason !== 'approval.requested' || !latest.pending_request) return null
    try {
      const raw = JSON.parse(latest.pending_request) as Record<string, unknown>
      return {
        run_id: runId,
        tool_call_id: String(raw.tool_call_id || ''),
        tool_name: String(raw.tool_name || 'tool'),
        tool_input: typeof raw.tool_input === 'string' ? raw.tool_input : JSON.stringify(raw.tool_input ?? ''),
      }
    } catch {
      return null
    }
  },

  clear(runId: string, reason?: string): number {
    return checkpointStore.clearForRun(runId, reason)
  },
}
