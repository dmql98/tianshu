import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startTianshuServer } from '../src/app.js'

let tmpData: string

beforeAll(() => {
  tmpData = mkdtempSync(join(tmpdir(), 'tianshu-prefs-api-'))
  process.env.TIANSHU_DATA_DIR = tmpData
})

afterAll(() => {
  rmSync(tmpData, { recursive: true, force: true })
  delete process.env.TIANSHU_DATA_DIR
})

describe('preferences API (split per-concern)', () => {
  it('GET returns defaults; PUT persists to its own file and survives a server restart', async () => {
    const server = await startTianshuServer({ host: '127.0.0.1', port: 0 })
    try {
      const themeEmpty = await (await fetch(`${server.url}/api/preferences/theme`)).json()
      expect(themeEmpty).toEqual({ mode: 'system' })
      const iconEmpty = await (await fetch(`${server.url}/api/preferences/iconpack`)).json()
      expect(iconEmpty).toEqual({ packId: 'lucide' })

      const putRes = await fetch(`${server.url}/api/preferences/theme`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'builtin', themeId: 'tianshu-dark' }),
      })
      expect(putRes.status).toBe(200)
      const updated = (await putRes.json()) as { themeId?: string }
      expect(updated.themeId).toBe('tianshu-dark')

      const iconPut = await fetch(`${server.url}/api/preferences/iconpack`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packId: 'lucide' }),
      })
      expect(iconPut.status).toBe(200)

      const refetchedTheme = (await (await fetch(`${server.url}/api/preferences/theme`)).json()) as { themeId?: string }
      expect(refetchedTheme.themeId).toBe('tianshu-dark')

      // 模拟重启：关掉再起一个同 dataDir 的服务，配置仍在文件里
      await server.close()
      const server2 = await startTianshuServer({ host: '127.0.0.1', port: 0 })
      try {
        const afterRestart = (await (await fetch(`${server2.url}/api/preferences/theme`)).json()) as { themeId?: string }
        expect(afterRestart.themeId).toBe('tianshu-dark')
      } finally {
        await server2.close()
      }
    } finally {
      await server.close()
    }
  })

  it('rejects non-object bodies with 400', async () => {
    const server = await startTianshuServer({ host: '127.0.0.1', port: 0 })
    try {
      const res = await fetch(`${server.url}/api/preferences/theme`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify('nope'),
      })
      expect(res.status).toBe(400)
    } finally {
      await server.close()
    }
  })
})
