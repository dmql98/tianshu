import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { ServerManager, defaultKillProcessTree } from '../src/server-manager.js'

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

  it('forwards approval requests from the server child to desktop listeners', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tianshu-srvmgr-approval-'))
    cleanup.push(dir)
    const manager = new ServerManager(makeOpts(join(fixtures, 'approval-server.mjs'), dir))
    const received = new Promise<{ sessionId: string; toolCallId: string }>((resolveNotice) => {
      manager.onApprovalRequired(resolveNotice)
    })
    const cleared = new Promise<{ sessionId: string; toolCallId?: string }>((resolveNotice) => {
      manager.onApprovalCleared(resolveNotice)
    })

    const status = await manager.start()
    expect(status.phase).toBe('ready')
    await expect(received).resolves.toMatchObject({
      sessionId: 'session-1',
      toolCallId: 'tool-call-1',
    })
    await expect(cleared).resolves.toMatchObject({
      sessionId: 'session-1',
      toolCallId: 'tool-call-1',
    })
    await manager.stop()
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

  it('preflight failure surfaces a readable message instead of ENOENT', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tianshu-srvmgr-preflight-'))
    cleanup.push(dir)
    const manager = new ServerManager({
      ...makeOpts(join(fixtures, 'fake-server.mjs'), dir),
      preflight: () => '内置 Node 不存在: /res/runtime/node/node.exe',
    })
    const status = await manager.start()
    expect(status.phase).toBe('failed')
    if (status.phase === 'failed') {
      expect(status.message).toContain('内置 Node 不存在')
    }
    // 错误进入 server.log（§8.5）
    const log = readFileSync(join(dir, 'logs', 'server.log'), 'utf8')
    expect(log).toContain('preflight failed')
  })

  it('uses the injected kill strategy when graceful shutdown times out', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tianshu-srvmgr-kill-'))
    cleanup.push(dir)
    const killedPids: number[] = []
    const manager = new ServerManager({
      ...makeOpts(join(fixtures, 'hang-server.mjs'), dir),
      shutdownGraceMs: 300,
      // 注入策略：记录 pid 后委托默认策略真正结束进程（避免杀本机无关进程）。
      killProcessTree: async (pid) => {
        killedPids.push(pid)
        await defaultKillProcessTree(pid)
      },
    })

    const status = await manager.start()
    expect(status.phase).toBe('ready')

    await manager.stop()
    expect(manager.getStatus().phase).toBe('stopped')
    // hang-server 忽略 shutdown → 必须走注入的 kill 策略（§8.6）
    expect(killedPids.length).toBe(1)
    expect(killedPids[0]).toBeGreaterThan(0)
  })
})
