import { getDb } from './schema.js'

export interface SessionRow {
  id: string; character_id: string; title: string
  model: string | null; provider_id: string | null; workspace: string | null
  workspaces: string | null
  parent_id: string | null; active_group: string | null
  session_type: 'chat' | 'event'; event_id: string | null
  current_strategy: string | null
  context_window: number | null
  input_tokens: number; output_tokens: number
  compaction_summary: string | null; compaction_until_id: number | null
  created_at: number; updated_at: number
}

const INSERT_COLS = 'id, character_id, title, model, provider_id, workspace, workspaces, parent_id, active_group, session_type, event_id, current_strategy, context_window, input_tokens, output_tokens, compaction_summary, compaction_until_id, created_at, updated_at'
const INSERT_PARAMS = '@id, @character_id, @title, @model, @provider_id, @workspace, @workspaces, @parent_id, @active_group, @session_type, @event_id, @current_strategy, @context_window, @input_tokens, @output_tokens, @compaction_summary, @compaction_until_id, @created_at, @updated_at'
const UPDATE_COLS = 'character_id=@character_id, title=@title, model=@model, provider_id=@provider_id, workspace=@workspace, workspaces=@workspaces, parent_id=@parent_id, active_group=@active_group, session_type=@session_type, event_id=@event_id, current_strategy=@current_strategy, context_window=@context_window, input_tokens=@input_tokens, output_tokens=@output_tokens, compaction_summary=@compaction_summary, compaction_until_id=@compaction_until_id, updated_at=@updated_at'

export const sessionStore = {
  list(limit = 50): SessionRow[] {
    return getDb().prepare('SELECT * FROM sessions ORDER BY updated_at DESC LIMIT ?').all(limit) as SessionRow[]
  },
  getById(id: string): SessionRow | null {
    return getDb().prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | null
  },
  getChildren(parentId: string): SessionRow[] {
    return getDb().prepare('SELECT * FROM sessions WHERE parent_id = ? ORDER BY created_at ASC').all(parentId) as SessionRow[]
  },
  create(data: Partial<SessionRow> & { id: string }): SessionRow {
    const now = Date.now()
    const workspaces = data.workspaces || (data.workspace ? JSON.stringify([data.workspace]) : null)
    const row: SessionRow = {
      id: data.id, character_id: data.character_id || 'general',
      title: data.title || '', model: data.model || null,
      provider_id: data.provider_id || null, workspace: data.workspace || null,
      workspaces,
      parent_id: data.parent_id || null, active_group: data.active_group || null,
      session_type: data.session_type || 'chat', event_id: data.event_id || null,
      current_strategy: data.current_strategy ?? null,
      context_window: data.context_window ?? null,
      input_tokens: data.input_tokens || 0, output_tokens: data.output_tokens || 0,
      compaction_summary: data.compaction_summary ?? null,
      compaction_until_id: data.compaction_until_id ?? null,
      created_at: now, updated_at: now,
    }
    getDb().prepare(`INSERT INTO sessions (${INSERT_COLS}) VALUES (${INSERT_PARAMS})`).run(row)
    return row
  },
  update(id: string, patch: Partial<SessionRow>): SessionRow | null {
    const existing = this.getById(id)
    if (!existing) return null
    if (patch.workspaces || (patch.workspace && !patch.workspaces)) {
      patch.workspaces = patch.workspaces || JSON.stringify([patch.workspace!])
    }
    const updated = { ...existing, ...patch, updated_at: Date.now() }
    getDb().prepare(`UPDATE sessions SET ${UPDATE_COLS} WHERE id=@id`).run(updated)
    return updated
  },
  delete(id: string): boolean {
    getDb().prepare('DELETE FROM messages WHERE session_id = ?').run(id)
    return getDb().prepare('DELETE FROM sessions WHERE id = ?').run(id).changes > 0
  },
}
