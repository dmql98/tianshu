import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startTianshuServer } from '../src/app.js'

let tmpData: string

beforeAll(() => {
  tmpData = mkdtempSync(join(tmpdir(), 'tianshu-lifecycle-'))
  process.env.TIANSHU_DATA_DIR = tmpData
})

afterAll(() => {
  rmSync(tmpData, { recursive: true, force: true })
  delete process.env.TIANSHU_DATA_DIR
})

describe('startTianshuServer lifecycle', () => {
  it('binds a dynamic loopback port, serves /health, closes, and frees the port', async () => {
    const server = await startTianshuServer({ host: '127.0.0.1', port: 0 })
    expect(server.host).toBe('127.0.0.1')
    expect(server.port).toBeGreaterThan(0)
    expect(server.url).toBe(`http://127.0.0.1:${server.port}`)

    const res = await fetch(`${server.url}/health`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })

    const originalPort = server.port
    await server.close()
    // close() must be idempotent
    await server.close()

    // After shutdown the port can be re-bound.
    const server2 = await startTianshuServer({ host: '127.0.0.1', port: originalPort })
    expect(server2.port).toBe(originalPort)
    const res2 = await fetch(`${server2.url}/health`)
    expect(res2.status).toBe(200)
    await server2.close()
  })

  it('serves clientDist static assets with SPA fallback', async () => {
    const fixture = mkdtempSync(join(tmpdir(), 'tianshu-static-'))
    const { writeFileSync, mkdirSync } = await import('fs')
    mkdirSync(join(fixture, 'assets'), { recursive: true })
    writeFileSync(join(fixture, 'index.html'), '<html><body>tianshu</body></html>', 'utf-8')
    writeFileSync(join(fixture, 'assets', 'app.js'), 'console.log(1)', 'utf-8')

    const server = await startTianshuServer({ host: '127.0.0.1', port: 0, clientDist: fixture })
    try {
      const root = await fetch(`${server.url}/`)
      expect(root.status).toBe(200)
      expect(await root.text()).toContain('tianshu')
      expect(root.headers.get('cache-control')).toBe('no-cache')

      const asset = await fetch(`${server.url}/assets/app.js`)
      expect(asset.status).toBe(200)
      expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')

      // React Router deep link falls back to index.html
      const deep = await fetch(`${server.url}/chat/some-session`)
      expect(deep.status).toBe(200)
      expect(await deep.text()).toContain('tianshu')

      // Unmatched API returns JSON 404, not the SPA shell
      const api = await fetch(`${server.url}/api/does-not-exist`)
      expect(api.status).toBe(404)
      expect(api.headers.get('content-type') || '').toContain('application/json')

      // Path traversal must be rejected
      const traversal = await fetch(`${server.url}/..%2f..%2fsecret.txt`)
      expect(traversal.status).toBe(403)
    } finally {
      await server.close()
      rmSync(fixture, { recursive: true, force: true })
    }
  })
})
