/**
 * cloud/state.ts — 云同步状态机（main 进程内存态，渲染层经 IPC 读取）。
 *
 * 全手动同步（用户定稿）：无任何自动触发；状态机只响应显式按钮调用。
 */

import type { CloudPhase, CloudOpProgress, CloudState } from '../../../shared/desktop-contract.js'
export type { CloudPhase, CloudOpProgress, CloudState } from '../../../shared/desktop-contract.js'
/*
export type CloudPhase =
  | 'logged-out'
  | 'offline' // 配置了账号但云端不可达（最近一次操作失败）
  | 'idle' // 已登录，待命
  | 'syncing'
  | 'error'

export interface CloudOpProgress {
  label: string // 如 '上传 characters/coder (3/5)'
  done: number
  total: number
}

*/

type Listener = (state: CloudState) => void

export class CloudStateManager {
  private state: CloudState = {
    phase: 'logged-out',
    username: null,
    cloudUrl: '',
    lastError: null,
    lastSyncAt: null,
    op: null,
  }
  private listeners = new Set<Listener>()

  get(): CloudState {
    return { ...this.state }
  }

  patch(partial: Partial<CloudState>): CloudState {
    this.state = { ...this.state, ...partial }
    this.emit()
    return this.get()
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    for (const l of this.listeners) l(this.get())
  }
}
