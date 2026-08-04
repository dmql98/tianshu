import { randomUUID } from 'crypto'
import { getDb } from '../db/schema.js'
import { nextFireTime } from './cron-parser.js'

export interface EventDefinitionRow {
  id: string
  name: string
  type: 'once' | 'cron'
  cron_expr: string | null
  timezone: string
  instruction: string
  character_id: string
  revision_policy: 'follow_latest' | 'pinned'
  pinned_character_revision_id: string | null
  assigned_group: string | null
  provider_id: string | null
  model: string | null
  workspace: string | null
  approval_mode: string
  execution_mode: string
  overlap_policy: 'skip' | 'queue'
  status: 'active' | 'paused' | 'archived'
  next_fire_at: number | null
  created_at: number
  updated_at: number
}

export const eventDefinitionStore = {
  list(): EventDefinitionRow[] {
    return getDb().prepare(
      'SELECT * FROM event_definitions ORDER BY created_at DESC',
    ).all() as EventDefinitionRow[]
  },
  get(id: string): EventDefinitionRow | null {
    return getDb().prepare('SELECT * FROM event_definitions WHERE id = ?').get(id) as EventDefinitionRow | null
  },
  create(input: Partial<EventDefinitionRow> & Pick<EventDefinitionRow, 'name' | 'instruction' | 'character_id' | 'type'>): EventDefinitionRow {
    if (input.type === 'cron' && !input.cron_expr) throw new Error('cron_expr is required for cron events')
    const now = Date.now()
    let nextFireAt = input.next_fire_at ?? null
    if (input.type === 'cron' && input.cron_expr) {
      try {
        nextFireAt = nextFireTime(input.cron_expr, input.timezone || 'Asia/Shanghai', { fromMs: now })
      } catch (error: any) {
        throw new Error(`Invalid cron expression: ${error.message}`)
      }
    }
    const row: EventDefinitionRow = {
      id: input.id || `edef_${randomUUID()}`,
      name: input.name,
      type: input.type,
      cron_expr: input.cron_expr || null,
      timezone: input.timezone || 'Asia/Shanghai',
      instruction: input.instruction,
      character_id: input.character_id,
      revision_policy: input.revision_policy || 'follow_latest',
      pinned_character_revision_id: input.pinned_character_revision_id || null,
      assigned_group: input.assigned_group || null,
      provider_id: input.provider_id || null,
      model: input.model || null,
      workspace: input.workspace || null,
      approval_mode: input.approval_mode || 'Ask Risky',
      execution_mode: input.execution_mode || 'direct',
      overlap_policy: input.overlap_policy || 'skip',
      status: input.status || 'active',
      next_fire_at: nextFireAt,
      created_at: now,
      updated_at: now,
    }
    getDb().prepare(`
      INSERT INTO event_definitions (
        id, name, type, cron_expr, timezone, instruction, character_id,
        revision_policy, pinned_character_revision_id, assigned_group,
        provider_id, model, workspace, approval_mode, execution_mode,
        overlap_policy, status, next_fire_at, created_at, updated_at
      ) VALUES (
        @id, @name, @type, @cron_expr, @timezone, @instruction, @character_id,
        @revision_policy, @pinned_character_revision_id, @assigned_group,
        @provider_id, @model, @workspace, @approval_mode, @execution_mode,
        @overlap_policy, @status, @next_fire_at, @created_at, @updated_at
      )
    `).run(row)
    return row
  },

  update(id: string, patch: Partial<EventDefinitionRow>): EventDefinitionRow | null {
    const existing = this.get(id)
    if (!existing) return null
    const updated: EventDefinitionRow = { ...existing, ...patch, updated_at: Date.now() }
    getDb().prepare(`
      UPDATE event_definitions SET
        name = @name, type = @type, cron_expr = @cron_expr, timezone = @timezone,
        instruction = @instruction, character_id = @character_id,
        revision_policy = @revision_policy, pinned_character_revision_id = @pinned_character_revision_id,
        assigned_group = @assigned_group, provider_id = @provider_id, model = @model,
        workspace = @workspace, approval_mode = @approval_mode, execution_mode = @execution_mode,
        overlap_policy = @overlap_policy, status = @status, next_fire_at = @next_fire_at,
        updated_at = @updated_at
      WHERE id = @id
    `).run(updated)
    return updated
  },

  /**
   * Compare-and-swap the next fire time. Returns true only when the stored
   * value still equals `expected`, which makes concurrent scheduler ticks
   * single-winner.
   */
  casNextFireAt(id: string, expected: number, next: number): boolean {
    const result = getDb().prepare(
      'UPDATE event_definitions SET next_fire_at = ?, updated_at = ? WHERE id = ? AND next_fire_at = ?',
    ).run(next, Date.now(), id, expected)
    return result.changes === 1
  },

  /** Definitions whose cron time has come due (active only). */
  due(now: number): EventDefinitionRow[] {
    return getDb().prepare(
      "SELECT * FROM event_definitions WHERE status = 'active' AND type = 'cron' AND next_fire_at IS NOT NULL AND next_fire_at <= ? ORDER BY next_fire_at ASC LIMIT 50",
    ).all(now) as EventDefinitionRow[]
  },
}
