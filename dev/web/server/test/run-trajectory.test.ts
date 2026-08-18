import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { randomUUID } from 'crypto'
import { afterAll, describe, expect, it } from 'vitest'

// Set env BEFORE importing config/db modules.
const tmpData = mkdtempSync(join(tmpdir(), 'tianshu-run-trajectory-'))
process.env.TIANSHU_DATA_DIR = tmpData

import { getDb, closeDb } from '../src/db/schema.js'
import { sessionStore } from '../src/db/sessionStore.js'
import { messageStore } from '../src/db/messageStore.js'
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

async function getTrajectory(runId: string) {
  const mod = await import('../src/routes/runs.js')
  const res = await (mod as { default: { request: (req: Request) => Promise<Response> } }).default.request(
    new Request(`http://localhost/${runId}/trajectory`),
  )
  return { status: res.status, body: await res.json() as Record<string, unknown> }
}

describe('GET /:id/trajectory', () => {
  it('returns run, final messages, and non-streaming events', async () => {
    const session = makeSession()
    const run = runStore.create(session, { id: `run_${randomUUID()}` })
    makeRunning(run.id)

    messageStore.addMessage(session.id, { role: 'user', content: '分析这个项目', run_id: run.id } as never)
    const assistant = messageStore.addMessage(session.id, {
      role: 'assistant', content: '好的', reasoning_content: '先看结构', run_id: run.id,
    } as never)
    messageStore.addMessage(session.id, {
      role: 'tool', content: '{"output":"ok"}', tool_name: 'bash',
      tool_input: JSON.stringify({ call_id: 'c1', args: 'ls' }),
      tool_output: 'ok', tool_status: 'success', is_error: 0, run_id: run.id,
    } as never)

    runEventStore.append(run.id, 'message.delta', { session_id: session.id, run_id: run.id, delta: '好' })
    runEventStore.append(run.id, 'message.delta', { session_id: session.id, run_id: run.id, delta: '的' })
    runEventStore.append(run.id, 'message.metrics', {
      session_id: session.id, run_id: run.id, message_id: assistant.id,
      llm_ms: 2000, ttft_ms: 500, decode_ms: 1500,
      cache: { hitTokens: 1, missTokens: 0, hitRatio: '100.0' },
    })
    runEventStore.append(run.id, 'tool.started', { session_id: session.id, run_id: run.id, tool_call_id: 'c1', tool_name: 'bash', tool_input: 'ls' })
    runEventStore.append(run.id, 'tool.completed', { session_id: session.id, run_id: run.id, tool_call_id: 'c1', duration_ms: 300, tool_status: 'success' })
    runEventStore.append(run.id, 'run.completed', { session_id: session.id, run_id: run.id, status: 'completed' })

    const { status, body } = await getTrajectory(run.id)

    expect(status).toBe(200)
    const messages = body.messages as Array<{ role: string; content: string }>
    expect(messages.map(m => m.role)).toEqual(['user', 'assistant', 'tool'])
    // 流式 message.delta 被排除，时序/生命周期事件保留
    const events = body.events as Array<{ type: string }>
    const types = events.map(e => e.type)
    expect(types).not.toContain('message.delta')
    expect(types).toContain('message.metrics')
    expect(types).toContain('tool.started')
    expect(types).toContain('tool.completed')
    expect(types).toContain('run.completed')
    expect((body.run as { status: string }).status).toBe('completed')
  })

  it('returns 404 for unknown runs', async () => {
    const { status } = await getTrajectory('no-such-run')
    expect(status).toBe(404)
  })
})
