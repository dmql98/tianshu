import { getDb } from './schema.js'

export interface MessageRow {
  id: number; session_id: string; role: string; content: string
  reasoning_content: string | null
  tool_name: string | null; tool_input: string | null
  tool_output: string | null; tool_status: string | null
  attachments: string | null
  token_speed: number | null
  turn_id: string | null
  run_id: string | null
  status: 'active' | 'superseded'
  supersedes_message_id: number | null
  created_at: number
}

export const messageStore = {
  getMessages(sessionId: string, limit = 1000): MessageRow[] {
    const rows = getDb().prepare(
      "SELECT * FROM messages WHERE session_id = ? AND status = 'active' ORDER BY id DESC LIMIT ?",
    ).all(sessionId, limit) as MessageRow[]
    return rows.reverse()
  },
  getById(id: number): MessageRow | null {
    return getDb().prepare('SELECT * FROM messages WHERE id = ?').get(id) as MessageRow | null
  },
  getMessageCount(sessionId: string): number {
    const r = getDb().prepare('SELECT COUNT(*) as c FROM messages WHERE session_id = ?').get(sessionId) as { c: number }
    return r.c
  },
  keepFirst(sessionId: string, count: number) {
    if (count === 0) {
      getDb().prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId)
      return
    }
    const ids = getDb().prepare('SELECT id FROM messages WHERE session_id = ? ORDER BY id ASC LIMIT ?').all(sessionId, count) as { id: number }[]
    if (ids.length < count) return
    getDb().prepare('DELETE FROM messages WHERE session_id = ? AND id > ?').run(sessionId, ids[ids.length - 1].id)
  },
  updateContent(id: number, content: string) {
    getDb().prepare('UPDATE messages SET content = ? WHERE id = ?').run(content, id)
  },
  addMessage(sessionId: string, data: Partial<MessageRow> & { role: string }): MessageRow {
    // Write-time guard: assistant tool calls persisted to durable history must
    // have canonical (JSON-parseable) function.arguments. Half-serialized or
    // otherwise invalid arguments must never enter history (msocwg0bciq5x4).
    if (data.role === 'assistant' && data.tool_input) {
      try {
        const calls = JSON.parse(data.tool_input)
        if (Array.isArray(calls)) {
          for (const call of calls) {
            if (!call?.function?.arguments) continue
            JSON.parse(call.function.arguments) // throws if not valid JSON
          }
        }
      } catch (err: any) {
        throw new Error(`Refusing to persist invalid assistant tool call: ${err?.message || err}`)
      }
    }
    const now = Date.now()
    const row: MessageRow = {
      id: 0, session_id: sessionId, role: data.role, content: data.content || '',
      reasoning_content: data.reasoning_content || null,
      tool_name: data.tool_name || null, tool_input: data.tool_input || null,
      tool_output: data.tool_output || null, tool_status: data.tool_status || null,
      attachments: data.attachments || null,
      token_speed: data.token_speed ?? null,
      turn_id: data.turn_id || null,
      run_id: data.run_id || null,
      status: data.status || 'active',
      supersedes_message_id: data.supersedes_message_id || null,
      created_at: now,
    }
    const result = getDb().prepare(`INSERT INTO messages (session_id, role, content, reasoning_content, tool_name, tool_input, tool_output, tool_status, attachments, token_speed, turn_id, run_id, status, supersedes_message_id, created_at) VALUES (@session_id, @role, @content, @reasoning_content, @tool_name, @tool_input, @tool_output, @tool_status, @attachments, @token_speed, @turn_id, @run_id, @status, @supersedes_message_id, @created_at)`).run(row)
    row.id = Number(result.lastInsertRowid)
    getDb().prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now, sessionId)
    return row
  },
  copyFirst(sourceSessionId: string, targetSessionId: string, count: number): number {
    if (count <= 0) return 0
    const result = getDb().prepare(`
      INSERT INTO messages (
        session_id, role, content, reasoning_content, tool_name, tool_input,
        tool_output, tool_status, attachments, token_speed, turn_id, run_id,
        status, supersedes_message_id, created_at
      )
      SELECT ?, role, content, reasoning_content, tool_name, tool_input,
        tool_output, tool_status, attachments, token_speed, turn_id, run_id,
        status, supersedes_message_id, created_at
      FROM messages
      WHERE session_id = ?
      ORDER BY id ASC
      LIMIT ?
    `).run(targetSessionId, sourceSessionId, count)
    getDb().prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(Date.now(), targetSessionId)
    return result.changes
  },
}
