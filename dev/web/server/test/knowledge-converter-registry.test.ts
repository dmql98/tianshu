import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { knowledgeStore } from '../src/knowledge/store.js'
import { converterRegistry, BUILTIN_CONVERTERS } from '../src/knowledge/converter-registry.js'

let tmpRoot: string
let kbRoot: string

beforeAll(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'tianshu-kb-conv-'))
  kbRoot = join(tmpRoot, 'docs')
  mkdirSync(kbRoot, { recursive: true })
  writeFileSync(join(kbRoot, 'README.md'), '# 手册\n\n转换测试。', 'utf-8')
  process.env.TIANSHU_DATA_DIR = join(tmpRoot, 'data')
  mkdirSync(join(tmpRoot, 'data'), { recursive: true })
})

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
  delete process.env.TIANSHU_DATA_DIR
})

describe('converter-registry（外部转换器注册表）', () => {
  let kbId = ''

  it('内置目录包含 paddleocr 与 anydoc，且带安装/探测命令', () => {
    const ids = BUILTIN_CONVERTERS.map(c => c.id)
    expect(ids).toContain('paddleocr')
    expect(ids).toContain('anydoc')
    const ocr = BUILTIN_CONVERTERS.find(c => c.id === 'paddleocr')!
    expect(ocr.installCommand).toContain('pip install paddleocr')
    expect(ocr.detectCommand).toBe('paddleocr --version')
    expect(ocr.inputExtensions).toContain('.pdf')
    const anydoc = BUILTIN_CONVERTERS.find(c => c.id === 'anydoc')!
    expect(anydoc.installCommand).toContain('npm install -g @firecrawl/anydoc')
    expect(anydoc.detectCommand).toBe('anydoc --version')
    expect(anydoc.inputExtensions).toContain('.docx')
  })

  it('list 返回全部转换器并带 detected 可用性字段', () => {
    const list = converterRegistry.list(true)
    expect(list.length).toBeGreaterThanOrEqual(2)
    for (const c of list) {
      expect(typeof c.detected).toBe('boolean')
      expect(typeof c.installed).toBe('boolean')
      expect(Array.isArray(c.inputExtensions)).toBe(true)
    }
  })

  it('install 登记后 converters.json 落盘，installed=true', () => {
    const desc = converterRegistry.install('paddleocr')
    expect(desc).not.toBeNull()
    expect(desc!.id).toBe('paddleocr')
    expect(desc!.installed).toBe(true)
    const file = join(process.env.TIANSHU_DATA_DIR!, 'knowledge', 'converters.json')
    expect(existsSync(file)).toBe(true)
    const stored = JSON.parse(readFileSync(file, 'utf-8'))
    expect(stored.paddleocr.installed).toBe(true)
  })

  it('未知转换器 install 抛错', () => {
    expect(() => converterRegistry.install('nope')).toThrow(/未知转换器/)
  })

  it('store.upsertConverted / getConverted / listConverted 生命周期', () => {
    const created = knowledgeStore.create({ name: '转换库', rootPath: kbRoot })
    kbId = created.id
    knowledgeStore.upsertConverted(kbId, {
      fileName: 'report.pdf',
      mdRelPath: 'normalized/report.md',
      status: 'pending',
      converter: 'paddleocr',
      updatedAt: Date.now(),
    })
    const rec = knowledgeStore.getConverted(kbId, 'report.pdf')
    expect(rec).not.toBeNull()
    expect(rec!.status).toBe('pending')
    expect(knowledgeStore.listConverted(kbId).length).toBe(1)
    // 更新同文件 → 覆盖不新增
    knowledgeStore.upsertConverted(kbId, {
      fileName: 'report.pdf',
      mdRelPath: 'normalized/report.md',
      status: 'indexed',
      converter: 'paddleocr',
      updatedAt: Date.now(),
    })
    expect(knowledgeStore.listConverted(kbId).length).toBe(1)
    expect(knowledgeStore.getConverted(kbId, 'report.pdf')!.status).toBe('indexed')
  })

  it('store.saveOriginal / saveNormalized / readNormalized 落盘', () => {
    const orig = knowledgeStore.saveOriginal(kbId, 'report.pdf', Buffer.from('%PDF-1.4'))
    expect(existsSync(orig)).toBe(true)
    const rel = knowledgeStore.saveNormalized(kbId, 'report.pdf', '# 转换结果\n\n正文')
    expect(rel).toBe('normalized/report.md')
    const content = knowledgeStore.readNormalized(kbId, 'report.md')
    expect(content).toContain('转换结果')
  })
})
