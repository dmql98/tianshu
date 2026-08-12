import { mkdirSync, mkdtempSync, rmSync, readFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SYSTEM_RUN_POLICY } from '../src/agent/loop/run-policy.js'

let root: string
let configRouter: any

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'tianshu-runpolicy-'))
  process.env.TIANSHU_CONFIG_DIR = join(root, 'config')
  process.env.TIANSHU_DATA_DIR = join(root, 'data')
  const mod = await import('../src/routes/config.js')
  configRouter = mod.default
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
  delete process.env.TIANSHU_CONFIG_DIR
  delete process.env.TIANSHU_DATA_DIR
})

beforeEach(() => {
  rmSync(root, { recursive: true, force: true })
  mkdirSync(join(root, 'config'), { recursive: true })
  mkdirSync(join(root, 'data'), { recursive: true })
})

// Hono app.request helper
async function request(method: string, path: string, body?: unknown) {
  const req = new Request(`http://localhost${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  return configRouter.request(req)
}

describe('system run-policy API', () => {
  it('GET returns normalized defaults when unconfigured', async () => {
    const res = await request('GET', '/run-policy')
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.policy).toEqual(DEFAULT_SYSTEM_RUN_POLICY)
    expect(data.defaults).toEqual(DEFAULT_SYSTEM_RUN_POLICY)
  })

  it('PUT normalizes and atomically persists to config.json', async () => {
    const res = await request('PUT', '/run-policy', {
      policy: { maxAbsoluteTurnsPerRun: 5, defaultSoftTurns: 999, maxGraceTurns: 999 },
    })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.policy.maxAbsoluteTurnsPerRun).toBe(5)
    expect(data.policy.defaultSoftTurns).toBe(5)
    expect(data.policy.maxGraceTurns).toBe(4)

    const raw = JSON.parse(readFileSync(join(root, 'config', 'config.json'), 'utf-8'))
    expect(raw.runPolicy.maxAbsoluteTurnsPerRun).toBe(5)
  })

  it('PUT preserves dataDir and unknown config fields', async () => {
    // Simulate an existing config with dataDir + unknown field.
    mkdirSync(join(root, 'config'), { recursive: true })
    const file = join(root, 'config', 'config.json')
    require('fs').writeFileSync(file, JSON.stringify({ dataDir: join(root, 'data'), someFutureField: 'keep-me' }), 'utf-8')

    const res = await request('PUT', '/run-policy', { policy: { defaultSoftTurns: 80 } })
    expect(res.status).toBe(200)
    const raw = JSON.parse(readFileSync(file, 'utf-8'))
    expect(raw.dataDir).toBe(join(root, 'data'))
    expect(raw.someFutureField).toBe('keep-me')
    expect(raw.runPolicy.defaultSoftTurns).toBe(80)
  })

  it('POST reset restores defaults', async () => {
    await request('PUT', '/run-policy', { policy: { defaultSoftTurns: 80 } })
    const res = await request('POST', '/run-policy/reset')
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.policy).toEqual(DEFAULT_SYSTEM_RUN_POLICY)
  })

  it('corrupt runPolicy does not break dataDir', async () => {
    const file = join(root, 'config', 'config.json')
    require('fs').writeFileSync(file, JSON.stringify({ dataDir: join(root, 'data'), runPolicy: 'not-an-object' }), 'utf-8')
    const res = await request('GET', '/run-policy')
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.policy).toEqual(DEFAULT_SYSTEM_RUN_POLICY)
  })
})

