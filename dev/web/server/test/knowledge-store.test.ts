import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { knowledgeStore, type KnowledgeBase } from '../src/knowledge/store.js'

let tmpRoot: string
let tmpKb: string

beforeAll(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'tianshu-kb-store-'))
  tmpKb = join(tmpRoot, 'kb-src')
})

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
})

beforeEach(() => {
  // 每个用例独立 dataDir，避免注册表互相污染
  const { rmSync: rm, mkdirSync } = require('fs') as typeof import('fs')
  rmSync(join(tmpRoot, 'data'), { recursive: true, force: true })
  mkdirSync(join(tmpRoot, 'data'), { recursive: true })
  process.env.TIANSHU_DATA_DIR = join(tmpRoot, 'data')
})

function makeBase(name = '测试库', root = tmpKb): KnowledgeBase {
  return knowledgeStore.create({ name, description: 'desc', rootPath: root })
}

describe('knowledgeStore 注册表', () => {
  it('初始为空，创建后可见，数据落盘到 <dataDir>/knowledge/bases.json', () => {
    expect(knowledgeStore.list()).toEqual([])
    const kb = makeBase()
    expect(kb.id).toBeTruthy()
    expect(kb.rootPath).toBe(tmpKb)
    const fromDisk = knowledgeStore.list()
    expect(fromDisk).toHaveLength(1)
    expect(fromDisk[0]).toMatchObject({ name: '测试库', description: 'desc', rootPath: tmpKb })
  })

  it('name 重复 / rootPath 重复 / 相对路径均拒绝', () => {
    makeBase('同名')
    expect(() => makeBase('同名')).toThrow(/名称已存在/)
    expect(() => knowledgeStore.create({ name: '另一名', rootPath: tmpKb })).toThrow(/已注册/)
    expect(() => knowledgeStore.create({ name: '相对路径', rootPath: 'relative/dir' })).toThrow(/绝对路径/)  })

  it('update 改名/描述，rootPath 不可改', () => {
    const kb = makeBase()
    const updated = knowledgeStore.update(kb.id, { name: '新名', description: 'new desc' })
    expect(updated?.name).toBe('新名')
    expect(updated?.description).toBe('new desc')
    expect(updated?.rootPath).toBe(tmpKb)
    expect(knowledgeStore.update('nonexistent-id', { name: '另一库' })).toBeNull()
  })

  it('delete 只删注册记录，不删目录', () => {
    const kb = makeBase()
    expect(knowledgeStore.delete(kb.id)).toBe(true)
    expect(knowledgeStore.get(kb.id)).toBeNull()
    expect(knowledgeStore.delete(kb.id)).toBe(false)
  })
})

describe('knowledgeStore 文件扫描与读取', () => {
  let kb: KnowledgeBase
  let sub: string
  beforeAll(() => {
    const { mkdirSync, writeFileSync } = require('fs') as typeof import('fs')
    const { join: p } = require('path') as typeof import('path')
    sub = p(tmpKb, '子目录')
    mkdirSync(sub, { recursive: true })
    writeFileSync(p(tmpKb, 'README.md'), '# README\n\nhello 天枢', 'utf-8')
    writeFileSync(p(sub, '指南.markdown'), '## 指南\n\ncontent', 'utf-8')
    writeFileSync(p(tmpKb, '笔记.txt'), 'plain text', 'utf-8')
    writeFileSync(p(tmpKb, '图片.png'), 'not a doc', 'utf-8')
    writeFileSync(p(tmpKb, '.hidden.md'), 'hidden', 'utf-8')
  })

  it('递归扫描 .md/.markdown/.txt；可转换文档（png/txt）也列出并带 converters 选项；跳过隐藏文件', () => {
    kb = makeBase()
    const { files } = knowledgeStore.listFiles(kb.id)!
    const rels = files.map(f => f.relPath).sort()
    expect(rels).toEqual(['README.md', '图片.png', '子目录/指南.markdown', '笔记.txt'])
    const guide = files.find(f => f.relPath === '子目录/指南.markdown')!
    expect(guide.dir).toBe('子目录')
    expect(guide.ext).toBe('.markdown')
    expect(guide.size).toBeGreaterThan(0)
    const png = files.find(f => f.relPath === '图片.png')!
    expect(png.converters).toContain('paddleocr')
    expect(png.converters).not.toContain('anydoc')
    expect(png.hasMd).toBe(false)
    const txt = files.find(f => f.relPath === '笔记.txt')!
    // .txt 保持 P1 直接可读，不进入转换池（AnyDoc 未声明 .txt）
    expect(txt.converters).toEqual([])
  })

  it('readFile 按 relPath 读取内容；越界路径抛错；不存在返回 null', () => {
    kb = makeBase()
    const doc = knowledgeStore.readFile(kb.id, 'README.md')!
    expect(doc.content).toContain('# README')
    expect(knowledgeStore.readFile(kb.id, '不存在.md')).toBeNull()
    expect(() => knowledgeStore.readFile(kb.id, '../outside.md')).toThrow(/escapes/)
  })

  it('未知 kb 返回 null', () => {
    expect(knowledgeStore.listFiles('nope')).toBeNull()
    expect(knowledgeStore.readFile('nope', 'a.md')).toBeNull()
  })
})
