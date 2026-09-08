/**
 * fileChangeStore.test.ts — file_changes 数据层单测（vitest）。
 *
 * 覆盖：migration v7 建表、recordTool 实时行、recordSnapshotBatch 批量权威行、
 * aggregateBySession 最新行胜出、aggregateByProject 项目全局、deleteBySession。
 */
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { randomUUID } from 'crypto'
import { afterAll, describe, expect, it, beforeEach } from 'vitest'

const tmpData = mkdtempSync(join(tmpdir(), 'tianshu-fc-'))
process.env.TIANSHU_DATA_DIR = tmpData

import { getDb, closeDb } from '../src/db/schema.js'
import { sessionStore } from '../src/db/sessionStore.js'
import { fileChangeStore, mapSnapshotStatus } from '../src/db/fileChangeStore.js'
import { getDataDir } from '../src/config.js'

afterAll(() => {
  closeDb()
  rmSync(tmpData, { recursive: true, force: true })
  delete process.env.TIANSHU_DATA_DIR
})

function makeSession(overrides: Record<string, unknown> = {}) {
  const id = `sess_${randomUUID().slice(0, 8)}`
  return sessionStore.create({ id, character_id: 'general', workspace: '/tmp/ws', ...overrides } as any)
}

describe('migration v7 file_changes 建表', () => {
  it('12 列就绪 + 索引存在', () => {
    const cols = getDb().prepare('PRAGMA table_info(file_changes)').all() as Array<{ name: string }>
    expect(cols.map(c => c.name)).toEqual([
      'id', 'project_key', 'session_id', 'run_id', 'tool_call_id',
      'source', 'path', 'status', 'additions', 'deletions', 'hash', 'created_at',
    ])
  })
})

describe('fileChangeStore recordTool / recordSnapshotBatch', () => {
  beforeEach(() => {
    getDb().prepare('DELETE FROM file_changes').run()
  })

  it('recordTool 写入 source=tool 行（含 tool_call_id）', () => {
    const s = makeSession()
    fileChangeStore.recordTool({
      sessionId: s.id, projectKey: 'p1', toolCallId: 'c1', runId: 'r1',
      path: 'src/a.ts', status: 'updated', additions: 2, deletions: 1, hash: 'h1',
    })
    const rows = fileChangeStore.listBySession(s.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      session_id: s.id, project_key: 'p1', tool_call_id: 'c1', run_id: 'r1',
      source: 'tool', path: 'src/a.ts', status: 'updated', additions: 2, deletions: 1, hash: 'h1',
    })
  })

  it('recordSnapshotBatch 批量写入 source=snapshot 行，status 映射正确', () => {
    const s = makeSession()
    fileChangeStore.recordSnapshotBatch(s.id, 'r1', 'p1', [
      { file: 'a.ts', patch: '', additions: 1, deletions: 0, status: 'added' },
      { file: 'b.ts', patch: '', additions: 0, deletions: 3, status: 'deleted' },
      { file: 'c.ts', patch: '', additions: 2, deletions: 1, status: 'modified' },
    ])
    const rows = fileChangeStore.listBySession(s.id)
    expect(rows).toHaveLength(3)
    expect(rows.every(r => r.source === 'snapshot' && r.tool_call_id === null)).toBe(true)
    expect(rows.map(r => [r.path, r.status])).toEqual([
      ['a.ts', 'created'], ['b.ts', 'deleted'], ['c.ts', 'updated'],
    ])
  })

  it('mapSnapshotStatus 映射表', () => {
    expect(mapSnapshotStatus('added')).toBe('created')
    expect(mapSnapshotStatus('deleted')).toBe('deleted')
    expect(mapSnapshotStatus('modified')).toBe('updated')
  })
})

describe('fileChangeStore aggregateBySession / aggregateByProject', () => {
  beforeEach(() => {
    getDb().prepare('DELETE FROM file_changes').run()
  })

  it('按 path 取最新一条：snapshot 行覆盖 tool 行', () => {
    const s = makeSession()
    fileChangeStore.recordTool({
      sessionId: s.id, projectKey: 'p1', toolCallId: 'c1', runId: 'r1',
      path: 'src/a.ts', status: 'updated', additions: 2, deletions: 1,
    })
    // 稍后写入 snapshot 权威行（同样 path），行数不同 → 聚合应显示 snapshot 的
    fileChangeStore.recordSnapshotBatch(s.id, 'r2', 'p1', [
      { file: 'src/a.ts', patch: '', additions: 4, deletions: 1, status: 'modified' },
    ])
    const agg = fileChangeStore.aggregateBySession(s.id)
    expect(agg).toHaveLength(1)
    expect(agg[0]).toMatchObject({ path: 'src/a.ts', status: 'updated', additions: 4, deletions: 1 })
    expect(typeof agg[0].updatedAt).toBe('number')
  })

  it('noop 行聚合时被剔除', () => {
    const s = makeSession()
    fileChangeStore.recordTool({
      sessionId: s.id, projectKey: 'p1', toolCallId: 'c1', runId: 'r1',
      path: 'src/noop.ts', status: 'noop', additions: 0, deletions: 0,
    })
    expect(fileChangeStore.aggregateBySession(s.id)).toHaveLength(0)
  })

  it('project 全局视图：跨会话合并同一 path', () => {
    const s1 = makeSession()
    const s2 = makeSession()
    fileChangeStore.recordTool({
      sessionId: s1.id, projectKey: 'proj_x', toolCallId: 'c1', path: 'shared.ts',
      status: 'updated', additions: 1, deletions: 1,
    })
    fileChangeStore.recordTool({
      sessionId: s2.id, projectKey: 'proj_x', toolCallId: 'c2', path: 'other.ts',
      status: 'created', additions: 5, deletions: 0,
    })
    const agg = fileChangeStore.aggregateByProject('proj_x')
    expect(agg.map(a => a.path).sort()).toEqual(['other.ts', 'shared.ts'])
  })
})

describe('fileChangeStore deleteBySession', () => {
  it('只删该会话的行', () => {
    const s1 = makeSession()
    const s2 = makeSession()
    fileChangeStore.recordTool({ sessionId: s1.id, projectKey: 'p', path: 'a.ts', status: 'created', additions: 1 })
    fileChangeStore.recordTool({ sessionId: s2.id, projectKey: 'p', path: 'b.ts', status: 'created', additions: 1 })
    fileChangeStore.deleteBySession(s1.id)
    expect(fileChangeStore.listBySession(s1.id)).toHaveLength(0)
    expect(fileChangeStore.listBySession(s2.id)).toHaveLength(1)
  })
})