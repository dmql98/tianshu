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

describe('user preferences API', () => {
  it('GET returns empty by default; PUT persists and survives a server restart', async () => {
    const server = await startTianshuServer({ host: '127.0.0.1', port: 0 })
    try {
      const empty = await (await fetch(`${server.url}/api/user-preferences`)).json()
      expect(empty).toEqual({ schemaVersion: 1 })

      const putRes = await fetch(`${server.url}/api/user-preferences`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          theme: { mode: 'builtin', themeId: 'tianshu-dark' },
          iconPack: { packId: 'lucide' },
        }),
      })
      expect(putRes.status).toBe(200)
      const updated = (await putRes.json()) as { theme?: { themeId?: string } }
      expect(updated.theme?.themeId).toBe('tianshu-dark')

      const refetched = (await (await fetch(`${server.url}/api/user-preferences`)).json()) as {
        theme?: { themeId?: string }
        iconPack?: { packId?: string }
      }
      expect(refetched.theme?.themeId).toBe('tianshu-dark')
      expect(refetched.iconPack?.packId).toBe('lucide')

      // 模拟重启：关掉再起一个同 dataDir 的服务，配置仍在文件里
      await server.close()
      const server2 = await startTianshuServer({ host: '127.0.0.1', port: 0 })
      try {
        const afterRestart = (await (await fetch(`${server2.url}/api/user-preferences`)).json()) as {
          theme?: { themeId?: string }
        }
        expect(afterRestart.theme?.themeId).toBe('tianshu-dark')
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
      const res = await fetch(`${server.url}/api/user-preferences`, {
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