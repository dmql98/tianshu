import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { register as registerTool } from '../src/tools/registry.js'
import { tool as manageTool } from '../src/tools/knowledge_manage/index.js'
import { tool as searchTool } from '../src/tools/knowledge_search/index.js'
import { tool as readTool } from '../src/tools/knowledge_read/index.js'
import { decodeHandle, encodeHandle } from '../src/knowledge/search.js'

let tmpRoot: string
let kbRoot: string

beforeAll(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'tianshu-kb-tool-'))
  kbRoot = join(tmpRoot, 'docs')
  mkdirSync(join(kbRoot, '子目录'), { recursive: true })
  writeFileSync(join(kbRoot, 'README.md'), '# 产品手册\n\n天枢知识库支持检索、挂载与读取。', 'utf-8')
  writeFileSync(join(kbRoot, '子目录', 'FAQ.md'), '# FAQ\n\n常见问题：如何挂载知识库？', 'utf-8')
  process.env.TIANSHU_DATA_DIR = join(tmpRoot, 'data')
  mkdirSync(join(tmpRoot, 'data'), { recursive: true })
  registerTool(manageTool)
  registerTool(searchTool)
  registerTool(readTool)
})

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
  delete process.env.TIANSHU_DATA_DIR
})

const ctx = { workspace: tmpRoot, knowledgeBases: [] as string[] }

describe('知识库工具（工具层直接调用）', () => {
  let kbId = ''

  it('knowledge_manage create → list → list_files', async () => {
    const created = await manageTool.execute({ action: 'create', name: '产品手册库', path: kbRoot, description: 'docs' }, ctx)
    expect(created.error).toBeUndefined()
    const parsed = JSON.parse(created.output)
    expect(parsed.ok).toBe(true)
    kbId = parsed.kb.id

    const listed = await manageTool.execute({ action: 'list' }, ctx)
    const listParsed = JSON.parse(listed.output)
    expect(listParsed.bases).toHaveLength(1)

    const files = await manageTool.execute({ action: 'list_files', kb_id: kbId }, ctx)
    const filesParsed = JSON.parse(files.output)
    expect(filesParsed.count).toBe(2)
    expect(filesParsed.files.map((f: any) => f.relPath).sort()).toEqual(['README.md', '子目录/FAQ.md'])
  })

  it('未挂载时 knowledge_search 返回空并提示', async () => {
    const res = await searchTool.execute({ query: '挂载' }, { ...ctx, knowledgeBases: [] })
    expect(res.error).toBeUndefined()
    const parsed = JSON.parse(res.output)
    expect(parsed.hits).toEqual([])
    expect(parsed.note).toContain('未挂载')
  })

  it('挂载后 search 命中；read 读全文；作用域外 kb 被拒', async () => {
    const res = await searchTool.execute({ query: '挂载' }, { ...ctx, knowledgeBases: [kbId] })
    expect(res.error).toBeUndefined()
    const parsed = JSON.parse(res.output)
    expect(parsed.count).toBeGreaterThan(0)
    const top = parsed.hits[0]
    expect(top.kbId).toBe(kbId)
    expect(top.score).toBeGreaterThan(0)

    const read = await readTool.execute({ handle: top.handle }, { ...ctx, knowledgeBases: [kbId] })
    expect(read.error).toBeUndefined()
    const doc = JSON.parse(read.output)
    expect(doc.relPath).toBe(top.relPath)
    expect(doc.kbName).toBe('产品手册库')

    // 解码与重编码一致性
    const decoded = decodeHandle(top.handle)!
    expect(decoded.kbId).toBe(kbId)
    expect(encodeHandle(decoded.kbId, decoded.relPath)).toBe(top.handle)

    // 未挂载该库 → 拒绝读取
    const denied = await readTool.execute({ handle: top.handle }, { ...ctx, knowledgeBases: [] })
    expect(denied.error).toContain('不属于当前会话挂载')
  })

  it('invalid handle / 未知 kb 的错误路径', async () => {
    const bad = await readTool.execute({ handle: 'not-a-handle' }, { ...ctx, knowledgeBases: [kbId] })
    expect(bad.error).toContain('无效')
    const ghost = await readTool.execute({ handle: encodeHandle('nope', 'x.md') }, { ...ctx, knowledgeBases: ['nope'] })
    expect(ghost.error).toContain('知识库不存在')
  })

  it('knowledge_manage converters 列出 paddleocr/anydoc 及可用性', async () => {
    const res = await manageTool.execute({ action: 'converters' }, ctx)
    expect(res.error).toBeUndefined()
    const parsed = JSON.parse(res.output)
    const ids = parsed.converters.map((c: any) => c.id)
    expect(ids).toContain('paddleocr')
    expect(ids).toContain('anydoc')
    for (const c of parsed.converters) {
      expect(typeof c.detected).toBe('boolean')
      expect(typeof c.installed).toBe('boolean')
      expect(Array.isArray(c.inputExtensions)).toBe(true)
    }
  })

  it('knowledge_manage install_converter 登记 + 未知转换器报错', async () => {
    const res = await manageTool.execute({ action: 'install_converter', converter: 'paddleocr' }, ctx)
    expect(res.error).toBeUndefined()
    const parsed = JSON.parse(res.output)
    expect(parsed.converter.id).toBe('paddleocr')
    expect(parsed.converter.installed).toBe(true)

    const bad = await manageTool.execute({ action: 'install_converter', converter: 'nope' }, ctx)
    expect(bad.error).toContain('未知转换器')
  })

  it('knowledge_manage convert 缺少参数 / 文件不存在错误路径', async () => {
    const noFile = await manageTool.execute({ action: 'convert', kb_id: kbId, converter: 'paddleocr' }, ctx)
    expect(noFile.error).toContain('file')
    const noFileFound = await manageTool.execute({ action: 'convert', kb_id: kbId, converter: 'paddleocr', file: 'ghost.pdf' }, ctx)
    expect(noFileFound.error).toContain('找不到源文件')
  })

  it('knowledge_manage delete 后 list_files 报错', async () => {
    const del = await manageTool.execute({ action: 'delete', kb_id: kbId }, ctx)
    expect(JSON.parse(del.output).ok).toBe(true)
    const after = await manageTool.execute({ action: 'list_files', kb_id: kbId }, ctx)
    expect(after.error).toContain('不存在')
  })
})
