import { fork, type ChildProcess } from 'child_process'
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

export interface ServerManagerOptions {
  /** app.isPackaged() — dev mode is orchestrated by scripts/dev-desktop.mjs. */
  packaged: boolean
  /** Absolute path to the bundled portable Node executable (node.exe). */
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
        this.killChild()
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
      this.killChild()
      await exited
    }

    this.emit({ phase: 'stopped' })
    this.stopping = false
  }

  private killChild(): void {
    const child = this.child
    if (!child || child.pid === undefined) return
    try {
      const { spawnSync } = require('child_process') as typeof import('child_process')
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
    } catch {
      try {
        child.kill('SIGKILL')
      } catch {
        /* already gone */
      }
    }
  }
}
