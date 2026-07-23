import { getDb } from '../db/schema.js'
import type { EventRow, EventStatus, CreateEventInput } from './types.js'

function rowToEvent(row: any): EventRow {
  return { ...row }
}

export const eventService = {
  list(filters?: { status?: EventStatus; source_type?: string; limit?: number; offset?: number }): EventRow[] {
    const db = getDb()
    const conditions: string[] = []
    const params: any[] = []
    if (filters?.status) { conditions.push('status = ?'); params.push(filters.status) }
    if (filters?.source_type) { conditions.push('source_type = ?'); params.push(filters.source_type) }
    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : ''
    return db.prepare(`SELECT * FROM events ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, filters?.limit ?? 50, filters?.offset ?? 0) as EventRow[]
  },

  getById(id: string): EventRow | null {
    return getDb().prepare('SELECT * FROM events WHERE id = ?').get(id) as EventRow | null
  },

  create(input: CreateEventInput): EventRow {
    const db = getDb()
    const now = Date.now()
    const id = `evt_${now}_${Math.random().toString(36).slice(2, 8)}`
    const row = {
      id,
      source_type: input.source_type,
      source_id: input.source_id || null,
      source_meta: input.source_meta ? JSON.stringify(input.source_meta) : null,
      assigned_agent_id: input.assigned_agent_id,
      assigned_group_id: input.assigned_group_id || null,
      model: input.model || null,
      provider_id: input.provider_id || null,
      workspace: input.workspace || null,
      type: input.type,
      cron_expr: input.cron_expr || null,
      payload: JSON.stringify(input.payload),
      status: input.status || 'pending',
      priority: input.priority ?? 0,
      scheduled_at: input.scheduled_at ?? now,
      started_at: null,
      finished_at: null,
      result_summary: null,
      error_log: null,
      parent_event_id: input.parent_event_id || null,
      retry_count: 0,
      max_retries: input.max_retries ?? 3,
      created_at: now,
    }
    db.prepare(`INSERT INTO events (id, source_type, source_id, source_meta, assigned_agent_id, assigned_group_id, model, provider_id, workspace, type, cron_expr, payload, status, priority, scheduled_at, started_at, finished_at, result_summary, error_log, parent_event_id, retry_count, max_retries, created_at) VALUES (@id, @source_type, @source_id, @source_meta, @assigned_agent_id, @assigned_group_id, @model, @provider_id, @workspace, @type, @cron_expr, @payload, @status, @priority, @scheduled_at, @started_at, @finished_at, @result_summary, @error_log, @parent_event_id, @retry_count, @max_retries, @created_at)`).run(row)

    return rowToEvent(row)
  },

  updateStatus(id: string, status: EventStatus, extra?: Partial<Pick<EventRow, 'result_summary' | 'error_log' | 'started_at' | 'finished_at' | 'scheduled_at' | 'model' | 'provider_id' | 'workspace'>>): EventRow | null {
    const existing = this.getById(id)
    if (!existing) return null
    const now = Date.now()
    const patch: Record<string, any> = { status, ...extra }
    if (status === 'running' && !existing.started_at) patch.started_at = now
    if (status === 'completed' || status === 'failed' || status === 'archived') patch.finished_at = now
    const updated = { ...existing, ...patch }
    getDb().prepare(`UPDATE events SET status=@status, started_at=@started_at, finished_at=@finished_at, scheduled_at=@scheduled_at, result_summary=@result_summary, error_log=@error_log, retry_count=@retry_count, model=@model, provider_id=@provider_id, workspace=@workspace WHERE id=@id`).run(updated)
    return updated
  },

  incrementRetry(id: string): EventRow | null {
    const existing = this.getById(id)
    if (!existing) return null
    if (existing.retry_count >= existing.max_retries) {
      this.updateStatus(id, 'failed', { error_log: 'Max retries exceeded' })
      return null
    }
    getDb().prepare('UPDATE events SET retry_count = retry_count + 1 WHERE id = ?').run(id)
    return { ...existing, retry_count: existing.retry_count + 1 }
  },

  archive(id: string): boolean {
    return getDb().prepare("UPDATE events SET status='archived', finished_at=? WHERE id=?").run(Date.now(), id).changes > 0
  },

  archiveOld(hours: number): number {
    const cutoff = Date.now() - hours * 3600 * 1000
    const result = getDb().prepare("UPDATE events SET status='archived' WHERE status IN ('completed','failed') AND finished_at IS NOT NULL AND finished_at < ?").run(cutoff)
    return result.changes
  },

  completeAndRequeue(id: string, extra?: Partial<Pick<EventRow, 'result_summary'>>): EventRow | null {
    const existing = this.getById(id)
    if (!existing) return null
    this.updateStatus(id, 'completed', extra)
    if (existing.type === 'cron' && existing.cron_expr) {
      return this.create({
        source_type: existing.source_type as 'user' | 'agent' | 'system',
        source_id: existing.source_id || undefined,
        assigned_agent_id: existing.assigned_agent_id,
        assigned_group_id: existing.assigned_group_id || undefined,
        model: existing.model || undefined,
        provider_id: existing.provider_id || undefined,
        workspace: existing.workspace || undefined,
        type: 'cron',
        cron_expr: existing.cron_expr,
        payload: JSON.parse(existing.payload),
        parent_event_id: existing.parent_event_id || undefined,
        priority: existing.priority,
        max_retries: existing.max_retries,
      })
    }
    return null
  },

  delete(id: string): boolean {
    return getDb().prepare('DELETE FROM events WHERE id = ?').run(id).changes > 0
  },

  getPending(limit = 5): EventRow[] {
    const now = Date.now()
    return getDb().prepare(`SELECT * FROM events WHERE status = 'pending' AND (scheduled_at IS NULL OR scheduled_at <= ?) ORDER BY priority DESC, scheduled_at ASC LIMIT ?`).all(now, limit) as EventRow[]
  },
}
