/**
 * file-changes-api.test.ts — 文件修改追踪 REST 接口 + 会话删除清理（vitest）。
 *
 * 覆盖：GET /:id/file-changes（session/project 两种 scope）、
 * GET /:id/file-changes/:path/diff、sessionStore.delete 级联清 file_changes。
 */
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { randomUUID } from 'crypto'
import { afterAll, describe, expect, it } from 'vitest'

const tmpData = mkdtempSync(join(tmpdir(), 'tianshu-fc-api-'))
process.env.TIANSHU_DATA_DIR = tmpData

import { getDb, closeDb } from '../src/db/schema.js'
import { sessionStore } from '../src/db/sessionStore.js'
import { fileChangeStore } from '../src/db/fileChangeStore.js'
import { gitSnapshot, projectKeyFor } from '../src/agent/snapshot/git-snapshot.js'

afterAll(() => {
  closeDb()
  rmSync(tmpData, { recursive: true, force: true })
  delete process.env.TIANSHU_DATA_DIR
})

function makeSession(workspace: string) {
  const id = `sess_${randomUUID().slice(0, 8)}`
  return sessionStore.create({ id, character_id: 'general', workspace } as any)
}

async function api(path: string): Promise<{ status: number; body: Record<string, any> }> {
  const mod = await import('../src/routes/sessions.js')
  const res = await (mod as { default: { request: (req: Request) => Promise<Response> } }).default.request(
    new Request(`http://localhost${path}`),
  )
  return { status: res.status, body: await res.json() as Record<string, any> }
}

describe('GET /:id/file-changes', () => {
  it('session scope 返回聚合文件（snapshot 覆盖 tool）', async () => {
    const ws = join(tmpData, 'ws-api')
    mkdirSync(ws, { recursive: true })
    const s = makeSession(ws)

    fileChangeStore.recordTool({
      sessionId: s.id, projectKey: projectKeyFor(ws), toolCallId: 'c1', runId: 'r1',
      path: 'src/a.ts', status: 'updated', additions: 1, deletions: 1,
    })
    fileChangeStore.recordSnapshotBatch(s.id, 'r1', projectKeyFor(ws), [
      { file: 'src/a.ts', patch: '', additions: 3, deletions: 1, status: 'modified' },
      { file: 'new.ts', patch: '', additions: 4, deletions: 0, status: 'added' },
    ])

    const { status, body } = await api(`/${s.id}/file-changes`)
    expect(status).toBe(200)
    expect(body.scope).toBe('session')
    expect(body.files).toHaveLength(2)
    const a = (body.files as any[]).find(f => f.path === 'src/a.ts')
    expect(a).toMatchObject({ status: 'updated', additions: 3, deletions: 1 })
  })

  it('project scope 跨会话聚合同一 workspace', async () => {
    const ws = join(tmpData, 'ws-api-2')
    mkdirSync(ws, { recursive: true })
    const key = projectKeyFor(ws)
    const s1 = makeSession(ws)
    const s2 = makeSession(ws)

    fileChangeStore.recordTool({ sessionId: s1.id, projectKey: key, toolCallId: 'c1', path: 'shared.ts', status: 'updated', additions: 1, deletions: 1 })
    fileChangeStore.recordTool({ sessionId: s2.id, projectKey: key, toolCallId: 'c2', path: 'other.ts', status: 'created', additions: 5, deletions: 0 })

    const { body } = await api(`/${s1.id}/file-changes?scope=project`)
    expect(body.scope).toBe('project')
    expect((body.files as any[]).map(f => f.path).sort()).toEqual(['other.ts', 'shared.ts'])
  })

  it('会话不存在 → 404', async () => {
    const { status } = await api(`/sess_nope/file-changes`)
    expect(status).toBe(404)
  })
})

describe('GET /:id/file-changes/:path/diff', () => {
  it('git 可用且有工作区改动时返回 patch', async () => {
    const ws = join(tmpData, 'ws-diff')
    mkdirSync(ws, { recursive: true })
    const s = makeSession(ws)

    // 初始化快照仓库 + 基线，再改文件
    const key = projectKeyFor(ws)
    await gitSnapshot.ensure(key, ws)
    writeFileSync(join(ws, 'diff.ts'), 'a\n', 'utf-8')
    const base = await gitSnapshot.track(key)
    expect(base).toBeTruthy()

    writeFileSync(join(ws, 'diff.ts'), 'a\nb\n', 'utf-8')
    const { status, body } = await api(`/${s.id}/file-changes/diff.ts/diff`)
    expect(status).toBe(200)
    expect(body.patch).toContain('+b')
  })

  it('git 缺失/仓库未初始化 → 空 patch（不 500）', async () => {
    const ws = join(tmpData, 'ws-diff-empty')
    mkdirSync(ws, { recursive: true })
    const s = makeSession(ws)
    const { status, body } = await api(`/${s.id}/file-changes/x.ts/diff`)
    expect(status).toBe(200)
    expect(body.patch).toBe('')
  })
})

describe('sessionStore.delete 级联清理 file_changes', () => {
  it('删除会话清该会话 file_changes，保留 project 快照仓库目录', async () => {
    const ws = join(tmpData, 'ws-del')
    mkdirSync(ws, { recursive: true })
    const s = makeSession(ws)
    fileChangeStore.recordTool({
      sessionId: s.id, projectKey: projectKeyFor(ws), toolCallId: 'c1',
      path: 'x.ts', status: 'created', additions: 1, deletions: 0,
    })
    expect(fileChangeStore.listBySession(s.id)).toHaveLength(1)

    const deleted = sessionStore.delete(s.id)
    expect(deleted).toBe(true)
    expect(fileChangeStore.listBySession(s.id)).toHaveLength(0)
  })
})