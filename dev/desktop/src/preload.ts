import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { DesktopServerStatus, UpdateState } from '../../shared/desktop-contract.js'

// Whitelist-only bridge: no generic send(), no arbitrary channels.
const api = {
  getAppInfo: () => ipcRenderer.invoke('desktop:get-app-info'),
  getServerStatus: () => ipcRenderer.invoke('desktop:get-server-status'),
  onServerStatus: (listener: (status: DesktopServerStatus) => void) => {
    const handler = (_event: IpcRendererEvent, status: DesktopServerStatus) => listener(status)
    ipcRenderer.on('desktop:server-status', handler)
    return () => ipcRenderer.removeListener('desktop:server-status', handler)
  },
  getUpdateState: () => ipcRenderer.invoke('updater:get-state'),
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  downloadUpdate: () => ipcRenderer.invoke('updater:download'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),
  onUpdateState: (listener: (state: UpdateState) => void) => {
    const handler = (_event: IpcRendererEvent, state: UpdateState) => listener(state)
    ipcRenderer.on('updater:state', handler)
    return () => ipcRenderer.removeListener('updater:state', handler)
  },
  openDirectoryDialog: (defaultPath?: string) =>
    ipcRenderer.invoke('desktop:open-directory', defaultPath),
}

contextBridge.exposeInMainWorld('tianshuDesktop', api)

export type PreloadApi = typeof api
