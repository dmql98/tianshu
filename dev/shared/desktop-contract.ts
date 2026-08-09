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
}

export interface TianShuDesktopAPI {
  getAppInfo(): Promise<DesktopAppInfo>
  getServerStatus(): Promise<DesktopServerStatus>
  onServerStatus(listener: (status: DesktopServerStatus) => void): () => void
  getUpdateState(): Promise<UpdateState>
  checkForUpdates(): Promise<UpdateState>
  downloadUpdate(): Promise<void>
  installUpdate(): Promise<void>
  onUpdateState(listener: (state: UpdateState) => void): () => void
  openDirectoryDialog(defaultPath?: string): Promise<string | null>
}
