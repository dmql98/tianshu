import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startTianshuServer } from '../src/app.js'
import type { TianshuServer } from '../src/app.js'

let tmpData: string
let server: TianshuServer
let base = ''
let kbRoot: string

beforeAll(async () => {
  tmpData = mkdtempSync(join(tmpdir(), 'tianshu-kb-rest-'))
  process.env.TIANSHU_DATA_DIR = tmpData
  kbRoot = join(tmpData, 'docs')
  mkdirSync(join(kbRoot, '子目录'), { recursive: true })
  writeFileSync(join(kbRoot, 'README.md'), '# 产品手册\n\n天枢知识库支持检索与挂载。', 'utf-8')
  writeFileSync(join(kbRoot, '子目录', 'FAQ.md'), '# FAQ\n\n常见问题：如何挂载知识库？', 'utf-8')
  writeFileSync(join(kbRoot, '图片.png'), 'not a doc', 'utf-8')
  server = await startTianshuServer({ host: '127.0.0.1', port: 0 })
  base = server.url
})

afterAll(async () => {
  await server.close()
  rmSync(tmpData, { recursive: true, force: true })
  delete process.env.TIANSHU_DATA_DIR
})

describe('知识库 REST（真实 DB + dataDir）', () => {
  let kbId = ''

  it('初始列表为空 → 创建 → 列表可见', async () => {
    const empty = await fetch(`${base}/api/knowledge/bases`)
    expect(empty.status).toBe(200)
    expect(((await empty.json()) as any).bases).toEqual([])

    const created = await fetch(`${base}/api/knowledge/bases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '产品手册库', description: 'docs', rootPath: kbRoot }),
    })
    expect(created.status).toBe(201)
    const { kb } = (await created.json()) as any
    expect(kb.name).toBe('产品手册库')
    expect(kb.rootPath).toBe(kbRoot)
    kbId = kb.id
  })

  it('校验：name 为空 / 相对路径 / 重复名称 均 400', async () => {
    const cases = [
      { name: '', rootPath: kbRoot },
      { name: 'x', rootPath: 'relative/dir' },
      { name: '产品手册库', rootPath: kbRoot },
    ]
    for (const body of cases) {
      const res = await fetch(`${base}/api/knowledge/bases`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      expect(res.status).toBe(400)
    }
  })

  it('files 列表：只含 .md，目录结构正确', async () => {
    const res = await fetch(`${base}/api/knowledge/bases/${kbId}/files`)
    expect(res.status).toBe(200)
    const { files } = (await res.json()) as any
    const rels = files.map((f: any) => f.relPath).sort()
    expect(rels).toEqual(['README.md', '子目录/FAQ.md'])
  })

  it('读取文件内容；越界路径 400；不存在 404', async () => {
    const ok = await fetch(`${base}/api/knowledge/bases/${kbId}/files/README.md`)
    expect(ok.status).toBe(200)
    expect(((await ok.json()) as any).content).toContain('# 产品手册')

    const sub = await fetch(`${base}/api/knowledge/bases/${kbId}/files/%E5%AD%90%E7%9B%AE%E5%BD%95/FAQ.md`)
    expect(sub.status).toBe(200)

    const escape = await fetch(`${base}/api/knowledge/bases/${kbId}/files/..%2Foutside.md`)
    expect(escape.status).toBe(400)

    const missing = await fetch(`${base}/api/knowledge/bases/${kbId}/files/nope.md`)
    expect(missing.status).toBe(404)
  })

  it('搜索：命中 + handle 可解码回 kbId/relPath', async () => {
    const res = await fetch(`${base}/api/knowledge/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '挂载', kb_ids: [kbId], limit: 5 }),
    })
    expect(res.status).toBe(200)
    const { hits } = (await res.json()) as any
    expect(hits.length).toBeGreaterThan(0)
    const top = hits[0]
    expect(top.kbId).toBe(kbId)
    expect(top.score).toBeGreaterThan(0)
    const decoded = Buffer.from(top.handle.slice(5), 'base64url').toString('utf-8')
    expect(decoded).toBe(`${kbId}\x1f${top.relPath}`)
  })

  it('搜索空 query 400；未知库 files 404', async () => {
    const bad = await fetch(`${base}/api/knowledge/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '  ' }),
    })
    expect(bad.status).toBe(400)

    const missing = await fetch(`${base}/api/knowledge/bases/nope/files`)
    expect(missing.status).toBe(404)
  })

  it('PUT 改名；DELETE 删除且不再出现在列表', async () => {
    const put = await fetch(`${base}/api/knowledge/bases/${kbId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '产品手册库·改' }),
    })
    expect(put.status).toBe(200)
    expect(((await put.json()) as any).kb.name).toBe('产品手册库·改')

    const del = await fetch(`${base}/api/knowledge/bases/${kbId}`, { method: 'DELETE' })
    expect(del.status).toBe(200)
    const list = await fetch(`${base}/api/knowledge/bases`)
    expect(((await list.json()) as any).bases).toHaveLength(0)
  })
})
