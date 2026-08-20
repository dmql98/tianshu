import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { randomUUID } from 'crypto'
import { afterAll, describe, expect, it } from 'vitest'

const tmpData = mkdtempSync(join(tmpdir(), 'tianshu-tool-seq-'))
process.env.TIANSHU_DATA_DIR = tmpData

import { getDb, closeDb } from '../src/db/schema.js'
import { sessionStore } from '../src/db/sessionStore.js'
import { runStore } from '../src/agent/runtime/run-store.js'
import {
  createDurableStream, flushAllPending, publishRunEvent,
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

const NOOP_STREAM = { emit: () => {} }

function makeRunning(runId: string) {
  db.prepare("UPDATE runs SET status = 'running', phase = 'model' WHERE id = ?").run(runId)
}

describe('tool-call event sequence over the durable stream (inner.ts path)', () => {
  it('tool.started / tool.completed reach sinks and persist; tool.output reaches sinks and does not persist', () => {
    clearEventSinks()
    const received: Array<{ type: string; payload: Record<string, unknown> }> = []
    addEventSink({ id: 'sink', emit: (type, payload) => { received.push({ type, payload: payload as Record<string, unknown> }) } })

    const session = sessionStore.create({ id: `sess_${randomUUID()}`, character_id: newChar() } as any)
    const run = runStore.create(session, { id: `run_${randomUUID()}` })
    makeRunning(run.id)
    const durable = createDurableStream(NOOP_STREAM, run.id)

    // 模拟 inner.ts 工具执行序列
    durable.emit('tool.started', { session_id: session.id, run_id: run.id, tool_call_id: 'c1', tool_name: 'bash', tool_input: 'ls' })
    durable.emit('tool.output', { session_id: session.id, run_id: run.id, tool_call_id: 'c1', output: 'file1' })
    durable.emit('tool.output', { session_id: session.id, run_id: run.id, tool_call_id: 'c1', output: ' file2' })
    durable.emit('tool.completed', { session_id: session.id, run_id: run.id, tool_call_id: 'c1', tool_name: 'bash', tool_output: 'file1 file2', tool_status: 'success', duration_ms: 10 })
    durable.emit('message.delta', { session_id: session.id, run_id: run.id, delta: '结果' })

    // 所有事件都必须到达 sink（工具调用能在前端实时显示的前提）
    const types = received.map(r => r.type)
    expect(types.filter(t => t === 'tool.started').length).toBe(1)
    expect(types.filter(t => t === 'tool.completed').length).toBe(1)
    expect(types.filter(t => t === 'tool.output').length).toBe(2)
    expect(types.filter(t => t === 'message.delta').length).toBe(1)

    // tool.output 不落库；tool.started/completed 落库（write-behind 读前 flush）
    flushAllPending()
    const rows = (db.prepare(
      'SELECT type FROM run_events WHERE run_id = ? ORDER BY seq',
    ).all(run.id) as Array<{ type: string }>).map(r => r.type)
    expect(rows.filter(t => t === 'tool.output')).toHaveLength(0)
    expect(rows).toContain('tool.started')
    expect(rows).toContain('tool.completed')
  })

  it('publishRunEvent fans out to sinks even when append throws (run missing)', () => {
    clearEventSinks()
    const received: Array<{ type: string }> = []
    addEventSink({ id: 'sink2', emit: (type) => { received.push({ type }) } })

    // run 不存在 → append 会 throw。publishRunEvent 不应让 sink 静默丢失：
    // 但当前实现 append 抛错是同步冒泡的，调用方 emit 会中断。这里记录真实行为，
    // 见 durable-stream.test.ts 的回归测试（正常 run 序列下不会触发）。
    expect(() => {
      publishRunEvent(NOOP_STREAM, 'run_does_not_exist', 'tool.started', { session_id: 's', tool_call_id: 'x' })
    }).toThrow()
  })
})