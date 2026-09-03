/**
 * server-lock.ts — 数据目录排他服务器锁（M0.3）。
 *
 * 目的：防止两个天枢 server 实例同时打开同一个 <dataDir>/sessions.db
 * （WAL 允许多连接，但并发写会互相踩踏；启动 sweep 还会互删对方的 run）。
 *
 * 机制（零依赖，不引入 proper-lockfile）：
 *   - 抢占式创建 <dataDir>/.server.lock（fs.openSync 'wx'，原子），
 *     内容为 `pid\n时间戳`。
 *   - 已被占用时读取持有者：持有进程已死（ESRCH）或锁文件超过 staleMs
 *     （默认 60s，崩溃残留）→ 视为陈旧锁，删除后重试一次。
 *   - release() 只在当前进程仍持有锁时删除文件；进程正常退出经
 *     process.on('exit') 兜底释放，崩溃残留由 stale 兜底。
 *
 * 约定：只在独立启动链路强制（app.ts 的 startTianshuServer）。测试进程
 * 通过 TIANSHU_DISABLE_SERVER_LOCK=1 跳过（见 test/setup-data-dir.ts），
 * 避免并行测试因共享/接力 dataDir 被误伤。
 */
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeSync } from 'fs'
import { join } from 'path'

export interface ServerLock {
  /** 锁文件绝对路径。 */
  path: string
  /** 释放锁（幂等；非持有者调用是 no-op）。 */
  release(): void
}

export interface AcquireOptions {
  /** 锁陈旧阈值毫秒数，默认 60_000。 */
  staleMs?: number
}

const DEFAULT_STALE_MS = 60_000

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err: any) {
    // ESRCH = 进程不存在；EPERM = 存在但无权限（仍视为存活）。
    return err?.code !== 'ESRCH'
  }
}

function readHolder(lockPath: string): { pid: number; ts: number } | null {
  try {
    const raw = readFileSync(lockPath, 'utf-8').trim()
    const [pidRaw, tsRaw] = raw.split(/\s+/)
    const pid = Number.parseInt(pidRaw ?? '', 10)
    const ts = Number.parseInt(tsRaw ?? '', 10)
    if (!Number.isFinite(pid) || pid <= 0) return null
    return { pid, ts: Number.isFinite(ts) ? ts : 0 }
  } catch {
    return null
  }
}

function isStale(lockPath: string, holder: { pid: number; ts: number } | null, staleMs: number): boolean {
  if (!holder) return true
  if (!isProcessAlive(holder.pid)) return true
  try {
    const age = Date.now() - statSync(lockPath).mtimeMs
    return age > staleMs
  } catch {
    return true
  }
}

/**
 * 获取数据目录排他锁；失败抛错（调用方让启动直接失败并给出友好提示）。
 * 锁文件名固定 .server.lock，位于 dataDir 根（与 sessions.db 同级）。
 */
export function acquireServerLock(dataDir: string, options: AcquireOptions = {}): ServerLock {
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true })
  const lockPath = join(dataDir, '.server.lock')

  for (let attempt = 0; attempt < 2; attempt++) {
    let fd: number
    try {
      fd = openSync(lockPath, 'wx')
    } catch (err: any) {
      if (err?.code !== 'EEXIST') throw err
      const holder = readHolder(lockPath)
      if (!isStale(lockPath, holder, staleMs)) {
        throw new Error(
          `TianShu server is already running for data directory "${dataDir}" ` +
          `(held by pid ${holder?.pid ?? '?'}). Close that instance first, or wait ` +
          `${staleMs / 1000}s if you believe it crashed.`,
        )
      }
      // 陈旧锁：删除后重试一次。
      try { rmSync(lockPath, { force: true }) } catch { /* 下一次尝试会再报 EEXIST */ }
      continue
    }
    try {
      writeSync(fd, `${process.pid}\n${Date.now()}\n`, 0, 'utf-8')
    } finally {
      closeSync(fd)
    }

    let released = false
    const release = (): void => {
      if (released) return
      released = true
      try { rmSync(lockPath, { force: true }) } catch { /* best-effort */ }
    }
    // 进程正常退出兜底（崩溃/断电由 staleMs 兜底）。
    process.once('exit', release)
    console.log(`[server-lock] acquired ${lockPath} (pid ${process.pid})`)
    return { path: lockPath, release }
  }
  throw new Error(`Could not acquire server lock at ${lockPath} after stale recovery`)
}
