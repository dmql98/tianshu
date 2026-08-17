import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { randomUUID } from 'crypto'
import { afterAll, describe, expect, it } from 'vitest'

// Set env BEFORE importing config/db modules.
const tmpData = mkdtempSync(join(tmpdir(), 'tianshu-presence-'))
process.env.TIANSHU_DATA_DIR = tmpData

import { getDb, closeDb } from '../src/db/schema.js'
import { sessionStore } from '../src/db/sessionStore.js'
import { runStore } from '../src/agent/runtime/run-store.js'
import { runEventStore } from '../src/agent/runtime/run-event-store.js'
import { characterPresenceProjector } from '../src/character/presence-projector.js'

const db = getDb()
const NOW = Date.now()

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

function makeRunning(runId: string) {
  runStore.transition(runId, 'preparing')
  runStore.transition(runId, 'running')
}

describe('presence projector terminal-status hardening', () => {
  it('shows the terminal motion even when the last event is a stream event', () => {
    const session = makeSession()
    const run = runStore.create(session, { id: `run_${randomUUID()}` })
    makeRunning(run.id)
    // The last durable event is a stream event (speaking)…
    runEventStore.append(run.id, 'message.delta', { session_id: session.id, run_id: run.id, delta: 'hi' })
    // …but the run is terminal at the DB level (e.g. force-finished without a
    // terminal event append — the defensive case).
    runStore.finish(run.id, 'completed', { result: {} })

    const bySession = characterPresenceProjector.listBySession().find(p => p.sessionId === session.id)
    expect(bySession?.motion).toBe('success')

    const byCharacter = characterPresenceProjector.get(session.character_id)
    expect(byCharacter.motion).toBe('success')
  })

  it('cancelled runs project to idle regardless of the last event', () => {
    const session = makeSession()
    const run = runStore.create(session, { id: `run_${randomUUID()}` })
    makeRunning(run.id)
    runEventStore.append(run.id, 'message.delta', { session_id: session.id, run_id: run.id, delta: 'hi' })
    runStore.finish(run.id, 'cancelled', {})

    const bySession = characterPresenceProjector.listBySession().find(p => p.sessionId === session.id)
    expect(bySession?.motion).toBe('idle')
  })

  it('still reports a live run from its latest event', () => {
    const session = makeSession()
    const run = runStore.create(session, { id: `run_${randomUUID()}` })
    makeRunning(run.id)
    runEventStore.append(run.id, 'message.delta', { session_id: session.id, run_id: run.id, delta: 'hi' })

    const bySession = characterPresenceProjector.listBySession().find(p => p.sessionId === session.id)
    expect(bySession?.motion).toBe('speaking')
  })
})
