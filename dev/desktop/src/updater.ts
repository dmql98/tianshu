import type { UpdateState } from '../../shared/desktop-contract.js'

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
}

export interface UpdateManagerOptions {
  updater: UpdaterLike
  currentVersion: string
  /** Only true when app.isPackaged — updates are disabled in dev/browser. */
  enabled: boolean
  /** Gracefully stops the bundled server before installing an update. */
  stopServer: () => Promise<void>
  /** Appends to <userData>/logs/updater.log. */
  log: (msg: string) => void
  /** Strips local paths etc. from error messages before they reach the UI. */
  sanitize: (msg: string) => string
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

export class UpdateManager {
  private readonly opts: UpdateManagerOptions
  private state: UpdateState
  private readonly listeners = new Set<(state: UpdateState) => void>()
  private checking = false
  private downloading = false
  private installing = false

  constructor(opts: UpdateManagerOptions) {
    this.opts = opts
    this.state = {
      phase: opts.enabled ? 'idle' : 'disabled',
      currentVersion: opts.currentVersion,
    }
    if (opts.enabled) {
      this.opts.updater.autoDownload = false
      this.opts.updater.autoInstallOnAppQuit = true
      this.opts.updater.allowDowngrade = false
      this.hookEvents()
    }
  }

  getState(): UpdateState {
    return this.state
  }

  onUpdate(listener: (state: UpdateState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private setState(partial: Partial<UpdateState>): void {
    this.state = { ...this.state, ...partial }
    const snapshot = { ...this.state }
    for (const listener of [...this.listeners]) {
      try {
        listener(snapshot)
      } catch {
        /* a bad listener must not break the updater */
      }
    }
  }

  private hookEvents(): void {
    const u = this.opts.updater
    u.on('checking-for-update', () => {
      this.opts.log('[updater] checking for update')
      this.setState({ phase: 'checking', message: undefined })
    })
    u.on('update-available', (info: unknown) => {
      const i = (info ?? {}) as Record<string, unknown>
      this.opts.log(`[updater] update available: ${typeof i.version === 'string' ? i.version : 'unknown'}`)
      this.setState({
        phase: 'available',
        targetVersion: typeof i.version === 'string' ? i.version : undefined,
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
      this.setState({
        phase: 'downloading',
        percent: clampPercent(Number(p.percent) || 0),
        transferred: typeof p.transferred === 'number' ? p.transferred : undefined,
        total: typeof p.total === 'number' ? p.total : undefined,
        bytesPerSecond: typeof p.bytesPerSecond === 'number' ? p.bytesPerSecond : undefined,
        message: undefined,
      })
    })
    u.on('update-downloaded', (info: unknown) => {
      const i = (info ?? {}) as Record<string, unknown>
      this.opts.log(`[updater] update downloaded: ${typeof i.version === 'string' ? i.version : 'unknown'}`)
      this.setState({
        phase: 'downloaded',
        targetVersion: typeof i.version === 'string' ? i.version : undefined,
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
      await this.opts.updater.checkForUpdates()
    } catch (err) {
      const raw = this.opts.sanitize(toMessage(err))
      this.opts.log(`[updater] check failed: ${raw}`)
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
