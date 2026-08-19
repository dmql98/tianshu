import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { randomUUID } from 'crypto'
import { afterAll, describe, expect, it, vi } from 'vitest'

// Set env BEFORE importing config/db modules (getDataDir() caches on first call).
const tmpData = mkdtempSync(join(tmpdir(), 'tianshu-durable-'))
process.env.TIANSHU_DATA_DIR = tmpData

import { getDb, closeDb } from '../src/db/schema.js'
import { sessionStore } from '../src/db/sessionStore.js'
import { runStore } from '../src/agent/runtime/run-store.js'
import {
  createDurableSocket, flushAllPending, publishRunEvent,
} from '../src/agent/runtime/run-event-store.js'
import { addEventSink, clearEventSinks } from '../src/transport/event-sinks.js'
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

/** NOOP shim：与 ws/handlers.ts 的 NOOP_SOCKET 语义一致（delivery via sinks）。 */
const NOOP_SOCKET = { emit: () => {} }

function makeRunning(runId: string) {
  db.prepare("UPDATE runs SET status = 'running', phase = 'model' WHERE id = ?").run(runId)
}

describe('non-durable stream events still reach sinks (R8 regression)', () => {
  it('message.delta emitted through the durable socket fans out to sinks', () => {
    clearEventSinks()
    const received: Array<{ type: string; payload: unknown }> = []
    addEventSink({ id: 'test-sink', emit: (type, payload) => { received.push({ type, payload }) } })

    const session = sessionStore.create({ id: `sess_${randomUUID()}`, character_id: newChar() } as any)
    const run = runStore.create(session, { id: `run_${randomUUID()}` })
    makeRunning(run.id)

    // 模拟 loop 路径：inner.ts 持有 durable socket 并 emit message.delta。
    const durable = createDurableSocket(NOOP_SOCKET, run.id)
    durable.emit('message.delta', { session_id: session.id, run_id: run.id, delta: '你', reasoning: '想' })

    // delta 必须到达 sink（SSE/IPC 唯一通道），否则客户端永远看不到流式。
    expect(received.length).toBe(1)
    expect(received[0].type).toBe('message.delta')
    expect((received[0].payload as any).delta).toBe('你')
    expect((received[0].payload as any).reasoning).toBe('想')
    // 且不落库（R8）
    const count = (db.prepare('SELECT COUNT(*) AS c FROM run_events WHERE run_id = ?').get(run.id) as { c: number }).c
    expect(count).toBe(0)
  })

  it('tool.output also fans out while staying non-durable', () => {
    clearEventSinks()
    const received: Array<{ type: string }> = []
    addEventSink({ id: 'test-sink2', emit: (type) => { received.push({ type }) } })

    const session = sessionStore.create({ id: `sess_${randomUUID()}`, character_id: newChar() } as any)
    const run = runStore.create(session, { id: `run_${randomUUID()}` })
    makeRunning(run.id)
    const durable = createDurableSocket(NOOP_SOCKET, run.id)
    durable.emit('tool.output', { session_id: session.id, run_id: run.id, tool_call_id: 'c1', output: 'chunk' })

    expect(received.some(r => r.type === 'tool.output')).toBe(true)
    const count = (db.prepare('SELECT COUNT(*) AS c FROM run_events WHERE run_id = ?').get(run.id) as { c: number }).c
    expect(count).toBe(0)
  })

  it('durable events still both persist and reach sinks', async () => {
    clearEventSinks()
    const received: Array<{ type: string }> = []
    addEventSink({ id: 'test-sink3', emit: (type) => { received.push({ type }) } })

    const session = sessionStore.create({ id: `sess_${randomUUID()}`, character_id: newChar() } as any)
    const run = runStore.create(session, { id: `run_${randomUUID()}` })
    makeRunning(run.id)
    const durable = createDurableSocket(NOOP_SOCKET, run.id)
    durable.emit('message.metrics', { session_id: session.id, run_id: run.id, llm_ms: 100 })

    expect(received.some(r => r.type === 'message.metrics')).toBe(true)
    // write-behind：读前 flush 保证可见
    flushAllPending()
    const count = (db.prepare('SELECT COUNT(*) AS c FROM run_events WHERE run_id = ?').get(run.id) as { c: number }).c
    expect(count).toBe(1)
  })
})
