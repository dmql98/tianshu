import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { randomUUID } from 'crypto'
import { afterAll, describe, expect, it } from 'vitest'

// Set env BEFORE importing config/db modules: getDataDir() caches on first call.
const tmpData = mkdtempSync(join(tmpdir(), 'tianshu-watchdog-'))
process.env.TIANSHU_DATA_DIR = tmpData

import { getDb, closeDb } from '../src/db/schema.js'
import { sessionStore } from '../src/db/sessionStore.js'
import { runStore } from '../src/agent/runtime/run-store.js'
import { sweepStalledRuns } from '../src/agent/runtime/run-stall-watchdog.js'
import { recoverContinuationState } from '../src/agent/runtime/run-event-store.js'

const db = getDb()
const NOW = Date.now()
const emitted: Array<[string, unknown]> = []
const fakeIo = {
  emit: (type: string, payload: unknown) => { emitted.push([type, payload]); return true },
} as never

afterAll(() => {
  closeDb()
  rmSync(tmpData, { recursive: true, force: true })
  delete process.env.TIANSHU_DATA_DIR
})

function writeCharacter(characterId: string) {
  const dir = resolve(tmpData, 'characters', characterId)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'character.json'), JSON.stringify({
    id: characterId, name: characterId, color: '#000000', role: 'both',
  }), 'utf-8')
}

function seedCharacter(characterId: string, revisionId: string) {
  writeCharacter(characterId)
  db.prepare(`
    INSERT INTO character_definitions (id, current_revision_id, status, created_at, updated_at)
    VALUES (?, ?, 'active', ?, ?)
  `).run(characterId, revisionId, NOW, NOW)
  db.prepare(`
    INSERT INTO character_revisions (id, character_id, revision_no, manifest_hash, snapshot, visual_manifest, created_at)
    VALUES (?, ?, 1, ?, ?, NULL, ?)
  `).run(revisionId, characterId, `hash-${revisionId}`, JSON.stringify({}), NOW)
}

function makeSession() {
  const characterId = `char_${randomUUID().slice(0, 8)}`
  seedCharacter(characterId, `rev_${characterId}_1`)
  return sessionStore.create({ id: `sess_${randomUUID()}`, character_id: characterId } as never)
}

function backdate(runId: string, msAgo: number) {
  db.prepare('UPDATE runs SET updated_at = ? WHERE id = ?').run(NOW - msAgo, runId)
}

function makeRunning(runId: string) {
  runStore.transition(runId, 'preparing')
  runStore.transition(runId, 'running')
  return runStore.get(runId)
}

describe('run stall watchdog', () => {
  it('interrupts a stale running run and broadcasts run.interrupted', () => {
    const session = makeSession()
    const run = runStore.create(session, { id: `run_${randomUUID()}` })
    makeRunning(run.id)
    backdate(run.id, 6 * 60_000)

    const interrupted = sweepStalledRuns(fakeIo)

    expect(interrupted).toContain(run.id)
    expect(runStore.get(run.id)?.status).toBe('interrupted')
    expect(emitted.some(([type, payload]) =>
      type === 'run.interrupted' && (payload as { run_id: string }).run_id === run.id,
    )).toBe(true)
  })

  it('does not interrupt a fresh run', () => {
    const session = makeSession()
    const run = runStore.create(session, { id: `run_${randomUUID()}` })
    makeRunning(run.id)
    const before = emitted.length

    expect(sweepStalledRuns(fakeIo)).not.toContain(run.id)
    expect(emitted.length).toBe(before)
  })

  it('cancels a stale queued run (queued cannot transition to interrupted)', () => {
    const session = makeSession()
    const run = runStore.create(session, { id: `run_${randomUUID()}` })
    backdate(run.id, 6 * 60_000) // still status 'queued'

    const interrupted = sweepStalledRuns(fakeIo)

    expect(interrupted).toContain(run.id)
    expect(runStore.get(run.id)?.status).toBe('cancelled')
    expect(emitted.some(([type, payload]) =>
      type === 'run.cancelled' && (payload as { run_id: string }).run_id === run.id,
    )).toBe(true)
  })

  it('leaves parked runs (awaiting_approval) untouched', () => {
    const session = makeSession()
    const run = runStore.create(session, { id: `run_${randomUUID()}` })
    makeRunning(run.id)
    runStore.transition(run.id, 'awaiting_approval')
    backdate(run.id, 60 * 60_000)

    expect(sweepStalledRuns(fakeIo)).not.toContain(run.id)
  })
})

describe('startup recovery', () => {
  it('cancels orphaned queued runs at boot', () => {
    const session = makeSession()
    const queued = runStore.create(session, { id: `run_${randomUUID()}` })
    const running = runStore.create(session, { id: `run_${randomUUID()}` })
    makeRunning(running.id)

    const { interrupted, cancelledQueued } = recoverContinuationState()

    expect(interrupted).toContain(running.id)
    expect(cancelledQueued).toContain(queued.id)
    expect(runStore.get(queued.id)?.status).toBe('cancelled')
    expect(runStore.get(running.id)?.status).toBe('interrupted')
  })
})
