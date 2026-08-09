/**
 * Strongly-typed contract between the Electron main/preload and the React
 * renderer, exposed on `window.tianshuDesktop` via contextBridge.
 *
 * Phase 2 covers app info, server lifecycle status and the native directory
 * dialog. The auto-update surface (UpdateState / UpdatePhase / check/download/
 * install) is added in Phase 3 and must live in this same file so the types do
 * not drift between preload and the renderer.
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

export interface TianShuDesktopAPI {
  getAppInfo(): Promise<DesktopAppInfo>
  getServerStatus(): Promise<DesktopServerStatus>
  onServerStatus(listener: (status: DesktopServerStatus) => void): () => void
  openDirectoryDialog(defaultPath?: string): Promise<string | null>
}
