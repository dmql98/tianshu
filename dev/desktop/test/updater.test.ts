import { EventEmitter } from 'events'
import { describe, expect, it, vi } from 'vitest'
import { UpdateManager, type UpdaterLike } from '../src/updater.js'

class FakeUpdater extends EventEmitter implements UpdaterLike {
  autoDownload = false
  autoInstallOnAppQuit = false
  allowDowngrade = false
  checkCalls = 0
  downloadCalls = 0
  quitCalls = 0
  private _shouldFailCheck = false
  private _shouldFailDownload = false

  setFailCheck(v: boolean) { this._shouldFailCheck = v }
  setFailDownload(v: boolean) { this._shouldFailDownload = v }

  async checkForUpdates() {
    this.checkCalls++
    if (this._shouldFailCheck) throw new Error('net::ERR_NAME_NOT_RESOLVED')
    return {}
  }

  async downloadUpdate() {
    this.downloadCalls++
    if (this._shouldFailDownload) throw new Error('download aborted')
    this.emit('update-downloaded', { version: '0.2.0' })
  }

  quitAndInstall() {
    this.quitCalls++
  }
}

function makeManager(fake?: FakeUpdater) {
  const updater = fake ?? new FakeUpdater()
  const order: string[] = []
  const stopServer = vi.fn(async () => {
    order.push('stop-server')
  })
  const log = vi.fn()
  const sanitize = vi.fn((m: string) => m)
  const manager = new UpdateManager({
    updater,
    currentVersion: '0.1.0',
    enabled: true,
    stopServer,
    log,
    sanitize,
  })
  return { manager, updater, stopServer, log, sanitize, order }
}

describe('UpdateManager', () => {
  it('starts in idle with the current version when enabled', () => {
    const { manager } = makeManager()
    const state = manager.getState()
    expect(state.phase).toBe('idle')
    expect(state.currentVersion).toBe('0.1.0')
  })

  it('starts in disabled phase when not enabled', () => {
    const updater = new FakeUpdater()
    const manager = new UpdateManager({
      updater,
      currentVersion: '0.1.0',
      enabled: false,
      stopServer: vi.fn(),
      log: vi.fn(),
      sanitize: (m) => m,
    })
    expect(manager.getState().phase).toBe('disabled')
    expect(updater.autoDownload).toBe(false) // untouched
  })

  it('configures autoDownload/autoInstallOnAppQuit/no-downgrade when enabled', () => {
    const { updater } = makeManager()
    expect(updater.autoDownload).toBe(false)
    expect(updater.autoInstallOnAppQuit).toBe(true)
    expect(updater.allowDowngrade).toBe(false)
  })

  it('maps update-available into a complete state', async () => {
    const { manager, updater } = makeManager()
    updater.emit('update-available', {
      version: '0.2.0',
      releaseName: 'v0.2.0',
      releaseNotes: 'fixes',
      releaseDate: '2026-08-10T00:00:00.000Z',
    })
    const state = manager.getState()
    expect(state.phase).toBe('available')
    expect(state.targetVersion).toBe('0.2.0')
    expect(state.releaseName).toBe('v0.2.0')
    expect(state.releaseNotes).toBe('fixes')
    expect(state.releaseDate).toBe('2026-08-10T00:00:00.000Z')
  })

  it('clamps download progress to 0-100', async () => {
    const { manager, updater } = makeManager()
    updater.emit('download-progress', { percent: 137, transferred: 100, total: 200, bytesPerSecond: 5 })
    expect(manager.getState().phase).toBe('downloading')
    expect(manager.getState().percent).toBe(100)
    updater.emit('download-progress', { percent: -12, transferred: 0, total: 200, bytesPerSecond: 5 })
    expect(manager.getState().percent).toBe(0)
    updater.emit('download-progress', { percent: 66.7, transferred: 66, total: 100, bytesPerSecond: 5 })
    expect(manager.getState().percent).toBe(66.7)
  })

  it('recovers from error and allows a later check', async () => {
    const { manager, updater } = makeManager()
    updater.setFailCheck(true)
    const first = await manager.checkForUpdates()
    expect(first.phase).toBe('error')
    expect(first.message).toContain('net::ERR_NAME_NOT_RESOLVED')

    updater.setFailCheck(false)
    updater.emit('update-not-available')
    const second = await manager.checkForUpdates()
    expect(second.phase).toBe('not-available')
  })

  it('caps and sanitizes error messages before they reach the UI', () => {
    const { manager, updater, sanitize } = makeManager()
    const huge = `set-cookie ${'x'.repeat(5000)} with ${'C:\\Users\\secret\\path'}`
    updater.emit('error', huge)
    const state = manager.getState()
    expect(state.phase).toBe('error')
    expect(state.message).toBeDefined()
    // Truncated to the cap; the full 5000-char payload is never leaked.
    expect((state.message || '').length).toBeLessThanOrEqual(401)
    expect(state.message).toMatch(/…$/)
    expect(state.message).not.toContain('secret')
    expect(sanitize).toHaveBeenCalled()
  })

  it('does not issue a second concurrent check', async () => {
    const { manager, updater } = makeManager()
    updater.checkForUpdates = async () => {
      updater.checkCalls++
      await new Promise((r) => setTimeout(r, 50))
      updater.emit('update-not-available')
      return {}
    }
    const [a, b] = await Promise.all([manager.checkForUpdates(), manager.checkForUpdates()])
    expect(updater.checkCalls).toBe(1)
    expect(a.phase).toBe('not-available')
    // The concurrent caller gets the in-flight snapshot without re-checking.
    expect(b.phase).toBe('idle')
    expect(manager.getState().phase).toBe('not-available')
  })

  it('installUpdate stops the server before quitting to install', async () => {
    const { manager, updater, order } = makeManager()
    const origQuit = updater.quitAndInstall.bind(updater)
    updater.quitAndInstall = () => {
      order.push('quit')
      origQuit()
    }
    updater.emit('update-downloaded', { version: '0.2.0' })
    expect(manager.getState().phase).toBe('downloaded')

    await manager.installUpdate()
    expect(order).toEqual(['stop-server', 'quit'])
  })

  it('prevents re-entrant install', async () => {
    const { manager, updater } = makeManager()
    updater.emit('update-downloaded', { version: '0.2.0' })
    await manager.installUpdate()
    await manager.installUpdate()
    expect(updater.quitCalls).toBe(1)
  })

  it('renderer listener unsubscribe removes the listener', async () => {
    const fake = new FakeUpdater()
    const { manager } = makeManager(fake)
    const listener = vi.fn()
    const unsubscribe = manager.onUpdate(listener)
    fake.emit('update-not-available')
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
    fake.emit('update-available', { version: '0.2.0' })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(manager.getState().phase).toBe('available')
  })
})
