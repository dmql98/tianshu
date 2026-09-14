import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startTianshuServer } from '../src/app.js'
import type { TianshuServer } from '../src/app.js'
import { knowledgeStore } from '../src/knowledge/store.js'

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

  it('files 列表：含 .md 与可转换文档（png 带 paddleocr 选项），目录结构正确', async () => {
    const res = await fetch(`${base}/api/knowledge/bases/${kbId}/files`)
    expect(res.status).toBe(200)
    const { files } = (await res.json()) as any
    const rels = files.map((f: any) => f.relPath).sort()
    expect(rels).toEqual(['README.md', '图片.png', '子目录/FAQ.md'])
    const png = files.find((f: any) => f.relPath === '图片.png')
    expect(png.converters).toContain('paddleocr')
    expect(png.converters).not.toContain('anydoc')
    expect(png.hasMd).toBe(false)
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

  it('P2 converters：列表含 paddleocr/anydoc；detect 登记；未知 404', async () => {
    const res = await fetch(`${base}/api/knowledge/converters`)
    expect(res.status).toBe(200)
    const { converters } = (await res.json()) as any
    const ids = converters.map((c: any) => c.id)
    expect(ids).toContain('paddleocr')
    expect(ids).toContain('anydoc')
    for (const c of converters) {
      expect(typeof c.detected).toBe('boolean')
      expect(typeof c.installed).toBe('boolean')
    }

    const detect = await fetch(`${base}/api/knowledge/converters/anydoc/detect`, { method: 'POST' })
    expect(detect.status).toBe(200)
    const detectBody = (await detect.json()) as any
    expect(detectBody.converter.id).toBe('anydoc')
    expect(detectBody.converter.installed).toBe(true)

    const ghost = await fetch(`${base}/api/knowledge/converters/nope/detect`, { method: 'POST' })
    expect(ghost.status).toBe(404)
  })

  it('P2 convert：参数缺失 400；源文件不存在 404；真实转换（外部 CLI 不可用时报 400）', async () => {
    const noKb = await fetch(`${base}/api/knowledge/convert/paddleocr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: 'x.pdf' }),
    })
    expect(noKb.status).toBe(400)

    const noFile = await fetch(`${base}/api/knowledge/convert/paddleocr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kb_id: kbId, file: 'ghost.pdf' }),
    })
    expect(noFile.status).toBe(404)

    // 先登记一个真实源文件（originals/ 下），转换若 CLI 不可用应 400 带原因
    const kb = knowledgeStore.get(kbId)
    if (kb) {
      const orig = knowledgeStore.saveOriginal(kbId, 'sample.pdf', Buffer.from('%PDF-1.4 fake'))
      expect(existsSync(orig)).toBe(true)
    }
    const conv = await fetch(`${base}/api/knowledge/convert/paddleocr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kb_id: kbId, file: 'sample.pdf' }),
    })
    // 外部 CLI 未安装 → 400 带错误；装了 → 200（CI 无 paddleocr，断言两种都接受）
    expect([200, 400]).toContain(conv.status)
  })

  it('P2 转换记录回写 relPath；normalized 副本可读；hasMd 标记', async () => {
    // 在知识库目录放置一个真实 PDF，直接注入转换记录（模拟转换成功，避免依赖外部 CLI）
    writeFileSync(join(kbRoot, 'sample.pdf'), '%PDF-1.4 fake', 'utf-8')
    knowledgeStore.upsertConverted(kbId, {
      fileName: 'sample.pdf',
      relPath: 'sample.pdf',
      mdRelPath: 'normalized/sample.md',
      status: 'indexed',
      converter: 'paddleocr',
      updatedAt: Date.now(),
    })
    const filesRes = await fetch(`${base}/api/knowledge/bases/${kbId}/files`)
    const { files } = (await filesRes.json()) as any
    const sample = files.find((f: any) => f.relPath === 'sample.pdf')
    expect(sample).toBeTruthy()
    expect(sample.hasMd).toBe(true)
    expect(sample.converted.status).toBe('indexed')
    expect(sample.converted.converter).toBe('paddleocr')

    // 副本读取端点：先写一个 normalized 文件
    knowledgeStore.saveNormalized(kbId, 'sample.pdf', '# 转换结果\n\n来自 PDF 的内容')
    const copyRes = await fetch(`${base}/api/knowledge/bases/${kbId}/normalized/normalized/sample.md`)
    expect(copyRes.status).toBe(200)
    expect(((await copyRes.json()) as any).content).toContain('来自 PDF 的内容')

    // 未知副本 404
    const missing = await fetch(`${base}/api/knowledge/bases/${kbId}/normalized/normalized/ghost.md`)
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
