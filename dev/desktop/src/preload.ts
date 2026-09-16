import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { DesktopServerStatus, UpdateSource, UpdateState } from '../../shared/desktop-contract.js'
import type { CloudState } from './cloud/index.js'

// Whitelist-only bridge: no generic send(), no arbitrary channels.
const api = {
  getAppInfo: () => ipcRenderer.invoke('desktop:get-app-info'),
  getServerStatus: () => ipcRenderer.invoke('desktop:get-server-status'),
  setTitleBarTheme: (color: string, symbolColor: string) =>
    ipcRenderer.invoke('desktop:set-title-bar-theme', color, symbolColor),
  onServerStatus: (listener: (status: DesktopServerStatus) => void) => {
    const handler = (_event: IpcRendererEvent, status: DesktopServerStatus) => listener(status)
    ipcRenderer.on('desktop:server-status', handler)
    return () => ipcRenderer.removeListener('desktop:server-status', handler)
  },
  getUpdateState: () => ipcRenderer.invoke('updater:get-state'),
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  downloadUpdate: () => ipcRenderer.invoke('updater:download'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),
  getUpdateSource: () => ipcRenderer.invoke('updater:get-source'),
  setUpdateSource: (source: UpdateSource) => ipcRenderer.invoke('updater:set-source', source),
  onUpdateState: (listener: (state: UpdateState) => void) => {
    const handler = (_event: IpcRendererEvent, state: UpdateState) => listener(state)
    ipcRenderer.on('updater:state', handler)
    return () => ipcRenderer.removeListener('updater:state', handler)
  },
  onOpenSession: (listener: (sessionId: string) => void) => {
    const handler = (_event: IpcRendererEvent, sessionId: string) => listener(sessionId)
    ipcRenderer.on('desktop:open-session', handler)
    return () => ipcRenderer.removeListener('desktop:open-session', handler)
  },
  onResumeSync: (listener: () => void) => {
    const handler = () => listener()
    ipcRenderer.on('desktop:resume-sync', handler)
    return () => ipcRenderer.removeListener('desktop:resume-sync', handler)
  },
  openDirectoryDialog: (defaultPath?: string, title?: string) =>
    ipcRenderer.invoke('desktop:open-directory', defaultPath, title),
  openPath: (path: string) =>
    ipcRenderer.invoke('desktop:open-path', path),

  // ── 云同步（cloud:*；全手动触发）──
  getCloudState: () => ipcRenderer.invoke('cloud:get-state'),
  cloudLogin: (cloudUrl: string, username: string, password: string) =>
    ipcRenderer.invoke('cloud:login', cloudUrl, username, password),
  cloudRegister: (cloudUrl: string, username: string, password: string) =>
    ipcRenderer.invoke('cloud:register', cloudUrl, username, password),
  cloudLogout: () => ipcRenderer.invoke('cloud:logout'),
  cloudPushCharacter: (id: string) => ipcRenderer.invoke('cloud:push-character', id),
  cloudPullCharacters: () => ipcRenderer.invoke('cloud:pull-characters'),
  cloudPushSkill: (category: string, pkgId: string) => ipcRenderer.invoke('cloud:push-skill', category, pkgId),
  cloudPullSkills: () => ipcRenderer.invoke('cloud:pull-skills'),
  cloudPushConfig: () => ipcRenderer.invoke('cloud:push-config'),
  cloudPullConfig: () => ipcRenderer.invoke('cloud:pull-config'),
  cloudListEntities: () => ipcRenderer.invoke('cloud:list-entities'),
  onCloudState: (listener: (state: CloudState) => void) => {
    const handler = (_event: IpcRendererEvent, state: CloudState) => listener(state)
    ipcRenderer.on('cloud:state', handler)
    return () => ipcRenderer.removeListener('cloud:state', handler)
  },

  // ── Transport-neutral event channel (IPC bridge for the desktop app) ──
  eventSend: (type: string, payload: unknown, ack?: (resp: unknown) => void) => {
    const reqId = ++eventReqSeq
    if (ack) eventAcks.set(reqId, ack)
    ipcRenderer.send('tianshu:event', { reqId, eventType: type, payload })
  },
  eventOn: (listener: (data: { eventType: string; payload: unknown }) => void) => {
    const handler = (_event: IpcRendererEvent, data: { eventType: string; payload: unknown }) => listener(data)
    ipcRenderer.on('tianshu:event', handler)
    return () => ipcRenderer.removeListener('tianshu:event', handler)
  },
}

// Uplink ack routing: the main process echoes { reqId, resp } on
// 'tianshu:event-ack' after the server child answers.
let eventReqSeq = 0
const eventAcks = new Map<number, (resp: unknown) => void>()
ipcRenderer.on('tianshu:event-ack', (_event, { reqId, resp }: { reqId: number; resp: unknown }) => {
  const cb = eventAcks.get(reqId)
  if (cb) {
    eventAcks.delete(reqId)
    cb(resp)
  }
})

contextBridge.exposeInMainWorld('tianshuDesktop', api)

export type PreloadApi = typeof api
