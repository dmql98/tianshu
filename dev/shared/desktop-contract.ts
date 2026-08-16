/**
 * Strongly-typed contract between the Electron main/preload and the React
 * renderer, exposed on `window.tianshuDesktop` via contextBridge.
 *
 * Single source of truth for the desktop API surface; the preload implements
 * exactly these methods and the renderer consumes exactly these types.
 */

export interface DesktopAppInfo {
  version: string
  platform: 'win32' | 'darwin' | 'linux'
  arch: string
  packaged: boolean
}

export type DesktopServerStatus =
  | { phase: 'starting' }
  | { phase: 'ready'; port: number; url: string }
  | { phase: 'failed'; message: string }
  | { phase: 'stopping' }
  | { phase: 'stopped' }

export type UpdatePhase =
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface UpdateState {
  phase: UpdatePhase
  currentVersion: string
  targetVersion?: string
  releaseName?: string
  releaseNotes?: string
  releaseDate?: string
  percent?: number
  transferred?: number
  total?: number
  bytesPerSecond?: number
  checkedAt?: string
  message?: string
  /** 本次下载是否为差分（blockmap 增量）载荷；false 表示整包（§11.2/§11.3）。 */
  isDelta?: boolean
  /** 目标安装包总大小（字节，来自 update-available 元数据）。 */
  packageSize?: number
  /** 更新被禁用的原因（如 Linux 非 AppImage 安装形态，§11.4）。 */
  disabledReason?: string
}

/**
 * 背景图片信息。桌面端图片落盘于 userData/backgrounds，
 * 通过 `tianshu-bg://backgrounds/<fileName>` 自定义协议加载。
 */
export interface BackgroundImageInfo {
  /** 稳定文件名，例如 custom-1723456789-a1b2c3.png */
  fileName: string
  /** 通过 tianshu-bg:// 协议可加载的 URL */
  url: string
  /** 文件大小（字节） */
  sizeBytes: number
}

/** 打开图片选择对话框的结果。取消时 canceled 为 true 且无 image。 */
export interface OpenImageDialogResult {
  canceled: boolean
  image?: {
    /** 用户选择的原始文件名 */
    fileName: string
    /** dataURL，用于渲染端即时预览（保存时再由主进程落盘） */
    dataUrl: string
    /** 文件大小（字节） */
    sizeBytes: number
    /** 校验后的 MIME 类型（image/png | image/jpeg | image/webp） */
    mimeType: string
  }
}

export interface SaveBackgroundImageInput {
  /** dataURL（image/png | image/jpeg | image/webp） */
  dataUrl: string
  /** 原始文件名，仅用于推导扩展名 */
  originalName: string
}

export interface TianShuDesktopAPI {
  getAppInfo(): Promise<DesktopAppInfo>
  getServerStatus(): Promise<DesktopServerStatus>
  setTitleBarTheme(color: string, symbolColor: string): Promise<void>
  onServerStatus(listener: (status: DesktopServerStatus) => void): () => void
  getUpdateState(): Promise<UpdateState>
  checkForUpdates(): Promise<UpdateState>
  downloadUpdate(): Promise<void>
  installUpdate(): Promise<void>
  onUpdateState(listener: (state: UpdateState) => void): () => void
  /** Native approval notification asked the app to open a specific session. */
  onOpenSession(listener: (sessionId: string) => void): () => void
  /** The desktop window returned from a minimized/background state. */
  onResumeSync(listener: () => void): () => void
  openDirectoryDialog(defaultPath?: string): Promise<string | null>
  /** 打开图片选择对话框，返回 dataURL 供预览（仅桌面端可用） */
  openImageDialog(): Promise<OpenImageDialogResult>
  /** 把 dataURL 图片落盘到 userData/backgrounds，返回可加载 URL */
  saveBackgroundImage(input: SaveBackgroundImageInput): Promise<BackgroundImageInfo>
  /** 删除 userData/backgrounds 中的背景图文件 */
  deleteBackgroundImage(url: string): Promise<boolean>
}
