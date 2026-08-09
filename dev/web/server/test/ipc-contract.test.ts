import { fork } from 'child_process'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { resolve } from 'path'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { DesktopMessage, ServerMessage } from '../../../shared/server-ipc.js'

const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

let tmpData: string

beforeAll(() => {
  tmpData = mkdtempSync(join(tmpdir(), 'tianshu-ipc-'))
})

afterAll(() => {
  rmSync(tmpData, { recursive: true, force: true })
})

describe('server IPC contract', () => {
  it('sends a typed ready message and exits cleanly on shutdown', async () => {
    const tsxCli = join(serverRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs')
    // Run the real entrypoint (src/index.ts) through tsx so the test covers the
    // exact fork lifecycle Electron uses.
    const child = fork(tsxCli, ['src/index.ts'], {
      cwd: serverRoot,
      env: {
        ...process.env,
        HOST: '127.0.0.1',
        PORT: '0',
        NODE_ENV: 'production',
        TIANSHU_DATA_DIR: tmpData,
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    })

    const ready = await new Promise<ServerMessage>((resolveMsg, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for ready')), 20000)
      child.on('message', (msg: unknown) => {
        if (msg && (msg as ServerMessage).type === 'ready') {
          clearTimeout(timer)
          resolveMsg(msg as ServerMessage)
        }
      })
      child.on('error', reject)
      child.on('exit', (code) => reject(new Error(`server exited before ready (code ${code})`)))
    })

    // The message must match the shared contract shape.
    expect(ready.type).toBe('ready')
    expect(typeof (ready as { port: number }).port).toBe('number')
    expect((ready as { port: number }).port).toBeGreaterThan(0)

    const exit = new Promise<number | null>((resolveExit) => child.once('exit', (code) => resolveExit(code)))
    const shutdownMsg: DesktopMessage = { type: 'shutdown' }
    child.send(shutdownMsg)

    const code = await Promise.race([
      exit,
      new Promise<number | null>((resolveTimeout) =>
        setTimeout(() => resolveTimeout(null), 15000),
      ),
    ])
    expect(code).toBe(0)
  })
})
