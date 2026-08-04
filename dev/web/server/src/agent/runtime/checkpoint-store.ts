import { randomUUID } from 'crypto'
import { getDb } from '../../db/schema.js'

export interface CheckpointRow {
  id: string
  run_id: string
  reason: string
  message_cursor: number | null
  context_version: number
  policy_state: string | null
  usage_snapshot: string | null
  pending_request: string | null
  created_at: number
}

export const checkpointStore = {
  create(runId: string, input: {
    reason: string
    messageCursor?: number | null
    policyState?: string | null
    usageSnapshot?: string | null
    pendingRequest?: string | null
  }): CheckpointRow {
    const row: CheckpointRow = {
      id: `chk_${randomUUID()}`,
      run_id: runId,
      reason: input.reason,
      message_cursor: input.messageCursor ?? null,
      context_version: 1,
      policy_state: input.policyState ?? null,
      usage_snapshot: input.usageSnapshot ?? null,
      pending_request: input.pendingRequest ?? null,
      created_at: Date.now(),
    }
    getDb().prepare(`
      INSERT INTO checkpoints
        (id, run_id, reason, message_cursor, context_version, policy_state, usage_snapshot, pending_request, created_at)
      VALUES
        (@id, @run_id, @reason, @message_cursor, @context_version, @policy_state, @usage_snapshot, @pending_request, @created_at)
    `).run(row)
    return row
  },

  latestForRun(runId: string): CheckpointRow | null {
    return getDb().prepare(
      'SELECT * FROM checkpoints WHERE run_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1',
    ).get(runId) as CheckpointRow | null
  },

  listForRun(runId: string): CheckpointRow[] {
    return getDb().prepare(
      'SELECT * FROM checkpoints WHERE run_id = ? ORDER BY created_at ASC',
    ).all(runId) as CheckpointRow[]
  },

  clearForRun(runId: string, reason?: string): number {
    const stmt = reason
      ? getDb().prepare('DELETE FROM checkpoints WHERE run_id = ? AND reason = ?')
      : getDb().prepare('DELETE FROM checkpoints WHERE run_id = ?')
    return reason
      ? stmt.run(runId, reason).changes
      : stmt.run(runId).changes
  },
}
