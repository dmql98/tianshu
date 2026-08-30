import type { UpdateSource, UpdateState } from '../../shared/desktop-contract.js'

/**
 * Minimal surface of electron-updater's autoUpdater that this manager needs.
 * Kept structural so the state machine can be unit-tested with a fake
 * EventEmitter updater (no network access).
 */
export interface UpdaterLike {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  allowDowngrade: boolean
  checkForUpdates(): Promise<unknown>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
  on(event: string, listener: (...args: unknown[]) => void): unknown
  /** Reconfigure the update feed (electron-updater's setFeedURL). */
  setFeedURL?(options: unknown): void
}

export interface UpdateManagerOptions {
  updater: UpdaterLike
  currentVersion: string
  /** Only true when app.isPackaged — updates are disabled in dev/browser. */
  enabled: boolean
  /** 更新被禁用的原因（如 Linux 非 AppImage 安装形态，§11.4）。 */
  disabledReason?: string
  /** Gracefully stops the bundled server before installing an update. */
  stopServer: () => Promise<void>
  /** Appends to <userData>/logs/updater.log. */
  log: (msg: string) => void
  /** Strips local paths etc. from error messages before they reach the UI. */
  sanitize: (msg: string) => string
  /** 官网服务器更新源（generic provider），对应 electron-builder.yml 的 publish[0]。 */
  serverFeed?: Record<string, unknown>
  /** GitHub 更新源（owner / repo / releaseType）。 */
  githubFeed?: Record<string, unknown>
  /** 启动时的更新源偏好（由持久化文件读取）；缺省 'server'（官网优先）。 */
  initialSource?: UpdateSource
}

function clampPercent(value: number): number {
  if (Number.isNaN(value)) return 0
  return Math.min(100, Math.max(0, value))
}

/** Extract a short, safe string from an unknown error — never serialize an
 *  entire HTTP response (which can embed cookies/paths) to the UI. */
function toMessage(err: unknown): string {
  let msg: string
  if (err instanceof Error) msg = err.message || err.name || 'unknown error'
  else if (typeof err === 'string') msg = err
  else if (err && typeof err === 'object' && 'message' in err) {
    const m = (err as { message: unknown }).message
    msg = typeof m === 'string' ? m : 'unknown error'
  } else {
    msg = 'unknown error'
  }
  // electron-updater embeds the HTTP response headers after a newline; drop them.
  const headerIdx = msg.indexOf('\nHeaders: {')
  if (headerIdx !== -1) msg = msg.slice(0, headerIdx)
  return msg
}

function capMessage(message: string, max = 400): string {
  return message.length > max ? `${message.slice(0, max)}…` : message
}

interface UpdateInfoLike {
  version?: unknown
  releaseName?: unknown
  releaseNotes?: unknown
  releaseDate?: unknown
  files?: Array<{ url?: unknown; size?: unknown; isDelta?: unknown }>
  path?: unknown
}

export class UpdateManager {
  private readonly opts: UpdateManagerOptions
  private state: UpdateState
  private readonly listeners = new Set<(state: UpdateState) => void>()
  private checking = false
  private downloading = false
  private installing = false
  /** 上次记录进日志的下载进度百分比（节流，避免刷屏）。 */
  private lastLoggedProgressPercent = -1
  /** 上次记录进日志的差分状态（状态切换时记录，§11.2）。 */
  private lastLoggedDelta: boolean | null = null
  /** 周期性检查定时器句柄（setInterval）。 */
  private checkTimer: ReturnType<typeof setInterval> | null = null
  /** 初始延迟检查的 setTimeout 句柄（initialDelayMs > 0 时）。 */
  private initialTimer: ReturnType<typeof setTimeout> | null = null

  /** 当前生效的逻辑更新源（用户选择，默认官网服务器）。 */
  private currentSource: UpdateSource
  /** 已通过 setFeedURL 应用到 electron-updater 的物理源；避免重复切换。 */
  private appliedFeedSource: UpdateSource | null = null

