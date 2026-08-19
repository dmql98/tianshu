import { app, BrowserWindow, dialog, ipcMain, Notification, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import { appendFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { ServerManager } from './server-manager.js'
import { bundledNodePath, verifyBundledNode } from './runtime-paths.js'
import { UpdateManager } from './updater.js'
import type {
  DesktopAppInfo,
  DesktopServerStatus,
  UpdateState,
} from '../../shared/desktop-contract.js'
import type { ServerMessage } from '../../shared/server-ipc.js'

const isDev = !app.isPackaged
const DEV_URL = process.env.TIANSHU_DEV_URL || 'http://127.0.0.1:3457'

// 首次启动的初始化 splash：server 创建 dataDir + 物化 builtin content 期间展示。
const SPLASH_HTML = `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html>
<html><head><meta charset="utf-8"><style>
  html,body{height:100%;margin:0;display:flex;flex-direction:column;align-items:center;justify-content:center;
  background:#201b14;color:#f2ead9;font-family:system-ui,-apple-system,'Segoe UI',sans-serif}
  .logo{font-size:28px;font-weight:600;letter-spacing:2px;margin-bottom:16px}
  .spin{width:28px;height:28px;border:3px solid rgba(242,234,217,.2);border-top-color:#f2ead9;border-radius:50%;
  animation:r 1s linear infinite;margin-bottom:18px}
  .msg{font-size:14px;opacity:.75}
  @keyframes r{to{transform:rotate(360deg)}}
</style></head><body>
  <div class="logo">天枢</div>
  <div class="spin"></div>
  <div class="msg">正在初始化…</div>
</body></html>`)}`

let mainWindow: BrowserWindow | null = null
let serverManager: ServerManager | null = null
let updateManager: UpdateManager | null = null
let serverUrl = DEV_URL
const approvalNotifications = new Map<string, Notification>()
const seenApprovalNotifications = new Set<string>()

if (process.platform === 'win32') {
  app.setAppUserModelId('cn.tianshu.desktop')
}

function safeNoticeLabel(value: unknown, fallback: string, maxLength = 120): string {
  if (typeof value !== 'string') return fallback
  const clean = value.replace(/[\r\n\t]+/g, ' ').trim()
  return clean ? clean.slice(0, maxLength) : fallback
}

function sendToMainWindow(channel: string, ...args: unknown[]): void {
  const win = mainWindow
  if (!win || win.isDestroyed()) return
  const send = () => {
    if (!win.isDestroyed()) win.webContents.send(channel, ...args)
  }
  if (win.webContents.isLoadingMainFrame()) win.webContents.once('did-finish-load', send)
  else send()
}

function openSessionFromDesktop(sessionId: string): void {
  const win = mainWindow
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  if (!win.isVisible()) win.show()
  win.focus()
  sendToMainWindow('desktop:open-session', sessionId)
}

function showApprovalNotification(
  notice: Extract<ServerMessage, { type: 'approval-required' }>,
): void {
  if (!Notification.isSupported()) return
  const sessionId = safeNoticeLabel(notice.sessionId, '', 200)
  const toolCallId = safeNoticeLabel(notice.toolCallId, '', 200)
  if (!sessionId || !toolCallId) return

  const key = `${sessionId}:${toolCallId}`
  if (seenApprovalNotifications.has(key)) return
  // Bound replay de-duplication for very long-lived desktop processes.
  if (seenApprovalNotifications.size >= 500) {
    const oldest = seenApprovalNotifications.values().next().value
    if (oldest) seenApprovalNotifications.delete(oldest)
  }
  seenApprovalNotifications.add(key)

  const sessionTitle = safeNoticeLabel(notice.sessionTitle, '未命名会话', 80)
  const toolName = safeNoticeLabel(notice.toolName, '一项操作', 100)
  const notification = new Notification({
    id: `approval-${toolCallId}`,
    groupId: 'tianshu-approvals',
    groupTitle: '天枢授权请求',
    title: '天枢需要授权',
    body: `会话“${sessionTitle}”需要授权：${toolName}`,
    timeoutType: 'never',
    urgency: 'critical',
    actions: process.platform === 'win32' || process.platform === 'darwin'
      ? [
          { type: 'button', text: '稍后' },
          { type: 'button', text: '跳到会话' },
        ]
      : undefined,
  })

  const open = () => openSessionFromDesktop(sessionId)
  notification.on('click', open)
  notification.on('action', (event) => {
    if (event.actionIndex === 1) open()
    else notification.close()
  })
  notification.on('close', () => approvalNotifications.delete(key))
  approvalNotifications.set(key, notification)
  notification.show()
}

function clearApprovalNotifications(
  notice: Extract<ServerMessage, { type: 'approval-cleared' }>,
): void {
  const prefix = `${notice.sessionId}:`
  for (const [key, notification] of approvalNotifications) {
    if (notice.toolCallId ? key === `${prefix}${notice.toolCallId}` : key.startsWith(prefix)) {
      notification.close()
      approvalNotifications.delete(key)
    }
  }
}

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

  // ── Transport-neutral event channel (renderer ↔ server child) ──
  // Uplink: renderer → main → child server. Downlink/ack: child → main →
  // renderer (webContents.send). No network stack — in-process only.
  ipcMain.on('tianshu:event', (_event, msg: { reqId?: number; eventType: string; payload: unknown }) => {
    if (!manager || !msg || typeof msg.eventType !== 'string') return
    manager.sendToServer({
      type: 'tianshu:event',
      reqId: typeof msg.reqId === 'number' ? msg.reqId : 0,
      eventType: msg.eventType,
      payload: msg.payload,
    })
  })
  manager.onEvent((msg) => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (msg.reqId != null) {
      // Ack echo for an uplink action.
      mainWindow.webContents.send('tianshu:event-ack', { reqId: msg.reqId, resp: msg.payload })
    } else {
      // Downlink run event.
      mainWindow.webContents.send('tianshu:event', { eventType: msg.eventType, payload: msg.payload })
    }
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
      // The server runs outside the renderer, but Chromium otherwise
      // throttles its timers while minimized and can make streaming look dead.
      backgroundThrottling: false,
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

  // Force an authoritative renderer reconciliation after returning from the
  // background. Focus is included for platforms that do not emit restore.
  win.on('restore', () => sendToMainWindow('desktop:resume-sync'))
  win.on('focus', () => sendToMainWindow('desktop:resume-sync'))

  // 先显示"正在初始化"（首次启动 server 创建 dataDir + 物化期间），
  // server ready 后由调用方 loadURL(serverUrl) 切换主界面。
  void win.loadURL(SPLASH_HTML)
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

    // 默认数据目录 = 客户端安装路径下（跨平台：exe 所在目录）。首次启动 server
    // 自动在此创建 dataDir 并物化 builtin content，无需用户手动选择。
    // dev 模式由 dev-desktop.mjs 提供 TIANSHU_DEFAULT_DATA_DIR，不走此默认。
    const defaultDataDir = app.isPackaged
      ? join(dirname(app.getPath('exe')), 'data')
      : undefined

    const manager = new ServerManager({
      packaged: app.isPackaged,
      // 跨平台解析内置 Node 可执行文件（win32 -> node.exe，POSIX -> bin/node）。
      nodePath: bundledNodePath(process.resourcesPath),
      serverEntry: join(process.resourcesPath, 'server', 'dist', 'index.js'),
      clientDist: join(process.resourcesPath, 'client'),
      userDataDir: userData,
      defaultDataDir,
      devUrl: DEV_URL,
      // 启动前校验：Node 文件存在 + runtime-manifest 与当前平台/架构一致（§8.5）。
      preflight: () => {
        const check = verifyBundledNode(process.resourcesPath)
        return check.ok ? null : check.message ?? '内置 Node 校验失败'
      },
    })
    serverManager = manager
    registerIpc(manager)
    manager.onApprovalRequired(showApprovalNotification)
    manager.onApprovalCleared(clearApprovalNotifications)

    // ── updater（§11.4：dev 禁用；packaged 才启用；Linux 仅 AppImage 安装形态）──
    // Linux 下 deb / unpacked 运行没有 APPIMAGE 环境变量 → 禁用自动更新，
    // UI 显示"请手动下载新版本"而不是反复报错。
    const isSupportedInstallForm =
      process.platform !== 'linux' || Boolean(process.env.APPIMAGE)
    const updaterEnabled = app.isPackaged && isSupportedInstallForm
    const updaterDisabledReason =
      app.isPackaged && !isSupportedInstallForm
        ? '当前安装方式（非 AppImage）不支持自动更新，请手动下载新版本'
        : undefined
    updateManager = new UpdateManager({
      updater: autoUpdater,
      currentVersion: app.getVersion(),
      enabled: updaterEnabled,
      disabledReason: updaterDisabledReason,
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

    // 先建窗展示"正在初始化"（首次启动 server 创建 dataDir + 物化期间），
    // 再启动 server；ready 后切换到主界面（失败也切走 splash，由 did-fail-load 显示）。
    createWindow()
    const status = await manager.start()
    if (status.phase === 'ready' && status.url) {
      serverUrl = status.url
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      void mainWindow.loadURL(serverUrl)
    }

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
