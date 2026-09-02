import { existsSync, mkdirSync, mkdtempSync, rmSync, cpSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { startTianshuServer } from '../src/app.js'
import { getDataDir } from '../src/config.js'
import type { TianshuServer } from '../src/app.js'

// 注意：config 的 getDataDir() 在模块加载时即基于 setup 注入的 TIANSHU_DATA_DIR 缓存，
// server 运行期只读该缓存目录（单层化）。本测试一律用 getDataDir() 取真实 dataDir，
// 避免与自建变量错配。builtinContentRoot() 每次读 TIANSHU_BUILTIN_CONTENT_DIR，可逐用例覆盖。

let root: string
let builtinSrc: string
/** Track servers opened during each test so afterEach can close them even on failure. */
let openServers: TianshuServer[] = []

const SRC = resolve(process.cwd(), '../../content/builtin')

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'tianshu-sl-e2e-'))
  builtinSrc = mkdtempSync(join(tmpdir(), 'tianshu-builtin-src-'))
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
  delete process.env.TIANSHU_BUILTIN_CONTENT_DIR
})

afterEach(async () => {
  // Close any servers left open by the test (e.g. if it failed midway).
  // Must happen BEFORE rmSync to release DB file handles on Windows.
  for (const s of openServers) {
    try { await s.close() } catch { /* best-effort */ }
  }
  openServers = []
})

beforeEach(() => {
  // 每用例前重建干净的 builtin 源副本 + 清空真实 dataDir（单层化：运行链路只读 dataDir）。
  rmSync(builtinSrc, { recursive: true, force: true })
  cpSync(SRC, builtinSrc, { recursive: true })
  process.env.TIANSHU_BUILTIN_CONTENT_DIR = builtinSrc
  rmSync(getDataDir(), { recursive: true, force: true })
  mkdirSync(getDataDir(), { recursive: true })
})

describe('内置内容单层化端到端（验证标准 3/4/5）', () => {
  it('seed→修改→重启保留；篡改→reimport 恢复出厂且用户自建保留', async () => {
    const server = await startTianshuServer({ host: '127.0.0.1', port: 0 })
    openServers.push(server)
    await (await fetch(`${server.url}/api/dataspace`)).json() // 触发 seed 兜底
    const chars = await (await fetch(`${server.url}/api/characters`)).json()
    const builtin = chars.find((c: any) => c.source === 'builtin')
    expect(builtin).toBeTruthy()
    // 五类已 seed 进 dataDir（真实路径）
    expect(existsSync(join(getDataDir(), 'characters', builtin.id, 'character.json'))).toBe(true)
    expect(existsSync(join(getDataDir(), 'iconpacks'))).toBe(true)
    expect(existsSync(join(getDataDir(), 'prompts', 'builtin-default.md'))).toBe(true)
    expect(existsSync(join(getDataDir(), 'providers'))).toBe(true)

    // 修改一项内置角色（写 dataDir 用户层副本 + source=user）
    const { characterMetaStore } = await import('../src/db/characterStore.js')
    characterMetaStore.update(builtin.id, { name: '被我改过' })
    await server.close()

    // 重启进程（同 dataDir）→ 用户修改保留（文件级持久）
    const server2 = await startTianshuServer({ host: '127.0.0.1', port: 0 })
    openServers.push(server2)
    await (await fetch(`${server2.url}/api/dataspace`)).json()
    const chars2 = await (await fetch(`${server2.url}/api/characters`)).json()
    const edited = chars2.find((c: any) => c.id === builtin.id)
    expect(edited.name).toBe('被我改过')
    expect(edited.source).toBe('user')
    expect(edited.overridesBuiltin).toBe(true)

    // 用户自建一项（绝不参与 reimport）
    characterMetaStore.create({ name: '我的自建角色' })
    const created = characterMetaStore.getAll().find((c) => c.name === '我的自建角色')!
    expect(created.source).toBe('user')

    // 篡改 dataDir：删除另一个内置角色目录
    const otherBuiltin = chars2.find((c: any) => c.source === 'builtin' && c.id !== builtin.id)
    if (otherBuiltin) rmSync(join(getDataDir(), 'characters', otherBuiltin.id), { recursive: true, force: true })

    // POST /reimport-builtin：恢复出厂 + 保留用户自建
    const reimportRes = await fetch(`${server2.url}/api/config/reimport-builtin`, { method: 'POST' })
    expect(reimportRes.status).toBe(200)
    const reimportBody = await reimportRes.json()
    expect(reimportBody.ok).toBe(true)

    const chars3 = await (await fetch(`${server2.url}/api/characters`)).json()
    if (otherBuiltin) {
      const restored = chars3.find((c: any) => c.id === otherBuiltin.id)
      expect(restored).toBeTruthy()
      expect(restored.source).toBe('builtin') // 删除的内置项被重新物化恢复
    }
    const custom = chars3.find((c: any) => c.id === created.id)
    expect(custom).toBeTruthy()
    expect(custom.source).toBe('user') // 用户自建保留
    const stillEdited = chars3.find((c: any) => c.id === builtin.id)
    expect(stillEdited.source).toBe('builtin') // 被改的内置项也恢复出厂
    expect(stillEdited.name).not.toBe('被我改过')

    await server2.close()
  })

  it('删除 content/builtin→启动正常且已有 dataDir 内容可读（回归标准4）', async () => {
    const server = await startTianshuServer({ host: '127.0.0.1', port: 0 })
    openServers.push(server)
    await (await fetch(`${server.url}/api/dataspace`)).json()
    const before = await (await fetch(`${server.url}/api/characters`)).json()
    expect(before.some((c: any) => c.source === 'builtin')).toBe(true)
    await server.close()

    // 删除 content/builtin 源（模拟安装包缺失出厂底稿）
    rmSync(builtinSrc, { recursive: true, force: true })

    // 重启 server（builtin 源缺失）→ 正常启动
    const server2 = await startTianshuServer({ host: '127.0.0.1', port: 0 })
    openServers.push(server2)
    const health = await fetch(`${server2.url}/health`)
    expect(health.status).toBe(200)
    // 已有 dataDir 内容（单层化副本）仍可读
    const chars = await (await fetch(`${server2.url}/api/characters`)).json()
    expect(chars.length).toBeGreaterThan(0)
    expect(chars.some((c: any) => c.source === 'builtin')).toBe(true)
    await server2.close()
  })
})
