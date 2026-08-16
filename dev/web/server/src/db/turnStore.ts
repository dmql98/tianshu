import { randomUUID } from 'crypto'
import { getDb } from './schema.js'
import { withTransaction } from './sqlite-db.js'

export interface TurnRow {
  id: string
  session_id: string
  ordinal: number
  trigger_type: 'user' | 'event' | 'goal' | 'agent_task'
  user_message_id: number | null
  status: 'active' | 'superseded'
  created_at: number
}

export const turnStore = {
  create(sessionId: string, triggerType: TurnRow['trigger_type'] = 'user'): TurnRow {
    const db = getDb()
    return withTransaction(db, () => {
      const next = db.prepare(
        'SELECT COALESCE(MAX(ordinal), 0) + 1 AS ordinal FROM turns WHERE session_id = ?',
      ).get(sessionId) as { ordinal: number }
      const row: TurnRow = {
        id: `turn_${randomUUID()}`,
        session_id: sessionId,
        ordinal: next.ordinal,
        trigger_type: triggerType,
        user_message_id: null,
        status: 'active',
        created_at: Date.now(),
      }
      db.prepare(`
        INSERT INTO turns
          (id, session_id, ordinal, trigger_type, user_message_id, status, created_at)
        VALUES
          (@id, @session_id, @ordinal, @trigger_type, @user_message_id, @status, @created_at)
      `).run(row)
      return row
    })
  },

  attachUserMessage(turnId: string, messageId: number) {
    getDb().prepare('UPDATE turns SET user_message_id = ? WHERE id = ?').run(messageId, turnId)
  },
}

