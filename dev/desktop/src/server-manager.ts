import { fork, spawnSync, type ChildProcess } from 'child_process'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
} from 'fs'
import { join } from 'path'
import type { ServerMessage } from '../../shared/server-ipc.js'
import type { DesktopServerStatus } from '../../shared/desktop-contract.js'

/** 进程树强杀策略：Windows 用 taskkill /T /F；POSIX 用进程组信号（§8.6）。 */
export type KillProcessTree = (pid: number) => Promise<void>

const DEFAULT_KILL_WAIT_MS = 300

/**
 * 默认强杀策略：
 * - Windows -> taskkill /PID <pid> /T /F
 * - POSIX   -> process.kill(-pid, SIGTERM)，短暂等待，仍存活再 SIGKILL
 * POSIX 下子进程以 detached: true 启动，是进程组组长，负 pid 发给整组。
 */
export const defaultKillProcessTree: KillProcessTree = async (pid: number) => {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true })
    return
  }
  try {
    process.kill(-pid, 'SIGTERM')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ESRCH') return // 已退出
    throw err
  }
  await new Promise((resolveWait) => setTimeout(resolveWait, DEFAULT_KILL_WAIT_MS))
  try {
    process.kill(-pid, 0) // 探活：进程组已不存在则无需 SIGKILL
  } catch {
    return
  }
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    /* already gone */
  }
}

export interface ServerManagerOptions {
  /** app.isPackaged() — dev mode is orchestrated by scripts/dev-desktop.mjs. */
  packaged: boolean
  /** Absolute path to the bundled portable Node executable (node.exe / bin/node). */
  nodePath: string
  /** Absolute path to the compiled server entry (dist/index.js). */
  serverEntry: string
  /** Absolute path to the React build (staging/client). */
  clientDist: string
  /** Electron app.getPath('userData'). */
  userDataDir: string
  /** Dev-mode URL to load when packaged === false. */
  devUrl?: string
  /** Time to wait for { type: 'ready' } before declaring failure. */
  readyTimeoutMs?: number
  /** Time to wait for a graceful shutdown before force-killing the tree. */
  shutdownGraceMs?: number
  /** 进程树强杀策略（默认按平台选择）；测试注入假的 kill 避免真的杀本机进程（§8.6）。 */
  killProcessTree?: KillProcessTree
  /** 启动前校验（内置 Node 路径/manifest）；返回错误信息则直接进入 failed 状态（§8.5）。 */
  preflight?: () => string | null
}

const DEFAULT_READY_TIMEOUT_MS = 30_000
const DEFAULT_SHUTDOWN_GRACE_MS = 8_000
const MAX_LOG_FILES = 5
const MAX_LOG_BYTES = 10 * 1024 * 1024

export class ServerManager {
  private readonly opts: ServerManagerOptions
  private child: ChildProcess | null = null
  private status: DesktopServerStatus = { phase: 'stopped' }
  private readonly listeners = new Set<(status: DesktopServerStatus) => void>()
  private readonly approvalListeners = new Set<(
    notice: Extract<ServerMessage, { type: 'approval-required' }>,
  ) => void>()
  private readonly approvalClearListeners = new Set<(
    notice: Extract<ServerMessage, { type: 'approval-cleared' }>,
  ) => void>()
  private started = false
  private stopping = false
  private startAttempts = 0
  private readonly logFile: string

  constructor(opts: ServerManagerOptions) {
    this.opts = {
      readyTimeoutMs: DEFAULT_READY_TIMEOUT_MS,
      shutdownGraceMs: DEFAULT_SHUTDOWN_GRACE_MS,
      ...opts,
    }
    this.logFile = join(this.opts.userDataDir, 'logs', 'server.log')
  }

  getStatus(): DesktopServerStatus {
    return this.status
  }

