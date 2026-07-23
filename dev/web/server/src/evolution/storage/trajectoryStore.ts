import { getDb } from '../../db/schema.js'
import type { TrajectoryRow, CreateTrajectoryInput } from '../../event/types.js'

export const trajectoryStore = {
  getRecent(days = 7): TrajectoryRow[] {
    const cutoff = Date.now() - days * 86400000
    return getDb().prepare('SELECT * FROM trajectories WHERE created_at >= ? ORDER BY created_at ASC').all(cutoff) as TrajectoryRow[]
  },

  getBySession(sessionId: string): TrajectoryRow | null {
    return getDb().prepare('SELECT * FROM trajectories WHERE session_id = ?').get(sessionId) as TrajectoryRow | null
  },

  save(input: CreateTrajectoryInput): TrajectoryRow {
    const now = Date.now()
    const row: TrajectoryRow = {
      id: input.id,
      session_id: input.session_id,
      agent_id: input.agent_id,
      user_goal: input.user_goal || null,
      tool_calls: input.tool_calls ? JSON.stringify(input.tool_calls) : null,
      summary: input.summary || null,
      success_rate: input.success_rate ?? null,
      created_at: now,
    }
    getDb().prepare(`INSERT INTO trajectories (id, session_id, agent_id, user_goal, tool_calls, summary, success_rate, created_at) VALUES (@id, @session_id, @agent_id, @user_goal, @tool_calls, @summary, @success_rate, @created_at)`).run(row)
    return row
  },

  deleteBySession(sessionId: string): boolean {
    return getDb().prepare('DELETE FROM trajectories WHERE session_id = ?').run(sessionId).changes > 0
  },
}