  constructor(opts: UpdateManagerOptions) {
    this.opts = opts
    this.currentSource = opts.initialSource ?? 'server'
    this.state = {
      phase: opts.enabled ? 'idle' : 'disabled',
      currentVersion: opts.currentVersion,
      source: this.currentSource,
      ...(opts.disabledReason ? { disabledReason: opts.disabledReason } : {}),
    }
    if (opts.enabled) {
      // 发现更新即后台自动下载（不再依赖用户在弹窗里手动点"下载"）。
      this.opts.updater.autoDownload = true
      this.opts.updater.autoInstallOnAppQuit = true
      this.opts.updater.allowDowngrade = false
      this.hookEvents()
      // 启动时把 electron-updater 的 feed 对齐到当前选择的更新源。
      this.applyFeed(this.currentSource)
      // 初始化可观测性：当前版本、平台、架构、更新源（§11.2）
      this.opts.log(
        `[updater] initialized (version=${opts.currentVersion}, platform=${process.platform}, arch=${process.arch}, enabled=true, source=${this.currentSource})`,
      )
    }
  }

  getState(): UpdateState {
    return this.state
  }

  onUpdate(listener: (state: UpdateState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** 当前生效的更新源（用户选择）。 */
  getSource(): UpdateSource {
    return this.currentSource
  }

  /** 切换更新源：更新逻辑源、对齐物理 feed，并广播给 UI（无自动兜底）。 */
  setSource(source: UpdateSource): void {
    if (this.currentSource === source) return
    this.currentSource = source
    this.opts.log(`[updater] update source set to ${source}`)
    this.applyFeed(source)
    this.setState({})
  }

  /** 返回某更新源对应的 feed 配置；未配置则返回 undefined（沿用默认 feed）。 */
  private feedFor(source: UpdateSource): Record<string, unknown> | undefined {
    return source === 'github' ? this.opts.githubFeed : this.opts.serverFeed
  }

  /** 仅在物理 feed 与逻辑源不一致时调用 setFeedURL，避免重复切换。 */
  private applyFeed(source: UpdateSource): void {
    if (this.appliedFeedSource === source) return
    const feed = this.feedFor(source)
    if (feed) this.opts.updater.setFeedURL?.(feed)
    this.appliedFeedSource = source
  }

  private setState(partial: Partial<UpdateState>): void {
    this.state = { ...this.state, ...partial, source: this.currentSource }
    const snapshot = { ...this.state }
    for (const listener of [...this.listeners]) {
      try {
        listener(snapshot)
      } catch {
        /* a bad listener must not break the updater */
      }
    }
  }

  /**
   * 后台定时检索更新：立即（initialDelayMs<=0）或延迟初检一次，之后按
   * intervalMs 周期调用 checkForUpdates。重复调用会先清理旧定时器。
   * disabled 时不注册任何定时器（§11.4）。
   */
  startPeriodicCheck(intervalMs: number, initialDelayMs = 0): void {
    if (!this.opts.enabled) return
    this.stopPeriodicCheck()
    const tick = () => { void this.checkForUpdates() }
    if (initialDelayMs > 0) {
      this.initialTimer = setTimeout(() => {
        tick()
        this.checkTimer = setInterval(tick, intervalMs)
      }, initialDelayMs)
    } else {
      tick()
      this.checkTimer = setInterval(tick, intervalMs)
    }
  }

  /** 停止周期性检查并清理所有定时器句柄。 */
  stopPeriodicCheck(): void {
    if (this.checkTimer !== null) {
      clearInterval(this.checkTimer)
      this.checkTimer = null
    }
    if (this.initialTimer !== null) {
      clearTimeout(this.initialTimer)
      this.initialTimer = null
    }
  }

  private hookEvents(): void {
    const u = this.opts.updater
    u.on('checking-for-update', () => {
      this.opts.log('[updater] checking for update')
      this.setState({ phase: 'checking', message: undefined })
    })
    u.on('update-available', (info: unknown) => {
      const i = (info ?? {}) as UpdateInfoLike
      const files = Array.isArray(i.files) ? i.files : []
      const fullFile = files.find((f) => !f.isDelta)
      const packageSize = typeof fullFile?.size === 'number' ? fullFile.size : undefined
      this.opts.log(
        `[updater] update available: ${typeof i.version === 'string' ? i.version : 'unknown'} ` +
        `files=[${files.map((f) => `${f.url ?? '?'}${f.isDelta ? ' (delta)' : ''}`).join(', ')}]`,
      )
      this.setState({
        phase: 'available',
        targetVersion: typeof i.version === 'string' ? i.version : undefined,
        packageSize,
        releaseName: typeof i.releaseName === 'string' ? i.releaseName : undefined,
        releaseNotes:
          typeof i.releaseNotes === 'string' || typeof i.releaseNotes === 'number'
            ? String(i.releaseNotes)
            : undefined,
        releaseDate: typeof i.releaseDate === 'string' ? i.releaseDate : undefined,
        message: undefined,
      })
    })
    u.on('update-not-available', () => {
      this.opts.log('[updater] no update available')
      this.setState({ phase: 'not-available', checkedAt: new Date().toISOString(), message: undefined })
    })
    u.on('download-progress', (progress: unknown) => {
      const p = (progress ?? {}) as Record<string, unknown>
      const percent = clampPercent(Number(p.percent) || 0)
      const isDelta = p.delta === true
      const transferred = typeof p.transferred === 'number' ? p.transferred : undefined
      const total = typeof p.total === 'number' ? p.total : undefined
      // 差分状态切换或进度每 ~20% 记录一次（§11.2 差分/整包与 transferred/total）
      const progressBucket = Math.floor(percent / 20)
      if (this.lastLoggedDelta !== isDelta || progressBucket !== this.lastLoggedProgressPercent) {
        this.opts.log(
          `[updater] download ${isDelta ? 'differential' : 'full'} progress: ` +
          `${transferred ?? '?'}/${total ?? '?'} bytes (${percent.toFixed(0)}%)`,
        )
        this.lastLoggedDelta = isDelta
        this.lastLoggedProgressPercent = progressBucket
      }
      this.setState({
        phase: 'downloading',
        percent,
        isDelta,
        transferred,
        total,
        bytesPerSecond: typeof p.bytesPerSecond === 'number' ? p.bytesPerSecond : undefined,
        message: undefined,
      })
    })
    u.on('update-downloaded', (info: unknown) => {
      const i = (info ?? {}) as UpdateInfoLike
      const files = Array.isArray(i.files) ? i.files : []
      const chosen = files.find((f) => f.isDelta) ?? files[0]
      const isDelta = chosen?.isDelta === true
      this.opts.log(
        `[updater] update downloaded: ${typeof i.version === 'string' ? i.version : 'unknown'} ` +
        `via ${chosen?.url ?? 'unknown'} (${isDelta ? 'differential' : 'full'})`,
      )
      this.setState({
        phase: 'downloaded',
        targetVersion: typeof i.version === 'string' ? i.version : undefined,
        isDelta,
        message: undefined,
      })
    })
    u.on('error', (err: unknown) => {
      const raw = this.opts.sanitize(toMessage(err))
      this.opts.log(`[updater] error: ${raw}`)
      this.setState({ phase: 'error', message: capMessage(raw) })
    })
  }

  /** One check at a time; concurrent calls share the in-flight request. */
  async checkForUpdates(): Promise<UpdateState> {
    if (!this.opts.enabled) return this.state
    if (this.checking) return this.state
    this.checking = true
    try {
      // 对齐当前选择的更新源再检查（官网服务器 / GitHub，无自动兜底）。
      this.applyFeed(this.currentSource)
      await this.opts.updater.checkForUpdates()
    } catch (err) {
      const raw = this.opts.sanitize(toMessage(err))
      this.opts.log(`[updater] check failed (source=${this.currentSource}): ${raw}`)
      this.setState({ phase: 'error', message: capMessage(raw) })
    } finally {
      this.checking = false
    }
    return this.state
  }

  async downloadUpdate(): Promise<void> {
    if (!this.opts.enabled) throw new Error('updates are disabled')
    if (this.downloading) return
    this.downloading = true
    try {
      await this.opts.updater.downloadUpdate()
    } catch (err) {
      const raw = this.opts.sanitize(toMessage(err))
      this.opts.log(`[updater] download failed: ${raw}`)
      this.setState({ phase: 'error', message: capMessage(raw) })
    } finally {
      this.downloading = false
    }
  }

  /**
   * Stops the bundled server first, flushes the updater log, then installs and
   * restarts. Prevents re-entry while an install is in flight.
   */
  async installUpdate(): Promise<void> {
    if (!this.opts.enabled) throw new Error('updates are disabled')
    if (this.installing) return
    this.installing = true
    try {
      await this.opts.stopServer()
      this.opts.log('[updater] server stopped; installing update')
      this.opts.updater.quitAndInstall(false, true)
    } catch (err) {
      this.installing = false
      const raw = this.opts.sanitize(toMessage(err))
      this.setState({ phase: 'error', message: capMessage(raw) })
      throw err
    }
  }
}
