/**
 * Run: npx tsx src/event/event-scheduler.test.ts
 *
 * Covers: CAS claim (single winner), occurrence idempotency on
 * (definition_id, scheduled_for), overlap skip / queue semantics, and the
 * next-fire computation used by the scheduler.
 */

import { randomUUID } from 'crypto'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const tmpData = mkdtempSync(join(tmpdir(), 'tianshu-events-'))
process.env.TIANSHU_DATA_DIR = tmpData

const { getDb, closeDb } = await import('../db/schema.js')
const { eventDefinitionStore } = await import('./definition-store.js')
const { eventOccurrenceStore } = await import('./occurrence-store.js')
const { claimDue, fireDefinition } = await import('./event-scheduler.js')

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${message}`)
}

const db = getDb()
const NOW = Date.now()

function seedCharacter(characterId: string, revisionId: string) {
  db.prepare(`
    INSERT INTO character_definitions (id, current_revision_id, status, created_at, updated_at)
    VALUES (?, ?, 'active', ?, ?)
  `).run(characterId, revisionId, NOW, NOW)
  db.prepare(`
    INSERT INTO character_revisions (id, character_id, revision_no, manifest_hash, snapshot, visual_manifest, created_at)
    VALUES (?, ?, 1, 'h', '{}', NULL, ?)
  `).run(revisionId, characterId, NOW)
}

function makeDefinition(overrides: Record<string, unknown> = {}) {
  return eventDefinitionStore.create({
    name: 'cron-test',
    type: 'cron',
    cron_expr: '0 * * * *',
    instruction: 'run',
    character_id: 'char_test',
    ...overrides,
  } as any)
}

seedCharacter('char_test', 'rev_test')

try {
  // ---- create computes next_fire_at for cron definitions -------------------
  {
    const def = makeDefinition({ cron_expr: '30 9 * * *' })
    assert(def.next_fire_at !== null && def.next_fire_at > NOW, 'next_fire_at computed on create')
    let threw = false
    try { eventDefinitionStore.create({ name: 'x', type: 'cron', cron_expr: '99 99 * * *', instruction: 'x', character_id: 'char_test' } as any) } catch { threw = true }
    assert(threw, 'invalid cron expression rejected at create')
    console.log('  OK create computes next_fire_at and validates cron')
  }

  // ---- CAS claim: only one tick wins ----------------------------------------
  {
    const def = makeDefinition()
    const stale = eventDefinitionStore.get(def.id)!
    assert(claimDue(stale, stale.next_fire_at! + 1000) === true, 'first claim wins')
    // A second tick holding the pre-claim snapshot loses the CAS.
    assert(claimDue(stale, stale.next_fire_at! + 1000) === false, 'second claim with stale snapshot loses')
    const after = eventDefinitionStore.get(def.id)!
    assert(after.next_fire_at! > stale.next_fire_at!, 'next_fire_at advanced by the winner')
    console.log('  OK CAS claim is single-winner')
  }

  // ---- occurrence idempotency on (definition_id, scheduled_for) --------------
  {
    const def = makeDefinition()
    const first = eventOccurrenceStore.create(def, { triggerType: 'scheduled', scheduledFor: 12345 })
    const second = eventOccurrenceStore.create(def, { triggerType: 'scheduled', scheduledFor: 12345 })
    assert(first.id === second.id, 'same (definition, scheduled_for) returns the same occurrence')
    const rows = eventOccurrenceStore.list(def.id)
    assert(rows.length === 1, 'no duplicate occurrence inserted')
    console.log('  OK occurrence idempotent under (definition_id, scheduled_for)')
  }

  // ---- overlap skip: active occurrence drops the fire ------------------------
  {
    const def = makeDefinition({ overlap_policy: 'skip' })
    const running = eventOccurrenceStore.create(def, { triggerType: 'scheduled', scheduledFor: NOW })
    db.prepare("UPDATE event_occurrences SET status = 'running' WHERE id = ?").run(running.id)
    const result = fireDefinition(def)
    assert(result === null, 'skip policy returns nothing')
    const rows = eventOccurrenceStore.list(def.id)
    assert(rows.length === 2, 'a skipped occurrence was recorded')
    assert(rows.some(r => r.status === 'skipped'), 'the new fire is marked skipped')
    console.log('  OK overlap skip marks the fire skipped')
  }

  // ---- overlap queue: fire stays pending while running ------------------------
  {
    const def = makeDefinition({ overlap_policy: 'queue' })
    const running = eventOccurrenceStore.create(def, { triggerType: 'scheduled', scheduledFor: NOW })
    db.prepare("UPDATE event_occurrences SET status = 'running' WHERE id = ?").run(running.id)
    const queued = fireDefinition(def)
    assert(!!queued, 'queue policy returns the occurrence')
    assert(queued!.status === 'pending', 'queued occurrence stays pending')
    assert(eventOccurrenceStore.nextPending(def.id)?.id === queued!.id, 'nextPending finds the queued occurrence')
    console.log('  OK overlap queue parks the fire as pending')
  }

  // ---- no overlap: fire is scheduled immediately ------------------------------
  {
    const def = makeDefinition()
    const fired = fireDefinition(def)
    assert(!!fired && fired.status === 'pending', 'non-overlapping fire created')
    console.log('  OK non-overlapping fire created')
  }

  // ---- due() only returns active cron definitions whose time came ------------
  {
    const def = makeDefinition()
    const future = eventDefinitionStore.create({
      name: 'future', type: 'cron', cron_expr: '0 0 1 1 *',
      instruction: 'x', character_id: 'char_test',
    } as any)
    const due = eventDefinitionStore.due(future.next_fire_at! - 1)
    assert(due.some(d => d.id === def.id), 'overdue definition is due')
    assert(!due.some(d => d.id === future.id), 'future definition not due')
    console.log('  OK due() scoping')
  }
} finally {
  closeDb()
  rmSync(tmpData, { recursive: true, force: true })
}

console.log('ALL EVENT-SCHEDULER TESTS PASSED')
