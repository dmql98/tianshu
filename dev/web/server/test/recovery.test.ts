import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { randomUUID } from 'crypto'
import { afterAll, describe, expect, it } from 'vitest'

// Set env BEFORE importing config/db modules (getDataDir() caches on first call).
const tmpData = mkdtempSync(join(tmpdir(), 'tianshu-recovery-'))
process.env.TIANSHU_DATA_DIR = tmpData

import { getDb } from '../src/db/schema.js'
import { sessionStore } from '../src/db/sessionStore.js'
import { runStore } from '../src/agent/runtime/run-store.js'
import { recoverContinuationState, runEventStore } from '../src/agent/runtime/run-event-store.js'
import { getDataDir } from '../src/config.js'
import { closeDb } from '../src/db/schema.js'

const db = getDb()
const NOW = Date.now()

afterAll(() => {
  closeDb()
  rmSync(tmpData, { recursive: true, force: true })
  delete process.env.TIANSHU_DATA_DIR
})

function writeCharacter(characterId: string) {
  const dir = resolve(getDataDir(), 'characters', characterId)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'character.json'), JSON.stringify({ id: characterId, name: characterId }), 'utf-8')
}

function newChar() {
  const id = `char_${randomUUID().slice(0, 8)}`
  writeCharacter(id)
  db.prepare(`
    INSERT INTO character_definitions (id, current_revision_id, status, created_at, updated_at)
    VALUES (?, ?, 'active', ?, ?)
  `).run(id, `rev_${id}_1`, NOW, NOW)
  db.prepare(`
    INSERT INTO character_revisions (id, character_id, revision_no, manifest_hash, snapshot, visual_manifest, created_at)
    VALUES (?, ?, 1, ?, ?, NULL, ?)
  `).run(`rev_${id}_1`, id, `hash-${id}`, '{}', NOW)
  return id
}

describe('continuation recovery', () => {
  it('interrupts orphaned running runs and persists a durable event', () => {
    const charId = newChar()
    const session = sessionStore.create({ id: `sess_${randomUUID()}`, character_id: charId } as any)
    const run = runStore.create(session)
    // Simulate a run that was running when the process died.
    db.prepare('UPDATE runs SET status = ? WHERE id = ?').run('running', run.id)
    const before = runEventStore.list(run.id).length

    const { interrupted } = recoverContinuationState()
    expect(interrupted).toContain(run.id)
    expect(runStore.get(run.id)!.status).toBe('interrupted')
    expect(runEventStore.list(run.id).length).toBe(before + 1)
    expect(runEventStore.list(run.id).some(e => e.type === 'run.interrupted')).toBe(true)
  })

  it('repairs a missing run.queued durable event for a queued run', () => {
    const charId = newChar()
    const session = sessionStore.create({ id: `sess_${randomUUID()}`, character_id: charId } as any)
    const run = runStore.create(session)
    // The run is queued with no run.queued event (simulated crash window).
    expect(runStore.get(run.id)!.status).toBe('queued')

    const { repairedEvents } = recoverContinuationState()
    expect(repairedEvents).toContain(run.id)
    expect(runEventStore.list(run.id).some(e => e.type === 'run.queued')).toBe(true)

    // Second run is idempotent.
    const second = recoverContinuationState()
    expect(second.repairedEvents).not.toContain(run.id)
  })

  it('does not touch terminal runs', () => {
    const charId = newChar()
    const session = sessionStore.create({ id: `sess_${randomUUID()}`, character_id: charId } as any)
    const run = runStore.create(session)
    db.prepare('UPDATE runs SET status = ?, phase = ?, finished_at = ? WHERE id = ?')
      .run('completed', 'finalize', NOW, run.id)
    const { interrupted, repairedEvents } = recoverContinuationState()
    expect(interrupted).not.toContain(run.id)
    expect(repairedEvents).not.toContain(run.id)
    expect(runStore.get(run.id)!.status).toBe('completed')
  })
})
