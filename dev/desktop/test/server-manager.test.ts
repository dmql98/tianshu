import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { ServerManager } from '../src/server-manager.js'

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures')

function makeOpts(serverEntry: string, userDataDir: string) {
  return {
    packaged: true,
    nodePath: process.execPath,
    serverEntry,
    clientDist: fixtures,
    userDataDir,
    readyTimeoutMs: 5000,
    shutdownGraceMs: 2000,
  }
}

describe('ServerManager', () => {
  const cleanup: string[] = []

  afterEach(() => {
    for (const dir of cleanup.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('dev mode returns the dev URL as ready', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tianshu-srvmgr-dev-'))
    cleanup.push(dir)
    const manager = new ServerManager({ ...makeOpts('', dir), packaged: false, devUrl: 'http://127.0.0.1:3457' })
    const status = await manager.start()
    expect(status.phase).toBe('ready')
    if (status.phase === 'ready') {
      expect(status.url).toBe('http://127.0.0.1:3457')
    }
  })

  it('starts a packaged server, becomes ready, and stops gracefully', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tianshu-srvmgr-'))
    cleanup.push(dir)
    const manager = new ServerManager(makeOpts(join(fixtures, 'fake-server.mjs'), dir))

    const status = await manager.start()
    expect(status.phase).toBe('ready')
    if (status.phase === 'ready') {
      expect(status.port).toBe(41117)
      expect(status.url).toBe('http://127.0.0.1:41117')
    }

    const states: string[] = []
    manager.onStatus((s) => states.push(s.phase))

    await manager.stop()
    expect(manager.getStatus().phase).toBe('stopped')

    // stop() again must be a safe no-op
    await manager.stop()
    expect(manager.getStatus().phase).toBe('stopped')
    expect(states).toContain('stopping')
    expect(states).toContain('stopped')
  })

  it('reports a failed status when the server dies before ready', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tianshu-srvmgr-dead-'))
    cleanup.push(dir)
    const manager = new ServerManager(makeOpts(join(fixtures, 'die-early-server.mjs'), dir))
    const status = await manager.start()
    expect(status.phase).toBe('failed')
    expect(manager.getStatus().phase).toBe('failed')
  })

  it('auto-restarts once after a runtime crash, then reports failed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tianshu-srvmgr-crash-'))
    cleanup.push(dir)
    const manager = new ServerManager({
      ...makeOpts(join(fixtures, 'crash-server.mjs'), dir),
      readyTimeoutMs: 5000,
    })

    const status = await manager.start()
    expect(status.phase).toBe('ready')

    // Wait until the restart limit is hit (ready → crash → restart → crash → failed).
    const failed = await new Promise<boolean>((resolveDone) => {
      const timer = setInterval(() => {
        if (manager.getStatus().phase === 'failed') {
          clearInterval(timer)
          resolveDone(true)
        }
      }, 100)
      setTimeout(() => {
        clearInterval(timer)
        resolveDone(false)
      }, 15000)
    })
    expect(failed).toBe(true)
    expect(manager.getStatus().phase).toBe('failed')
  })

  it('stop() on a never-started manager is a safe no-op', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tianshu-srvmgr-none-'))
    cleanup.push(dir)
    const manager = new ServerManager(makeOpts('', dir))
    await manager.stop()
    expect(manager.getStatus().phase).toBe('stopped')
  })
})
