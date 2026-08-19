import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { randomUUID } from 'crypto'
import { afterAll, describe, expect, it } from 'vitest'

// Set env BEFORE importing config/db modules (getDataDir() caches on first call).
const tmpData = mkdtempSync(join(tmpdir(), 'tianshu-wb-'))
process.env.TIANSHU_DATA_DIR = tmpData

import { getDb, closeDb } from '../src/db/schema.js'
import { sessionStore } from '../src/db/sessionStore.js'
import { runStore } from '../src/agent/runtime/run-store.js'
import { runEventStore, flushAllPending } from '../src/agent/runtime/run-event-store.js'
import { getDataDir } from '../src/config.js'

const db = getDb()
const NOW = Date.now()

afterAll(() => {
  flushAllPending()
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

function directCount(runId: string): number {
  return (db.prepare('SELECT COUNT(*) AS c FROM run_events WHERE run_id = ?').get(runId) as { c: number }).c
}

describe('run_events write-behind (R9)', () => {
  /** 模拟 run-coordinator 的 queued→preparing→running 流程已完成的真实运行态。 */
  function makeRunning(runId: string) {
    db.prepare("UPDATE runs SET status = 'running', phase = 'model' WHERE id = ?").run(runId)
  }

  it('batches non-terminal events; terminal events flush immediately', () => {
    const session = sessionStore.create({ id: `sess_${randomUUID()}`, character_id: newChar() } as any)
    const run = runStore.create(session, { id: `run_${randomUUID()}` })
    makeRunning(run.id)

    // run.started is in IMMEDIATE_FLUSH → durable right away.
    runEventStore.append(run.id, 'run.started', { session_id: session.id, run_id: run.id })
    expect(directCount(run.id)).toBe(1)

    // message.metrics / tool.started are NOT immediate → pending (not yet in DB).
    runEventStore.append(run.id, 'message.metrics', { session_id: session.id, run_id: run.id, llm_ms: 2000 })
    runEventStore.append(run.id, 'tool.started', { session_id: session.id, run_id: run.id, tool_call_id: 't1' })
    expect(directCount(run.id)).toBe(1)

    // list() flushes the run's pending rows before reading → visible.
    expect(runEventStore.list(run.id).length).toBe(3)
    expect(directCount(run.id)).toBe(3)

    // Terminal event → immediate flush, run status finished.
    runEventStore.append(run.id, 'run.completed', { session_id: session.id, run_id: run.id, status: 'completed' })
    expect(directCount(run.id)).toBe(4)
    expect(runStore.get(run.id)!.status).toBe('completed')
  })

  it('flushAllPending drains every run (timer expiry path)', () => {
    const session = sessionStore.create({ id: `sess_${randomUUID()}`, character_id: newChar() } as any)
    const run = runStore.create(session, { id: `run_${randomUUID()}` })
    makeRunning(run.id)
    runEventStore.append(run.id, 'run.started', { session_id: session.id, run_id: run.id })
    runEventStore.append(run.id, 'tool.started', { session_id: session.id, run_id: run.id, tool_call_id: 't1' })
    runEventStore.append(run.id, 'tool.completed', { session_id: session.id, run_id: run.id, tool_call_id: 't1' })

    expect(directCount(run.id)).toBe(1) // only run.started flushed
    flushAllPending()
    expect(directCount(run.id)).toBe(3)
    // seq continuity: cursor advanced with pending rows, no UNIQUE violation.
    runEventStore.append(run.id, 'message.metrics', { session_id: session.id, run_id: run.id })
    flushAllPending()
    const seqs = db.prepare('SELECT seq FROM run_events WHERE run_id = ? ORDER BY seq').all(run.id) as { seq: number }[]
    expect(seqs.map(s => s.seq)).toEqual([1, 2, 3, 4])
  })

  it('state-machine side effects are synchronous even while the log is pending', () => {
    const session = sessionStore.create({ id: `sess_${randomUUID()}`, character_id: newChar() } as any)
    const run = runStore.create(session, { id: `run_${randomUUID()}` })
    makeRunning(run.id)
    runEventStore.append(run.id, 'run.started', { session_id: session.id, run_id: run.id })
    runEventStore.append(run.id, 'tool.started', { session_id: session.id, run_id: run.id, tool_call_id: 't1' })
    // Log row still pending…
    expect(directCount(run.id)).toBe(1)
    // …but runs.phase already reflects tool activity synchronously.
    expect(runStore.get(run.id)!.phase).toBe('tools')
  })
})
