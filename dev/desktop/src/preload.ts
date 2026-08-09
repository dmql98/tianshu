import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { DesktopServerStatus } from '../../shared/desktop-contract.js'

// Whitelist-only bridge: no generic send(), no arbitrary channels.
const api = {
  getAppInfo: () => ipcRenderer.invoke('desktop:get-app-info'),
  getServerStatus: () => ipcRenderer.invoke('desktop:get-server-status'),
  onServerStatus: (listener: (status: DesktopServerStatus) => void) => {
    const handler = (_event: IpcRendererEvent, status: DesktopServerStatus) => listener(status)
    ipcRenderer.on('desktop:server-status', handler)
    return () => ipcRenderer.removeListener('desktop:server-status', handler)
  },
  openDirectoryDialog: (defaultPath?: string) =>
    ipcRenderer.invoke('desktop:open-directory', defaultPath),
}

contextBridge.exposeInMainWorld('tianshuDesktop', api)

export type PreloadApi = typeof api
