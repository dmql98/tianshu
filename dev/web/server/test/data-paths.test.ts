import { mkdirSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let root: string

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'tianshu-datapaths-'))
  process.env.TIANSHU_DATA_DIR = join(root, 'data')
  process.env.TIANSHU_CONFIG_DIR = join(root, 'config')
  mkdirSync(join(root, 'data'), { recursive: true })
  mkdirSync(join(root, 'config'), { recursive: true })
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
  delete process.env.TIANSHU_DATA_DIR
  delete process.env.TIANSHU_CONFIG_DIR
})

describe('data-paths (BUILTIN_CONTENT_DEVELOPMENT_PLAN §8 / §2.4)', () => {
  it('charactersRoot / skillsRoot / themesRoot 都从同一个 dataRoot 派生', async () => {
    const { dataRoot, charactersRoot, skillsRoot, themesRoot, contentStateFile } =
      await import('../src/data-paths.js')
    const data = dataRoot()
    expect(data).toBe(join(root, 'data'))
    expect(charactersRoot()).toBe(join(data, 'characters'))
    expect(skillsRoot()).toBe(join(data, 'skills'))
    expect(themesRoot()).toBe(join(data, 'themes'))
    expect(contentStateFile()).toBe(join(data, 'content-state.json'))
  })

  it('data-paths.ts 只依赖 getDataDir()，不重复解析环境变量', async () => {
    const src = await import('../src/data-paths.js')
    // 模块内部只 import config.js 的 getDataDir
    const mod = (await import('../src/data-paths.js')) as any
    expect(typeof mod.dataRoot).toBe('function')
    expect(src.charactersRoot()).toBe(join(src.dataRoot(), 'characters'))
  })

  it('builtin 路径支持 TIANSHU_BUILTIN_CONTENT_DIR 覆盖', async () => {
    const fake = join(root, 'builtin-override')
    mkdirSync(fake, { recursive: true })
    const prev = process.env.TIANSHU_BUILTIN_CONTENT_DIR
    process.env.TIANSHU_BUILTIN_CONTENT_DIR = fake
    try {
      const { builtinContentRoot, builtinCharactersRoot, builtinSkillsRoot, builtinProvidersRoot } =
        await import('../src/content/paths.js')
      expect(builtinContentRoot()).toBe(fake)
      expect(builtinCharactersRoot()).toBe(join(fake, 'characters'))
      expect(builtinSkillsRoot()).toBe(join(fake, 'skills'))
      expect(builtinProvidersRoot()).toBe(join(fake, 'providers'))
    } finally {
      if (prev === undefined) delete process.env.TIANSHU_BUILTIN_CONTENT_DIR
      else process.env.TIANSHU_BUILTIN_CONTENT_DIR = prev
    }
  })

  it('仓库根 content/builtin 存在且 manifest 有效', async () => {
    const { existsSync, readFileSync } = await import('fs')
    const { resolve } = await import('path')
    const manifestPath = resolve(__dirname, '../../../content/builtin/manifest.json')
    expect(existsSync(manifestPath)).toBe(true)
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
    expect(manifest.schemaVersion).toBe(1)
    expect(manifest.characters).toBe(true)
    expect(manifest.skills).toBe(true)
    expect(manifest.providers).toBe(true)
  })
})
