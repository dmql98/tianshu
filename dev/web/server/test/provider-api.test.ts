import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * Provider API 测试。
 * 使用独立临时 catalog 目录 + TIANSHU_PROVIDER_CATALOG_DIR / TIANSHU_DATA_DIR。
 * 必须在导入路由前设置 env：config.ts 首次调用 getDataDir() 时会缓存结果，
 * 静态 import 会触发 providerStore 的 ensureIds()，从而把数据目录固定到默认路径。
 */

let root: string
let providersRouter: any

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'tianshu-api-'))
  process.env.TIANSHU_PROVIDER_CATALOG_DIR = root
  process.env.TIANSHU_DATA_DIR = root
  const mod = await import('../src/routes/providers.js')
  providersRouter = mod.default
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
  delete process.env.TIANSHU_PROVIDER_CATALOG_DIR
  delete process.env.TIANSHU_DATA_DIR
  delete process.env.OPENAI_API_KEY
})

beforeEach(() => {
  delete process.env.OPENAI_API_KEY
  rmSync(root, { recursive: true, force: true })
  mkdirSync(root, { recursive: true })
  const dir = join(root, 'openai')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'provider.json'), JSON.stringify({
    schemaVersion: 1,
    id: 'openai',
    name: 'OpenAI',
    description: 'OpenAI API',
    format: 'openai',
    runtime: { plugin: 'openai' },
    baseUrl: 'https://api.openai.com/v1/',
    env: ['OPENAI_API_KEY'],
    icon: 'icon.svg',
    popular: true,
    sortOrder: 10,
  }), 'utf-8')
  writeFileSync(join(dir, 'icon.svg'), '<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"></svg>', 'utf-8')
})

async function getBuiltin(): Promise<any[]> {
  const res = await providersRouter.request('/builtin')
  expect(res.status).toBe(200)
  return res.json()
}

describe('provider API', () => {
  it('GET /builtin 返回标准化预设列表', async () => {
    const list = await getBuiltin()
    expect(list).toHaveLength(1)
    const p = list[0]
    expect(p.id).toBe('openai')
    expect(p.name).toBe('OpenAI')
    expect(p.format).toBe('openai')
    expect(p.runtime_plugin).toBe('openai')
    expect(p.base_url).toBe('https://api.openai.com/v1/')
    expect(p.env).toEqual(['OPENAI_API_KEY'])
    expect(p.icon_url).toBe('/api/providers/builtin/openai/icon')
    expect(p.popular).toBe(true)
    expect(typeof p.sort_order).toBe('number')
    expect(p.fields).toEqual([])
  })

  it('env_available 在环境变量存在时为 true，否则为 false，且不泄露实际值', async () => {
    process.env.OPENAI_API_KEY = 'sk-secret-value'
    const withEnv = await getBuiltin()
    expect(withEnv[0].env_available).toBe(true)
    const raw = JSON.stringify(withEnv)
    expect(raw).not.toContain('sk-secret-value')

    delete process.env.OPENAI_API_KEY
    const withoutEnv = await getBuiltin()
    expect(withoutEnv[0].env_available).toBe(false)
  })

  it('空字符串环境变量视为不可用', async () => {
    process.env.OPENAI_API_KEY = ''
    const list = await getBuiltin()
    expect(list[0].env_available).toBe(false)
  })

  it('GET /builtin 不返回用户已保存的 Provider 记录（不写 providers.json）', async () => {
    const list = await getBuiltin()
    expect(list.some((p: any) => 'api_key' in p)).toBe(false)
    expect(list.some((p: any) => 'has_api_key' in p)).toBe(false)
  })

  it('图标接口返回正确 MIME 与安全头/缓存头', async () => {
    const res = await providersRouter.request('/builtin/openai/icon')
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/svg+xml')
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(res.headers.get('Cache-Control')).toContain('max-age')
    expect(res.headers.get('ETag')).toBeTruthy()
    expect(res.headers.get('Last-Modified')).toBeTruthy()
  })

  it('图标接口支持 ETag 协商返回 304', async () => {
    const first = await providersRouter.request('/builtin/openai/icon')
    const etag = first.headers.get('ETag')!
    const second = await providersRouter.request('/builtin/openai/icon', {
      headers: { 'If-None-Match': etag },
    })
    expect(second.status).toBe(304)
  })

  it('未知 Provider 图标返回 404', async () => {
    const res = await providersRouter.request('/builtin/no-such-provider/icon')
    expect(res.status).toBe(404)
  })

  it('非法 ID 不能读取任意文件（路径逃逸被拒绝）', async () => {
    for (const bad of ['../secret', '..%2fsecret', '%2e%2e%2fsecret']) {
      const res = await providersRouter.request(`/builtin/${bad}/icon`)
      expect(res.status).toBe(404)
    }
  })

  it('GET /builtin 不会把路径参数当作用户 Provider 路由', async () => {
    const res = await providersRouter.request('/builtin/openai')
    expect(res.status).toBe(404)
  })

  it('POST / 创建带 preset_id 的 Provider，重复 preset_id 返回 409', async () => {
    const body = {
      id: 'openai',
      name: 'OpenAI',
      base_url: 'https://api.openai.com/v1/',
      api_key: 'sk-x',
      models: [],
      preset_id: 'openai',
      runtime_plugin: 'openai',
      format: 'openai',
    }
    const first = await providersRouter.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    expect(first.status).toBe(201)

    const dup = await providersRouter.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, id: 'openai-2' }),
    })
    expect(dup.status).toBe(409)
    const dupJson = await dup.json()
    expect(dupJson.error).toContain('已添加')

    // 自定义 Provider 无 preset_id，可重复添加
    const custom = await providersRouter.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'custom-1', name: 'Custom', base_url: 'https://x/', models: [] }),
    })
    expect(custom.status).toBe(201)
  })
})
