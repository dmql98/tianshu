import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { afterAll, afterEach, describe, expect, it } from 'vitest'

// Set env BEFORE importing config/db modules.
const tmpData = mkdtempSync(join(tmpdir(), 'tianshu-retention-'))
process.env.TIANSHU_DATA_DIR = tmpData

import { getDb, closeDb } from '../src/db/schema.js'
import { sessionStore } from '../src/db/sessionStore.js'
import { sweepDataRetention } from '../src/db/data-retention.js'

const db = getDb()
const NOW = Date.now()
const DAY = 24 * 60 * 60 * 1000

afterAll(() => {
  closeDb()
  rmSync(tmpData, { recursive: true, force: true })
  delete process.env.TIANSHU_DATA_DIR
})

// 所有用例共享同一个临时 DB：每个用例前清空被测表，避免跨用例数据污染。
afterEach(() => {
  db.exec('DELETE FROM run_events')
  db.exec('DELETE FROM llm_calls')
  db.exec('DELETE FROM runs')
  db.exec('DELETE FROM sessions')
})

function seedSession(): string {
  const id = `sess-${randomUUID()}`
  sessionStore.create({ id })
  return id
}

function seedRun(input: { sessionId: string; status: string; finishedAt?: number | null }): string {
  const id = `run-${randomUUID()}`
  // finished_at 显式传 null / 不传 → 保持 NULL（非终态或异常行）；
  // 显式传时间戳 → queued_at/started_at 与之对齐（模拟真实 run 时间线）。
  const finishedAt = input.finishedAt ?? null
  const startedAt = finishedAt ?? NOW - 1000
  const queuedAt = finishedAt ?? NOW - 1000
  db.prepare(`
    INSERT INTO runs (
      id, session_id, character_id, character_revision_id, character_snapshot_hash,
      source, status, phase, approval_mode, execution_mode, turn_no, max_turns,
      continuation_index, queued_at, started_at, finished_at, updated_at
    ) VALUES (?, ?, 'ch-test', 'rev-1', 'hash-1', 'chat', ?, 'finalize',
      'direct', 'direct', 0, 50, 0, ?, ?, ?, ?)
  `).run(id, input.sessionId, input.status, queuedAt, startedAt, finishedAt, NOW)
  return id
}

function seedRunEvent(runId: string, sessionId: string, type: string, createdAt: number): void {
  db.prepare(`
    INSERT INTO run_events (event_id, run_id, session_id, seq, type, payload, created_at)
    VALUES (?, ?, ?, 1, ?, '{}', ?)
  `).run(`evt-${randomUUID()}`, runId, sessionId, type, createdAt)
}

function seedLLMCall(sessionId: string, createdAt: number): void {
  db.prepare(`
    INSERT INTO llm_calls (session_id, request_messages, created_at)
    VALUES (?, '[]', ?)
  `).run(sessionId, createdAt)
}

function countRunEvents(): number {
  return (db.prepare('SELECT COUNT(*) AS c FROM run_events').get() as { c: number }).c
}

function countLLMCalls(): number {
  return (db.prepare('SELECT COUNT(*) AS c FROM llm_calls').get() as { c: number }).c
}

describe('data-retention sweep', () => {
  it('removes run_events of terminal runs older than the window, keeps young + non-terminal', () => {
    const sessionId = seedSession()
    // 旧终态 run（finished_at 远超窗口）→ 事件应被清理
    const oldTerminal = seedRun({ sessionId, status: 'completed', finishedAt: NOW - 40 * DAY })
    // 新终态 run（窗口内）→ 保留
    const newTerminal = seedRun({ sessionId, status: 'completed', finishedAt: NOW - 1 * DAY })
    // 非终态 run → 保留（恢复/审批权威数据）
    const active = seedRun({ sessionId, status: 'running', finishedAt: null })

    seedRunEvent(oldTerminal, sessionId, 'tool.started', NOW - 40 * DAY)
    seedRunEvent(newTerminal, sessionId, 'tool.started', NOW - 1 * DAY)
    seedRunEvent(active, sessionId, 'tool.started', NOW)

    expect(countRunEvents()).toBe(3)
    const result = sweepDataRetention(NOW)
    expect(result.runEventsRemoved).toBe(1)

    const remainingTypes = (db.prepare('SELECT run_id, type FROM run_events').all() as Array<{ run_id: string; type: string }>)
      .map(r => r.run_id)
    expect(remainingTypes).not.toContain(oldTerminal)
    expect(remainingTypes).toContain(newTerminal)
    expect(remainingTypes).toContain(active)
  })

  it('uses updated_at as fallback when finished_at is NULL on a terminal run', () => {
    const sessionId = seedSession()
    const terminalNoFinishedAt = seedRun({ sessionId, status: 'cancelled', finishedAt: null })
    // 该 run 的 updated_at 很旧（模拟异常路径遗留行）
    db.prepare('UPDATE runs SET updated_at = ? WHERE id = ?').run(NOW - 40 * DAY, terminalNoFinishedAt)
    seedRunEvent(terminalNoFinishedAt, sessionId, 'run.cancelled', NOW - 40 * DAY)

    const result = sweepDataRetention(NOW)
    expect(result.runEventsRemoved).toBe(1)
  })

  it('removes llm_calls older than the window, keeps fresh calls', () => {
    const sessionId = seedSession()
    seedLLMCall(sessionId, NOW - 40 * DAY)
    seedLLMCall(sessionId, NOW - 1 * DAY)

    expect(countLLMCalls()).toBe(2)
    const result = sweepDataRetention(NOW)
    expect(result.llmCallsRemoved).toBe(1)
    expect(countLLMCalls()).toBe(1)
  })

  it('respects per-table disable via env (0 = disabled)', () => {
    const sessionId = seedSession()
    const oldTerminal = seedRun({ sessionId, status: 'completed', finishedAt: NOW - 40 * DAY })
    seedRunEvent(oldTerminal, sessionId, 'tool.completed', NOW - 40 * DAY)
    seedLLMCall(sessionId, NOW - 40 * DAY)

    const previousRunEvents = process.env.TSS_RUN_EVENTS_RETENTION_DAYS
    const previousLLMCalls = process.env.TSS_LLM_CALLS_RETENTION_DAYS
    process.env.TSS_RUN_EVENTS_RETENTION_DAYS = '0'
    process.env.TSS_LLM_CALLS_RETENTION_DAYS = '0'
    try {
      const result = sweepDataRetention(NOW)
      expect(result.runEventsRemoved).toBe(0)
      expect(result.llmCallsRemoved).toBe(0)
      expect(countRunEvents()).toBe(1)
      expect(countLLMCalls()).toBe(1)
    } finally {
      if (previousRunEvents === undefined) delete process.env.TSS_RUN_EVENTS_RETENTION_DAYS
      else process.env.TSS_RUN_EVENTS_RETENTION_DAYS = previousRunEvents
      if (previousLLMCalls === undefined) delete process.env.TSS_LLM_CALLS_RETENTION_DAYS
      else process.env.TSS_LLM_CALLS_RETENTION_DAYS = previousLLMCalls
    }
  })

  it('reports retention windows in the result', () => {
    const result = sweepDataRetention(NOW)
    expect(result.runEventsRetentionDays).toBe(30)
    expect(result.llmCallsRetentionDays).toBe(30)
  })
})