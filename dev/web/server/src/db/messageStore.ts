import { getDb } from './schema.js'

export interface MessageRow {
  id: number; session_id: string; role: string; content: string
  reasoning_content: string | null
  tool_name: string | null; tool_input: string | null
  tool_output: string | null; tool_status: string | null
  attachments: string | null
  created_at: number
}

export const messageStore = {
  getMessages(sessionId: string, limit = 200): MessageRow[] {
    return getDb().prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY id ASC LIMIT ?').all(sessionId, limit) as MessageRow[]
  },
  getMessageCount(sessionId: string): number {
    const r = getDb().prepare('SELECT COUNT(*) as c FROM messages WHERE session_id = ?').get(sessionId) as { c: number }
    return r.c
  },
  keepFirst(sessionId: string, count: number) {
    const ids = getDb().prepare('SELECT id FROM messages WHERE session_id = ? ORDER BY id ASC LIMIT ?').all(sessionId, count) as { id: number }[]
    if (ids.length < count) return
    getDb().prepare('DELETE FROM messages WHERE session_id = ? AND id > ?').run(sessionId, ids[ids.length - 1].id)
  },
  updateContent(id: number, content: string) {
    getDb().prepare('UPDATE messages SET content = ? WHERE id = ?').run(content, id)
  },
  addMessage(sessionId: string, data: Partial<MessageRow> & { role: string }): MessageRow {
    const now = Date.now()
    const row: MessageRow = {
      id: 0, session_id: sessionId, role: data.role, content: data.content || '',
      reasoning_content: data.reasoning_content || null,
      tool_name: data.tool_name || null, tool_input: data.tool_input || null,
      tool_output: data.tool_output || null, tool_status: data.tool_status || null,
      attachments: data.attachments || null,
      created_at: now,
    }
    const result = getDb().prepare(`INSERT INTO messages (session_id, role, content, reasoning_content, tool_name, tool_input, tool_output, tool_status, attachments, created_at) VALUES (@session_id, @role, @content, @reasoning_content, @tool_name, @tool_input, @tool_output, @tool_status, @attachments, @created_at)`).run(row)
    row.id = Number(result.lastInsertRowid)
    getDb().prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now, sessionId)
    return row
  },
}
