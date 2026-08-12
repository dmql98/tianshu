import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  getIconPath,
  getPreset,
  loadCatalog,
} from '../src/provider-catalog/loader.js'

/**
 * Catalog loader 单元测试。
 * 每个用例使用独立临时目录 + TIANSHU_PROVIDER_CATALOG_DIR，互不干扰。
 */

let root: string

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'tianshu-catalog-'))
  process.env.TIANSHU_PROVIDER_CATALOG_DIR = root
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
  delete process.env.TIANSHU_PROVIDER_CATALOG_DIR
})

function newCase(name: string): string {
  const dir = join(root, name.replace(/\s+/g, '-'))
  mkdirSync(dir, { recursive: true })
  process.env.TIANSHU_PROVIDER_CATALOG_DIR = dir
  return dir
}

function writeProvider(dir: string, id: string, overrides: Record<string, unknown> = {}) {
  const preset = {
    schemaVersion: 1,
    id,
    name: id,
    format: 'openai',
    runtime: { plugin: 'openai' },
    baseUrl: 'https://api.example.com/v1',
    icon: 'icon.svg',
    ...overrides,
  }
  mkdirSync(join(dir, id), { recursive: true })
  writeFileSync(join(dir, id, 'provider.json'), JSON.stringify(preset), 'utf-8')
  writeFileSync(join(dir, id, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>', 'utf-8')
}

function issueMessages(dir: string): string[] {
  return loadCatalog().issues.filter(i => i.dir === dir).map(i => i.message)
}

describe('provider-catalog loader', () => {
  it('发现合法 Provider 并返回标准化预设', () => {
    const dir = newCase('valid')
    writeProvider(dir, 'openai')
    writeProvider(dir, 'anthropic', { format: 'anthropic', runtime: { plugin: 'anthropic' } })

    const { presets } = loadCatalog()
    const ids = presets.map(p => p.id)
    expect(ids).toContain('openai')
    expect(ids).toContain('anthropic')
    const openai = presets.find(p => p.id === 'openai')!
    expect(openai.runtime.plugin).toBe('openai')
    expect(openai.baseUrl).toBe('https://api.example.com/v1')
    expect(openai.icon).toBe('icon.svg')
  })

  it('忽略非目录文件（README、LICENSES 等）', () => {
    const dir = newCase('ignore-files')
    writeFileSync(join(dir, 'README.md'), '# catalog', 'utf-8')
    writeFileSync(join(dir, 'LICENSES.md'), 'licenses', 'utf-8')
    writeProvider(dir, 'openai')

    const { presets, issues } = loadCatalog()
    expect(presets.map(p => p.id)).toEqual(['openai'])
    expect(issues.filter(i => i.dir === 'README.md' || i.dir === 'LICENSES.md')).toEqual([])
  })

  it('缺少 provider.json 时跳过并报告', () => {
    const dir = newCase('missing-json')
    mkdirSync(join(dir, 'broken'), { recursive: true })

    expect(issueMessages('broken')).toContain('缺少 provider.json，跳过')
    expect(loadCatalog().presets).toEqual([])
  })

  it('JSON 无效时跳过并报告', () => {
    const dir = newCase('bad-json')
    mkdirSync(join(dir, 'broken'), { recursive: true })
    writeFileSync(join(dir, 'broken', 'provider.json'), '{ not json', 'utf-8')

    expect(issueMessages('broken')[0]).toContain('不是合法 JSON')
  })

  it('schemaVersion 不支持时报告', () => {
    const dir = newCase('bad-schema')
    mkdirSync(join(dir, 'broken'), { recursive: true })
    writeFileSync(join(dir, 'broken', 'provider.json'), JSON.stringify({ schemaVersion: 2, id: 'broken' }), 'utf-8')

    expect(issueMessages('broken')[0]).toContain('校验失败')
  })

  it('id 与目录名不一致时跳过', () => {
    const dir = newCase('id-mismatch')
    writeProvider(dir, 'mismatched', { id: 'other-id' })

    expect(issueMessages('mismatched')[0]).toContain('不一致')
    expect(loadCatalog().presets).toEqual([])
  })

  it('runtime plugin 不存在时跳过并报告', () => {
    const dir = newCase('bad-plugin')
    writeProvider(dir, 'ghost', { runtime: { plugin: 'no-such-plugin' } })

    expect(issueMessages('ghost')[0]).toContain('不存在于 provider registry')
    expect(loadCatalog().presets).toEqual([])
  })

  it('icon 文件不存在时跳过并报告', () => {
    const dir = newCase('missing-icon')
    const preset = {
      schemaVersion: 1,
      id: 'nope',
      name: 'Nope',
      format: 'openai',
      runtime: { plugin: 'openai' },
      baseUrl: 'https://api.example.com/v1',
      icon: 'missing.svg',
    }
    mkdirSync(join(dir, 'nope'), { recursive: true })
    writeFileSync(join(dir, 'nope', 'provider.json'), JSON.stringify(preset), 'utf-8')

    expect(issueMessages('nope')[0]).toContain('icon 文件不存在')
  })

  it('阻止 ../ 路径逃逸与绝对路径图标', () => {
    const dir = newCase('path-escape')
    writeProvider(dir, 'escape-a', { icon: '../evil.svg' })
    writeProvider(dir, 'escape-b', { icon: '/etc/passwd' })

    expect(issueMessages('escape-a')[0]).toContain('非法')
    expect(issueMessages('escape-b')[0]).toContain('非法')
    expect(getIconPath('escape-a')).toBeUndefined()
  })

  it('enabled: false 不对客户端返回，但 getPreset 也拒绝', () => {
    const dir = newCase('disabled')
    writeProvider(dir, 'hidden', { enabled: false })

    expect(loadCatalog().presets).toEqual([])
    expect(getPreset('hidden')).toBeUndefined()
    expect(getIconPath('hidden')).toBeUndefined()
  })

  it('排序：popular 优先、sortOrder 升序、name 兜底', () => {
    const dir = newCase('sorting')
    const cases = [
      ['b-provider', {}, ''],
      ['a-regular', {}, ''],
      ['z-popular', { popular: true, sortOrder: 100 }, ''],
      ['c-popular', { popular: true, sortOrder: 5 }, ''],
    ] as const
    for (const [id, ov] of cases) writeProvider(dir, id, ov as Record<string, unknown>)

    const ids = loadCatalog().presets.map(p => p.id)
    // popular 组在前，内部按 sortOrder；之后 sortOrder 缺省按 name
    expect(ids).toEqual(['c-popular', 'z-popular', 'a-regular', 'b-provider'])
  })

  it('单个损坏条目不影响其他 Provider 加载', () => {
    const dir = newCase('mixed')
    writeProvider(dir, 'good-1')
    writeProvider(dir, 'bad', { runtime: { plugin: 'nope' } })
    writeProvider(dir, 'good-2')

    const { presets, issues } = loadCatalog()
    expect(presets.map(p => p.id).sort()).toEqual(['good-1', 'good-2'])
    expect(issues.some(i => i.dir === 'bad')).toBe(true)
  })

  it('getIconPath 返回注册 Provider 的图标绝对路径，未知 ID 返回 undefined', () => {
    const dir = newCase('icon-path')
    writeProvider(dir, 'openai')

    const icon = getIconPath('openai')
    expect(icon).toBe(join(dir, 'openai', 'icon.svg'))
    expect(getIconPath('unknown')).toBeUndefined()
  })
})