import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join } from 'path'
import { mkdirSync } from 'fs'
import { ServerManager } from './server-manager.js'
import type { DesktopAppInfo, DesktopServerStatus } from '../../shared/desktop-contract.js'

const isDev = !app.isPackaged
const DEV_URL = process.env.TIANSHU_DEV_URL || 'http://127.0.0.1:3457'

let mainWindow: BrowserWindow | null = null
let serverManager: ServerManager | null = null
let serverUrl = DEV_URL

function registerIpc(manager: ServerManager): void {
  ipcMain.handle('desktop:get-app-info', (): DesktopAppInfo => ({
    version: app.getVersion(),
    platform: process.platform as DesktopAppInfo['platform'],
    arch: process.arch,
    packaged: app.isPackaged,
  }))

  ipcMain.handle('desktop:get-server-status', (): DesktopServerStatus => manager.getStatus())

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