  onStatus(listener: (status: DesktopServerStatus) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  onApprovalRequired(
    listener: (notice: Extract<ServerMessage, { type: 'approval-required' }>) => void,
  ): () => void {
    this.approvalListeners.add(listener)
    return () => this.approvalListeners.delete(listener)
  }

  onApprovalCleared(
    listener: (notice: Extract<ServerMessage, { type: 'approval-cleared' }>) => void,
  ): () => void {
    this.approvalClearListeners.add(listener)
    return () => this.approvalClearListeners.delete(listener)
  }

  private emit(status: DesktopServerStatus): void {
    this.status = status
    for (const listener of [...this.listeners]) {
      try {
        listener(status)
      } catch {
        /* a bad listener must not break the manager */
      }
    }
  }

  private ensureLogDir(): void {
    mkdirSync(join(this.opts.userDataDir, 'logs'), { recursive: true })
  }

  private writeLog(chunk: Buffer | string): void {
    try {
      appendFileSync(this.logFile, typeof chunk === 'string' ? chunk : chunk.toString('utf8'))
    } catch {
      /* logging is best-effort */
    }
  }

  private rotateLog(): void {
    try {
      const maxFile = `${this.logFile}.${MAX_LOG_FILES - 1}`
      if (existsSync(maxFile)) renameSync(maxFile, `${maxFile}.old`) // drop the oldest
      for (let i = MAX_LOG_FILES - 2; i >= 0; i--) {
        const cur = i === 0 ? this.logFile : `${this.logFile}.${i}`
        const next = `${this.logFile}.${i + 1}`
        if (existsSync(cur)) renameSync(cur, next)
      }
      const size = existsSync(this.logFile) ? statSync(this.logFile).size : 0
      if (size > MAX_LOG_BYTES) {
        // Oversized file after rotation: truncate in place.
        appendFileSync(this.logFile, '')
      }
    } catch {
      /* rotation is best-effort */
    }
  }

  async start(): Promise<DesktopServerStatus> {
    if (this.started) return this.status
    this.started = true

    if (!this.opts.packaged) {
      // Dev mode: scripts/dev-desktop.mjs runs Vite + server; nothing to manage.
      const devUrl = this.opts.devUrl || 'http://127.0.0.1:3457'
      this.emit({ phase: 'ready', port: 0, url: devUrl })
      return this.status
    }

    // 启动前校验：内置 Node 路径 / manifest 不匹配时给出可读错误，
    // 进入 server.log 并通过 server status 展示（§8.5），而不是只产生 ENOENT。
    if (this.opts.preflight) {
      const preflightError = this.opts.preflight()
      if (preflightError) {
        this.ensureLogDir()
        this.writeLog(`[server-manager] preflight failed: ${preflightError}\n`)
        this.emit({ phase: 'failed', message: preflightError })
        return this.status
      }
    }

    this.startAttempts = 0
    return this.launchChild()
  }

  private launchChild(): Promise<DesktopServerStatus> {
    return new Promise<DesktopServerStatus>((resolveLaunch, rejectLaunch) => {
      this.ensureLogDir()
      this.rotateLog()

      const env: Record<string, string> = {
        ...(process.env as Record<string, string>),
        HOST: '127.0.0.1',
        PORT: '0',
        NODE_ENV: 'production',
        TIANSHU_CLIENT_DIST: this.opts.clientDist,
        TIANSHU_CONFIG_DIR: this.opts.userDataDir,
        TIANSHU_DEFAULT_DATA_DIR: join(this.opts.userDataDir, 'data'),
        // 只读内置内容根（content/builtin → resources/content/builtin）。
        // resourcesPath 只在 Electron 运行时存在；测试环境回退到用户数据目录
        // 下的 content/builtin（不存在时 server 使用仓库根定位）。
        TIANSHU_BUILTIN_CONTENT_DIR: process.resourcesPath
          ? join(process.resourcesPath, 'content', 'builtin')
          : join(this.opts.userDataDir, 'content', 'builtin'),
      }

      this.emit({ phase: 'starting' })

      const child = fork(this.opts.serverEntry, [], {
        execPath: this.opts.nodePath,
        env,
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        // POSIX：detached 使服务成为进程组组长，强杀可对整个进程组发信号（§8.6）。
        ...(process.platform !== 'win32' ? { detached: true } : {}),
      })
      this.child = child
      this.startAttempts++

      let settled = false
      let crashing = false
      const readyTimer = setTimeout(() => {
        if (settled) return
        settled = true
        crashing = true
        this.emit({
          phase: 'failed',
          message: `内置服务在 ${this.opts.readyTimeoutMs}ms 内未就绪，请查看日志: ${this.logFile}`,
        })
        void this.killChild()
        resolveLaunch(this.status)
      }, this.opts.readyTimeoutMs)

      child.stdout?.on('data', (d) => this.writeLog(d))
      child.stderr?.on('data', (d) => this.writeLog(d))

      child.on('message', (msg: ServerMessage) => {
        if (msg?.type === 'ready') {
          if (settled) return
          settled = true
          clearTimeout(readyTimer)
          const url = `http://127.0.0.1:${msg.port}`
          this.emit({ phase: 'ready', port: msg.port, url })
          resolveLaunch(this.status)
        } else if (msg?.type === 'fatal') {
          this.writeLog(`[fatal] ${msg.message}\n`)
        } else if (msg?.type === 'log') {
          this.writeLog(`[${msg.level}] ${msg.message}\n`)
        } else if (msg?.type === 'approval-required') {
          for (const listener of [...this.approvalListeners]) {
            try {
              listener(msg)
            } catch {
              /* a bad listener must not break child-process supervision */
            }
          }
        } else if (msg?.type === 'approval-cleared') {
          for (const listener of [...this.approvalClearListeners]) {
            try {
              listener(msg)
            } catch {
              /* a bad listener must not break child-process supervision */
            }
          }
        }
      })

      child.on('error', (err) => {
        if (settled) return
        settled = true
        clearTimeout(readyTimer)
        this.emit({ phase: 'failed', message: `内置服务启动失败: ${err.message}` })
        resolveLaunch(this.status)
      })

      child.on('exit', (code, signal) => {
        clearTimeout(readyTimer)
        this.child = null
        if (this.stopping) return // stop() will emit 'stopped'
        if (settled) {
          // Crashed after reaching ready: auto-restart at most once.
          if (this.startAttempts <= 1) {
            this.writeLog(`[server-manager] server exited (code ${code}, signal ${signal}); restarting\n`)
            void this.launchChild()
          } else {
            this.emit({
              phase: 'failed',
              message: `内置服务意外退出（退出码 ${code ?? signal}），请查看日志: ${this.logFile}`,
            })
          }
          return
        }
        // Exited before ready.
        settled = true
        this.emit({
          phase: 'failed',
          message: `内置服务启动失败（退出码 ${code ?? signal}），请查看日志: ${this.logFile}`,
        })
        resolveLaunch(this.status)
      })
    })
  }

  async stop(): Promise<void> {
    if (this.stopping) return
    const child = this.child
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      this.emit({ phase: 'stopped' })
      return
    }
    this.stopping = true
    this.emit({ phase: 'stopping' })

    const exited = new Promise<boolean>((resolveExit) => {
      child.once('exit', () => resolveExit(true))
    })

    try {
      child.send({ type: 'shutdown' })
    } catch {
      /* channel may already be closed */
    }

    const graceful = await Promise.race([
      exited,
      new Promise<boolean>((resolveTimeout) =>
        setTimeout(() => resolveTimeout(false), this.opts.shutdownGraceMs),
      ),
    ])

    if (!graceful && child.exitCode === null) {
      this.writeLog('[server-manager] shutdown grace exceeded; force-killing process tree\n')
      await this.killChild()
      await exited
    }

    this.emit({ phase: 'stopped' })
    this.stopping = false
  }

  private async killChild(): Promise<void> {
    const child = this.child
    if (!child || child.pid === undefined) return
    const kill = this.opts.killProcessTree || defaultKillProcessTree
    try {
      await kill(child.pid)
    } catch {
      try {
        child.kill('SIGKILL')
      } catch {
        /* already gone */
      }
    }
  }
}
