import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import { appendFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { ServerManager } from './server-manager.js'
import { UpdateManager } from './updater.js'
import type {
  DesktopAppInfo,
  DesktopServerStatus,
  UpdateState,
} from '../../shared/desktop-contract.js'

const isDev = !app.isPackaged
const DEV_URL = process.env.TIANSHU_DEV_URL || 'http://127.0.0.1:3457'

let mainWindow: BrowserWindow | null = null
let serverManager: ServerManager | null = null
let updateManager: UpdateManager | null = null
let serverUrl = DEV_URL

function updaterLogFile(): string {
  return join(app.getPath('userData'), 'logs', 'updater.log')
}

function logUpdater(msg: string): void {
  try {
    appendFileSync(updaterLogFile(), `${new Date().toISOString()} ${msg}\n`)
  } catch {
    /* logging is best-effort */
  }
}

/** Strip local paths before an error message reaches the renderer. */
function sanitizeUpdaterMessage(msg: string): string {
  const paths = [app.getPath('userData'), app.getAppPath(), process.resourcesPath].filter(Boolean)
  let out = msg
  for (const p of paths) {
    if (p) out = out.split(p).join('<本地路径>')
  }
  return out
}

function broadcastUpdateState(state: UpdateState): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('updater:state', state)
    }
  }
}

function registerIpc(manager: ServerManager): void {
  ipcMain.handle('desktop:get-app-info', (): DesktopAppInfo => ({
    version: app.getVersion(),
    platform: process.platform as DesktopAppInfo['platform'],
    arch: process.arch,
    packaged: app.isPackaged,
  }))

  ipcMain.handle('desktop:get-server-status', (): DesktopServerStatus => manager.getStatus())

  ipcMain.handle('desktop:set-title-bar-theme', (event, color: string, symbolColor: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || process.platform === 'darwin') return

    // Theme values are data, not arbitrary CSS: keep the bridge deliberately narrow.
    const isSafeColor = (value: unknown): value is string =>
      typeof value === 'string' && value.length <= 64 && (
        /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(value) ||
        /^rgba?\([\d\s.,%]+\)$/i.test(value)
      )
    if (!isSafeColor(color) || !isSafeColor(symbolColor)) return

    win.setTitleBarOverlay({ color, symbolColor, height: 42 })
  })

  ipcMain.handle('desktop:open-directory', async (event, defaultPath?: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(win!, {
      title: '选择天枢数据存储目录',
      defaultPath,
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('updater:get-state', (): UpdateState =>
    updateManager?.getState() ?? { phase: 'disabled', currentVersion: app.getVersion() },
  )
  ipcMain.handle('updater:check', async (): Promise<UpdateState> => {
    try {
      return (await updateManager?.checkForUpdates()) ?? { phase: 'disabled', currentVersion: app.getVersion() }
    } catch (err) {
      console.error('[desktop] updater check failed:', err)
      return updateManager?.getState() ?? { phase: 'error', currentVersion: app.getVersion(), message: String(err) }
    }
  })
  ipcMain.handle('updater:download', async () => {
    try {
      await updateManager?.downloadUpdate()
    } catch (err) {
      console.error('[desktop] updater download failed:', err)
    }
  })
  ipcMain.handle('updater:install', async () => {
    try {
      await updateManager?.installUpdate()
    } catch (err) {
      console.error('[desktop] updater install failed:', err)
    }
  })
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    title: '天枢',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#201b14',
      symbolColor: '#f2ead9',
      height: 42,
    },
    // On Windows the window/taskbar icon is taken from the exe's embedded
    // icon.ico (buildResources), so no runtime icon path is needed here.
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  mainWindow = win

  win.once('ready-to-show', () => win.show())

  // External links: only https via the OS shell; everything else is denied.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  // Restrict navigation to the local server origin we launched with.
  win.webContents.on('will-navigate', (event, url) => {
    let allowed = false
    try {
      const target = new URL(url)
      for (const base of [serverUrl, DEV_URL]) {
        const b = new URL(base)
        if (target.origin === b.origin) {
          allowed = true
          break
        }
      }
    } catch {
      allowed = false
    }
    if (!allowed) event.preventDefault()
  })

  win.webContents.on('did-fail-load', (_event, code, desc) => {
    if (code === -3) return // ERR_ABORTED
    console.error(`[desktop] failed to load ${serverUrl}: ${desc} (${code})`)
  })

  win.on('closed', () => {
    mainWindow = null
  })

  void win.loadURL(serverUrl)
}

// ── single instance ──
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  void app.whenReady().then(async () => {
    const userData = app.getPath('userData')
    mkdirSync(join(userData, 'logs'), { recursive: true })

    const manager = new ServerManager({
      packaged: app.isPackaged,
      nodePath: join(process.resourcesPath, 'runtime', 'node', 'node.exe'),
      serverEntry: join(process.resourcesPath, 'server', 'dist', 'index.js'),
      clientDist: join(process.resourcesPath, 'client'),
      userDataDir: userData,
      devUrl: DEV_URL,
    })
    serverManager = manager
    registerIpc(manager)

    // ── updater (disabled in dev; packaged only) ──
    updateManager = new UpdateManager({
      updater: autoUpdater,
      currentVersion: app.getVersion(),
      enabled: app.isPackaged,
      stopServer: async () => {
        if (serverManager) await serverManager.stop()
      },
      log: logUpdater,
      sanitize: sanitizeUpdaterMessage,
    })
    updateManager.onUpdate(broadcastUpdateState)
    logUpdater(`updater initialized (enabled=${app.isPackaged}, version=${app.getVersion()})`)

    // Surface server lifecycle changes to the renderer (startup failures etc.).
    manager.onStatus((status) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('desktop:server-status', status)
      }
    })

    const status = await manager.start()
    if (status.phase === 'ready' && status.url) {
      serverUrl = status.url
    }

    createWindow()

    // Silent background check ~7s after the window is up (packaged only).
    if (app.isPackaged) {
      setTimeout(() => {
        updateManager?.checkForUpdates().catch(() => {})
      }, 7_000)
    }
  })

  app.on('window-all-closed', () => {
    app.quit()
  })

  let quitting = false
  app.on('before-quit', (event) => {
    if (quitting) return
    event.preventDefault()
    quitting = true
    void (async () => {
      try {
        if (serverManager) await serverManager.stop()
      } catch (err) {
        console.error('[desktop] error while stopping server:', err)
      }
      app.exit(0)
    })()
  })
}
