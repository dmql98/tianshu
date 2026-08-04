import { randomUUID } from 'crypto'
import { getDb } from '../db/schema.js'
import { resolveCharacterBinding } from '../character/binding-resolver.js'
import { registerAssetRefs } from '../character/asset-refs.js'
import type { EventDefinitionRow } from './definition-store.js'

export interface EventOccurrenceRow {
  id: string
  definition_id: string
  trigger_type: 'scheduled' | 'manual' | 'retry'
  scheduled_for: number
  resolved_revision_id: string
  session_id: string | null
  current_run_id: string | null
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'skipped'
  result: string | null
  error: string | null
  created_at: number
  updated_at: number
}

export const eventOccurrenceStore = {
  list(definitionId: string): EventOccurrenceRow[] {
    return getDb().prepare(
      'SELECT * FROM event_occurrences WHERE definition_id = ? ORDER BY scheduled_for DESC',
    ).all(definitionId) as EventOccurrenceRow[]
  },
  get(id: string): EventOccurrenceRow | null {
    return getDb().prepare('SELECT * FROM event_occurrences WHERE id = ?').get(id) as EventOccurrenceRow | null
  },
  hasActive(definitionId: string): boolean {
    const row = getDb().prepare(
      "SELECT 1 FROM event_occurrences WHERE definition_id = ? AND status IN ('pending', 'running') LIMIT 1",
    ).get(definitionId)
    return !!row
  },
  nextPending(definitionId: string): EventOccurrenceRow | null {
    return getDb().prepare(
      "SELECT * FROM event_occurrences WHERE definition_id = ? AND status = 'pending' ORDER BY scheduled_for ASC LIMIT 1",
    ).get(definitionId) as EventOccurrenceRow | null
  },
  markSkipped(id: string): void {
    getDb().prepare(
      "UPDATE event_occurrences SET status = 'skipped', updated_at = ? WHERE id = ?",
    ).run(Date.now(), id)
  },
  create(definition: EventDefinitionRow, input: {
    triggerType: EventOccurrenceRow['trigger_type']
    scheduledFor?: number
    resolvedRevisionId?: string
  }): EventOccurrenceRow {
    const scheduledFor = input.scheduledFor || Date.now()
    const existing = getDb().prepare(
      'SELECT * FROM event_occurrences WHERE definition_id = ? AND scheduled_for = ?',
    ).get(definition.id, scheduledFor) as EventOccurrenceRow | undefined
    if (existing) return existing
    const resolved = input.resolvedRevisionId || resolveCharacterBinding({
      character_id: definition.character_id,
      character_binding_mode: definition.revision_policy,
      pinned_character_revision_id: definition.pinned_character_revision_id,
    }).revision.id
    const now = Date.now()
    const row: EventOccurrenceRow = {
      id: `eocc_${randomUUID()}`,
      definition_id: definition.id,
      trigger_type: input.triggerType,
      scheduled_for: scheduledFor,
      resolved_revision_id: resolved,
      session_id: null,
      current_run_id: null,
      status: 'pending',
      result: null,
      error: null,
      created_at: now,
      updated_at: now,
    }
    getDb().prepare(`
      INSERT INTO event_occurrences (
        id, definition_id, trigger_type, scheduled_for, resolved_revision_id,
        session_id, current_run_id, status, result, error, created_at, updated_at
      ) VALUES (
        @id, @definition_id, @trigger_type, @scheduled_for, @resolved_revision_id,
        @session_id, @current_run_id, @status, @result, @error, @created_at, @updated_at
      )
    `).run(row)
    // Pin the assets the occurrence's fixed revision references.
    try {
      const revision = getDb().prepare(
        'SELECT snapshot FROM character_revisions WHERE id = ?',
      ).get(resolved) as { snapshot: string } | undefined
      if (revision) {
        const snapshot = JSON.parse(revision.snapshot) as { visual?: Record<string, unknown> | null }
        registerAssetRefs({
          ownerType: 'occurrence',
          ownerId: row.id,
          characterId: definition.character_id,
          visual: snapshot.visual || null,
        })
      }
    } catch { /* best-effort pinning */ }
    return row
  },
}

