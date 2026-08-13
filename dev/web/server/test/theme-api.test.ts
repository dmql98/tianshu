import { mkdirSync, mkdtempSync, rmSync, readFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { ThemeRecord } from '../src/theme/schema.js'
import { themesRoot } from '../src/data-paths.js'

let root: string
let themesRouter: any

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'tianshu-theme-api-'))
  process.env.TIANSHU_CONFIG_DIR = join(root, 'config')
  process.env.TIANSHU_DATA_DIR = join(root, 'data')
  const mod = await import('../src/routes/themes.js')
  themesRouter = mod.default
  mod.initThemeStore()
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
  delete process.env.TIANSHU_CONFIG_DIR
  delete process.env.TIANSHU_DATA_DIR
})

beforeEach(() => {
  rmSync(join(root, 'data', 'themes'), { recursive: true, force: true })
  mkdirSync(themesRoot(), { recursive: true })
})

async function request(method: string, path: string, body?: unknown) {
  const req = new Request(`http://localhost${path}`, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  return themesRouter.request(req)
}

function validColors() {
  return {
    canvas: '#111713',
    surface1: '#1b241e',
    input: '#202a23',
    accent: '#8faf76',
    textPrimary: '#f2f5ef',
    textSecondary: '#b8c2b5',
    border: '#435047',
  }
}

function pngFixture(): Uint8Array {
  const bytes = new Uint8Array(33)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  bytes.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8)
  const set32 = (off: number, v: number) => {
    bytes[off] = (v >>> 24) & 0xff
    bytes[off + 1] = (v >>> 16) & 0xff
    bytes[off + 2] = (v >>> 8) & 0xff
    bytes[off + 3] = v & 0xff
  }
  set32(16, 320)
  set32(20, 200)
  bytes[24] = 8
  bytes[25] = 6
  return bytes
}

function multipart(fields: Record<string, string>, files: Record<string, { bytes: Uint8Array; name: string }> = {}) {
  const form = new FormData()
  for (const [key, value] of Object.entries(fields)) form.append(key, value)
  for (const [key, file] of Object.entries(files)) {
    form.append(key, new Blob([file.bytes], { type: 'application/octet-stream' }), file.name)
  }
  return new Request('http://localhost/', { method: 'POST', body: form })
}

async function createTheme(name = '森林') {
  const req = multipart(
    {
      name,
      appearance: 'dark',
      colors: JSON.stringify(validColors()),
      artwork: JSON.stringify({ focusX: 0.5, focusY: 0.5, homeOpacity: 0.8, taskOpacity: 0.35, dim: 0.2 }),
    },
    { background: { bytes: pngFixture(), name: 'bg.png' } },
  )
  const res = await themesRouter.request(req)
  return { res, record: (await res.json()) as ThemeRecord }
}

describe('themes API: 列表与读取', () => {
  it('空目录返回空列表', async () => {
    const res = await request('GET', '/')
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.themes).toEqual([])
  })

  it('创建后列表/读取/资产可访问', async () => {
    const { res, record } = await createTheme()
    expect(res.status).toBe(201)
    expect(record.id.startsWith('custom-')).toBe(true)
    expect(record.artwork?.file).toBe('background.png')

    const listRes = await request('GET', '/')
    const list = await listRes.json()
    expect(list.themes.length).toBe(1)

    const getRes = await request('GET', `/${record.id}`)
    expect(getRes.status).toBe(200)
    const single = await getRes.json()
    expect(single.name).toBe('森林')

    const assetRes = await themesRouter.request(new Request(`http://localhost/${record.id}/assets/background.png`))
    expect(assetRes.status).toBe(200)
    expect(assetRes.headers.get('content-type')).toBe('image/png')
    expect(assetRes.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('损坏主题被跳过但接口不失败', async () => {
    await createTheme()
    mkdirSync(join(themesRoot(), 'custom-broken'), { recursive: true })
    // 直接写损坏 theme.json（绕过 API）
    const { writeFileSync } = await import('fs')
    writeFileSync(join(themesRoot(), 'custom-broken', 'theme.json'), '{bad', 'utf-8')
    const res = await request('GET', '/')
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.themes.length).toBe(1)
  })

  it('资产接口拒绝未登记文件与路径穿越', async () => {
    const { record } = await createTheme()
    for (const file of ['theme.json', '../secret.txt', 'a%2Fb.png', 'nope.webp']) {
      const res = await themesRouter.request(new Request(`http://localhost/${record.id}/assets/${file}`))
      expect(res.status).toBe(404)
    }
  })
})

describe('themes API: 创建校验', () => {
  it('缺少核心色板返回 400', async () => {
    const req = multipart({
      name: 'x',
      appearance: 'light',
      colors: JSON.stringify({ canvas: '#fff' }),
      artwork: JSON.stringify({}),
    })
    const res = await themesRouter.request(req)
    expect(res.status).toBe(400)
  })

  it('缺名返回 400', async () => {
    const req = multipart({
      name: '   ',
      appearance: 'light',
      colors: JSON.stringify(validColors()),
      artwork: JSON.stringify({}),
    })
    const res = await themesRouter.request(req)
    expect(res.status).toBe(400)
  })
})

describe('themes API: 更新/复制/删除/重命名', () => {
  it('重命名（JSON {name}）', async () => {
    const { record } = await createTheme()
    const res = await request('PUT', `/${record.id}`, { name: '森林改' })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.name).toBe('森林改')
  })

  it('复制', async () => {
    const { record } = await createTheme()
    const res = await request('POST', `/${record.id}/duplicate`)
    expect(res.status).toBe(201)
    const dup = await res.json()
    expect(dup.id).not.toBe(record.id)
    expect(dup.id.startsWith('custom-')).toBe(true)
  })

  it('删除', async () => {
    const { record } = await createTheme()
    const res = await request('DELETE', `/${record.id}`)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.ok).toBe(true)
    const getRes = await request('GET', `/${record.id}`)
    expect(getRes.status).toBe(404)
  })

  it('未知主题 404', async () => {
    expect((await request('GET', '/custom-ghost')).status).toBe(404)
    expect((await request('PUT', '/custom-ghost', { name: 'x' })).status).toBe(404)
    expect((await request('DELETE', '/custom-ghost')).status).toBe(200)
  })

  it('保存成功后无残留临时目录，theme.json 存在', async () => {
    const { record } = await createTheme()
    const dir = join(themesRoot(), record.id)
    expect(existsSync(join(dir, 'theme.json'))).toBe(true)
    expect(readFileSync(join(dir, 'theme.json'), 'utf-8')).toContain('"schemaVersion": 1')
    const entries = (await import('fs')).readdirSync(themesRoot())
    expect(entries.filter((e: string) => e.startsWith('.tmp-'))).toEqual([])
  })
})
