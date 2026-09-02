import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startTianshuServer } from '../src/app.js'
import type { TianshuServer } from '../src/app.js'
import { characterMetaStore } from '../src/db/characterStore.js'

let tmpData: string
let server: TianshuServer
let base = ''

beforeAll(async () => {
  tmpData = mkdtempSync(join(tmpdir(), 'tianshu-mem-rest-'))
  process.env.TIANSHU_DATA_DIR = tmpData
  server = await startTianshuServer({ host: '127.0.0.1', port: 0 })
  base = server.url
  characterMetaStore.create({
    id: 'mem-rest-1',
    name: 'MemoryREST',
    memory: { mode: 'editable', charLimit: 300 },
    tools: [], skills: [], skillBindings: [],
  })
})

afterAll(async () => {
  await server.close()
  rmSync(tmpData, { recursive: true, force: true })
  delete process.env.TIANSHU_DATA_DIR
})

/** 模拟 Agent 写入记忆：直接在 store 上落条目（等价 memory_write 工具路径）。 */
async function writeSample(id: string, entries: Array<{ content: string; type?: string }>) {
  const { writeEntries } = await import('../src/character/memory-store.js')
  return writeEntries(id, entries.map(e => ({ content: e.content, type: e.type as any })))
}

describe('角色记忆 REST（真实 DB：memory.md 持久化）', () => {
  it('GET 空视图 → PATCH/archive/DELETE 404', async () => {
    const res = await fetch(`${base}/api/characters/mem-rest-1/memory`)
    expect(res.status).toBe(200)
    const view = (await res.json()) as any
    expect(view.entries).toEqual([])
    expect(view.stats).toMatchObject({ mode: 'editable', active: 0, archived: 0 })
    // 概览摘要块与真实预算（charLimit 为角色真实配置 300）
    expect(view.overview).toMatchObject({ blocks: [], used: 0, budget: 300, overBudget: false })

    const missing = await fetch(`${base}/api/characters/mem-rest-1/memory/nope`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'x' }) })
    expect(missing.status).toBe(404)
    const del = await fetch(`${base}/api/characters/mem-rest-1/memory/nope`, { method: 'DELETE' })
    expect(del.status).toBe(404)
    const arc = await fetch(`${base}/api/characters/mem-rest-1/memory/nope/archive`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ archived: true }) })
    expect(arc.status).toBe(404)
  })

  it('记忆写入后：GET 视图含条目与统计', async () => {
    await writeSample('mem-rest-1', [
      { content: '用户喜欢极简汇报', type: 'preference' },
      { content: '项目后端为 Node.js', type: 'fact' },
    ])
    const res = await fetch(`${base}/api/characters/mem-rest-1/memory`)
    const view = (await res.json()) as any
    expect(view.entries).toHaveLength(2)
    expect(view.stats.active).toBe(2)
    expect(view.stats.char_usage).toBeGreaterThan(0)
    expect(view.entries.map((e: any) => e.type).sort()).toEqual(['fact', 'preference'])
    // 概览摘要块来自真实 memory.md：与条目同源、预算为真实配置值
    expect(view.overview.blocks).toHaveLength(2)
    expect(view.overview.blocks[0]).toContain('preference｜')
    expect(view.overview.used).toBeGreaterThan(0)
    expect(view.overview.budget).toBe(300)
    expect(view.overview.overBudget).toBe(false)
  })

  it('PATCH 编辑内容（用户操作）→ 返回新条目', async () => {
    const view = (await (await fetch(`${base}/api/characters/mem-rest-1/memory`)).json()) as any
    const entry = view.entries[0]
    const res = await fetch(`${base}/api/characters/mem-rest-1/memory/${entry.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: `${entry.content}（已修订）` }),
    })
    expect(res.status).toBe(200)
    const out = (await res.json()) as any
    expect(out.ok).toBe(true)
    expect(out.entry.content).toContain('已修订')
    expect(out.entry).toHaveProperty('id')
    expect(out.entry).toHaveProperty('ts')
  })

  it('archive 归档 / 恢复 → 状态切换 + 统计正确', async () => {
    const view = (await (await fetch(`${base}/api/characters/mem-rest-1/memory`)).json()) as any
    const entry = view.entries[0]
    const arc = await fetch(`${base}/api/characters/mem-rest-1/memory/${entry.id}/archive`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ archived: true }),
    })
    expect(arc.status).toBe(200)
    expect(((await arc.json()) as any).entry.archived).toBe(true)

    const after = (await (await fetch(`${base}/api/characters/mem-rest-1/memory`)).json()) as any
    expect(after.stats).toMatchObject({ active: 1, archived: 1 })

    const restore = await fetch(`${base}/api/characters/mem-rest-1/memory/${entry.id}/archive`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ archived: false }),
    })
    expect(((await restore.json()) as any).entry.archived).toBe(false)
  })

  it('DELETE 永久删除（用户前端专属）→ 条目消失且文件内容减少', async () => {
    const view = (await (await fetch(`${base}/api/characters/mem-rest-1/memory`)).json()) as any
    const before = view.entries.length
    const target = view.entries[0]
    const res = await fetch(`${base}/api/characters/mem-rest-1/memory/${target.id}`, { method: 'DELETE' })
    expect(res.status).toBe(200)
    const after = (await (await fetch(`${base}/api/characters/mem-rest-1/memory`)).json()) as any
    expect(after.entries).toHaveLength(before - 1)
    expect(after.entries.find((e: any) => e.id === target.id)).toBeUndefined()
  })

  it('审计日志：记录用户在前端的编辑/归档/永久删除操作', async () => {
    const audit = (await (await fetch(`${base}/api/characters/mem-rest-1/memory/audit`)).json()) as any
    expect(audit.entries.length).toBeGreaterThanOrEqual(4)
    for (const row of audit.entries) {
      expect(row).toHaveProperty('ts')
      expect(['用户', 'Agent']).toContain(row.actor)
    }
    const userActions = audit.entries.filter((a: any) => a.actor === '用户')
    expect(userActions.some((a: any) => a.action.includes('编辑') || a.action.includes('update'))).toBe(true)
    expect(userActions.some((a: any) => a.action.includes('归档') || a.action.includes('archive'))).toBe(true)
    expect(userActions.some((a: any) => a.action.includes('永久删除') || a.action.includes('delete'))).toBe(true)
  })

  it('未知角色 → 404；read_only 角色 REST 可读', async () => {
    const missing = await fetch(`${base}/api/characters/does-not-exist/memory`)
    expect(missing.status).toBe(404)
    characterMetaStore.create({
      id: 'mem-rest-ro', name: 'ReadOnly', memory: { mode: 'read_only' }, tools: [], skills: [], skillBindings: [],
    })
    const ro = await fetch(`${base}/api/characters/mem-rest-ro/memory`)
    expect(ro.status).toBe(200)
    const roAudit = await fetch(`${base}/api/characters/mem-rest-ro/memory/audit`)
    expect(roAudit.status).toBe(200)
  })
})
