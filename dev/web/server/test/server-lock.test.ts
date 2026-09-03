/**
 * server-lock.test.ts — M0.3 排他服务器锁验收。
 *
 * 单元覆盖：
 *   - 获取成功 → 可 release，release 幂等；
 *   - 已被持有（进程存活）→ 再次获取抛错；
 *   - 陈旧锁（持有进程已死 / 超过 staleMs）→ 自动清除后重新抢占；
 *   - 锁文件内容为 `pid 时间戳`。
 *
 * 集成覆盖（双开实例被锁拦截）：
 *   - fork 一个真实 server（src/index.ts）指向已被本进程持锁的 dataDir，
 *     期望其以 code 1 退出（startTianshuServer 获取锁失败 → index.ts 抛错退出）。
 *
 * 注意：test/setup-data-dir.ts 默认给测试进程设置 TIANSHU_DISABLE_SERVER_LOCK=1，
 * 但本测试直接调用 acquireServerLock（不走 app.ts），不受影响；fork 子进程
 * 显式覆盖为 '0' 以强制启用锁。
 */
import { fork } from 'child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import { acquireServerLock } from '../src/db/server-lock.js'

const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = mkdtempSync(join(tmpdir(), 'tianshu-lock-'))

describe('server-lock 排他锁', () => {
  afterAll(() => {
    rmSync(dataDir, { recursive: true, force: true })
  })

  it('获取成功并写入 pid/时间戳；release 幂等且删除文件', () => {
    const lock = acquireServerLock(dataDir, { staleMs: 60_000 })
    const raw = readFileSync(lock.path, 'utf-8')
    const [pidRaw, tsRaw] = raw.split(/\s+/)
    expect(Number.parseInt(pidRaw, 10)).toBe(process.pid)
    expect(Number.parseInt(tsRaw, 10)).toBeGreaterThan(0)

    // 锁文件存在
    expect(existsSync(lock.path)).toBe(true)

    lock.release()
    expect(existsSync(lock.path)).toBe(false)
    // release 幂等：重复调用不抛错
    lock.release()
  })

  it('进程存活时二次获取被拒绝并给出友好错误', () => {
    const lock = acquireServerLock(dataDir, { staleMs: 60_000 })
    try {
      expect(() => acquireServerLock(dataDir, { staleMs: 60_000 })).toThrow(
        /already running for data directory/,
      )
      expect(() => acquireServerLock(dataDir, { staleMs: 60_000 })).toThrow(/held by pid/)
    } finally {
      lock.release()
    }
    // 释放后可重新获取
    const again = acquireServerLock(dataDir, { staleMs: 60_000 })
    again.release()
  })

  it('陈旧锁（持有进程已死）自动清除后重新抢占', () => {
    // 先写一个指向"必然不存在的 pid"的锁文件 → 判定为陈旧 → 自动删除重试
    const lock = acquireServerLock(dataDir, { staleMs: 60_000 })
    lock.release()
    // 已释放后再写一个"持有进程已死"的锁文件 → 视为陈旧 → 自动删除重试抢占
    writeFileSync(join(dataDir, '.server.lock'), '99999999\n1\n', 'utf-8')
    // 99999999 大概率不存在（ESRCH）→ 视为陈旧，第二次 attempt 抢占成功
    const reclaimed = acquireServerLock(dataDir, { staleMs: 60_000 })
    expect(readFileSync(reclaimed.path, 'utf-8').startsWith(String(process.pid))).toBe(true)
    reclaimed.release()
  })

  it('双开实例：第二个 server 进程被锁拦截并以 code 1 退出', async () => {
    const lock = acquireServerLock(dataDir, { staleMs: 60_000 })
    try {
      const tsxCli = join(serverRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs')
      const child = fork(tsxCli, ['src/index.ts'], {
        cwd: serverRoot,
        env: {
          ...process.env,
          HOST: '127.0.0.1',
          PORT: '0',
          NODE_ENV: 'production',
          TIANSHU_DATA_DIR: dataDir,
          // 覆盖 setup-data-dir 的默认跳过，强制子进程启用锁
          TIANSHU_DISABLE_SERVER_LOCK: '0',
        },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      })
      const code = await new Promise<number | null>((resolveCode) => {
        const timer = setTimeout(() => {
          child.kill()
          resolveCode(null)
        }, 20000)
        child.once('exit', (c) => {
          clearTimeout(timer)
          resolveCode(c)
        })
        child.once('error', (err) => {
          clearTimeout(timer)
          throw err
        })
      })
      expect(code).toBe(1)
    } finally {
      lock.release()
    }
  })
})
