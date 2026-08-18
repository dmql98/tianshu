import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { randomUUID } from 'crypto'
import { afterAll, describe, expect, it } from 'vitest'

// Set env BEFORE importing config/db modules.
const tmpData = mkdtempSync(join(tmpdir(), 'tianshu-session-stats-'))
process.env.TIANSHU_DATA_DIR = tmpData

import { getDb, closeDb } from '../src/db/schema.js'
import { sessionStore } from '../src/db/sessionStore.js'
import { runStore } from '../src/agent/runtime/run-store.js'
import { runEventStore } from '../src/agent/runtime/run-event-store.js'

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

async function getStats(sessionId: string) {
  const mod = await import('../src/routes/sessions.js')
  const res = await (mod as { default: { request: (req: Request) => Promise<Response> } }).default.request(
    new Request(`http://localhost/${sessionId}/stats`),
  )
  return { status: res.status, body: await res.json() as Record<string, unknown> }
}

describe('GET /:id/stats', () => {
  it('aggregates turns/steps/timing/tokens from durable events', async () => {
    const session = makeSession()
    const run = runStore.create(session, { id: `run_${randomUUID()}` })
    makeRunning(run.id)
    runEventStore.append(run.id, 'run.started', { session_id: session.id, run_id: run.id })
    runEventStore.append(run.id, 'message.metrics', { session_id: session.id, run_id: run.id, llm_ms: 2000, ttft_ms: 300, decode_ms: 1500 })
    runEventStore.append(run.id, 'message.metrics', { session_id: session.id, run_id: run.id, llm_ms: 1000, ttft_ms: null, decode_ms: 800 })
    runEventStore.append(run.id, 'tool.started', { session_id: session.id, run_id: run.id, tool_call_id: 't1' })
    runEventStore.append(run.id, 'tool.completed', { session_id: session.id, run_id: run.id, tool_call_id: 't1', duration_ms: 500 })
    runEventStore.append(run.id, 'tool.completed', { session_id: session.id, run_id: run.id, tool_call_id: 't2', duration_ms: 700 })
    sessionStore.update(session.id, {
      input_tokens: 4000, output_tokens: 1200,
      cache_hit_tokens: 3000, cache_miss_tokens: 1000,
    })
    db.prepare(`
      INSERT INTO messages (id, session_id, role, content, created_at)
      VALUES (1, ?, 'user', 'a', ?), (2, ?, 'assistant', 'b', ?)
    `).run(session.id, NOW, session.id, NOW)

    const { status, body } = await getStats(session.id)

    expect(status).toBe(200)
    expect(body.messageCount).toBe(2)
    expect(body.turns).toBe(2)
    expect(body.steps).toBe(1)
    expect(body.toolMs).toBe(1200)
    expect(body.llmMs).toBe(3000)
    expect(body.decodeMs).toBe(2300)
    expect(body.ttftAvgMs).toBe(300)
    expect(body.cacheHitPercent).toBe(75)
    expect(body.cacheHitTokens).toBe(3000)
    expect(body.cacheMissTokens).toBe(1000)
    expect(body.inputTokens).toBe(4000)
    expect(body.outputTokens).toBe(1200)
  })

  it('reports nulls/zeros for a session with no activity', async () => {
    const session = makeSession()
    const { status, body } = await getStats(session.id)

    expect(status).toBe(200)
    expect(body.messageCount).toBe(0)
    expect(body.turns).toBe(0)
    expect(body.steps).toBe(0)
    expect(body.toolMs).toBe(0)
    expect(body.llmMs).toBe(0)
    expect(body.ttftAvgMs).toBeNull()
    expect(body.cacheHitPercent).toBeNull()
    expect(body.inputTokens).toBe(0)
  })

  it('returns 404 for unknown sessions', async () => {
    const { status } = await getStats('no-such-session')
    expect(status).toBe(404)
  })
})
