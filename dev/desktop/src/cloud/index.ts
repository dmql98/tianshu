/**
 * cloud/index.ts — 云同步模块门面（main 进程入口）。
 *
 * 职责：登录/登出 + 6 个同步动作（三处入口按钮）+ 状态广播。
 * 全手动（用户定稿）：无定时、无监听、登录不自动对账。
 */

import type { CloudStateManager, CloudState } from './state'
import { CloudStateManager as CSM } from './state'
import { CloudAuth } from './auth'
import { DeviceRegistry } from './devices'
import { pushEntity, removeLocalDir } from './sync/pusher'
import { pullEntity, pullAll, notifyServerReload } from './sync/puller'
import type { EntityTypeLocal } from './sync/scanner.ts'

export type { CloudState, CloudPhase, CloudOpProgress } from './state'

export class CloudManager {
  readonly state: CloudStateManager = new CSM()
  readonly auth: CloudAuth
  readonly devices: DeviceRegistry

  constructor(private dataDir: string, private serverPort: () => number) {
    this.auth = new CloudAuth(this.state)
    this.devices = new DeviceRegistry(this.auth)
    // 启动时恢复状态展示（不做网络请求）
    const cred = this.auth.credentials
    if (cred) this.state.patch({ phase: 'idle', username: cred.username, cloudUrl: cred.cloudUrl })
  }

  /** server 就绪端口（server-manager status.phase==='ready' 时有值）。 */
  private currentServerPort(): number | null {
    const p = this.serverPort()
    return p > 0 ? p : null
  }

  getState(): CloudState {
    return this.state.get()
  }

  subscribe(listener: (s: CloudState) => void): () => void {
    return this.state.subscribe(listener)
  }

  async login(cloudUrl: string, username: string, password: string) {
    return this.auth.login(cloudUrl, username, password)
  }

  async register(cloudUrl: string, username: string, password: string) {
    return this.auth.register(cloudUrl, username, password)
  }

  logout(): void {
    this.auth.logout()
    // 同步清除设备凭据
    const { app } = require('electron') as typeof import('electron')
    const { writeFileSync } = require('fs') as typeof import('fs')
    const { join } = require('path') as typeof import('path')
    try { writeFileSync(join(app.getPath('userData'), 'cloud-device.json'), '{}') } catch { /* best-effort */ }
  }

  private async guard<T>(fn: () => Promise<T>): Promise<T | { __error: string }> {
    if (!this.auth.credentials) return { __error: '未登录天枢云' }
    return fn()
  }

  /** ① 角色详情页「同步到云端」 */
  pushCharacter(id: string) {
    return this.guard(() => this.runPush('character', id))
  }

  /** ① 角色分页「拉取云端角色」 */
  pullCharacters() {
    return this.guard(() => pullAll(this.devices, this.state, this.dataDir, 'character').then(async r => {
      if (r.downloaded > 0 || r.removed > 0) await this.reloadServer()
      return r
    }))
  }

  /** ② 技能卡「同步到云端」 */
  pushSkill(category: string, pkgId: string) {
    return this.guard(() => this.runPush('skill-package', `${category}/${pkgId}`))
  }

  /** ② SkillView 页头「拉取云端技能」 */
  pullSkills() {
    return this.guard(() => pullAll(this.devices, this.state, this.dataDir, 'skill-package').then(async r => {
      if (r.downloaded > 0 || r.removed > 0) await this.reloadServer()
      return r
    }))
  }

  /** ③ 设置页「上传配置到云端」 */
  pushConfig() {
    return this.guard(() => this.runPush('config', '-'))
  }

  /** ③ 设置页「从云端下载配置」 */
  pullConfig() {
    return this.guard(async () => {
      const r = await pullEntity(this.devices, this.state, this.dataDir, 'config', '-')
      await this.reloadServer()
      return r
    })
  }

  private async reloadServer(): Promise<void> {
    const port = this.currentServerPort()
    if (port) await notifyServerReload(port)
  }

  /** 云端实体索引（设置页面板展示用）。 */
  async listCloudEntities() {
    return this.guard(async () => {
      const res = await this.devices.deviceFetch('/sync/entities')
      if (!res.ok) throw new Error(`entities ${res.status}`)
      return await res.json() as { entities: { type: string; id: string; fileCount: number; bytes: number; updatedAt: number }[] }
    })
  }

  private async runPush(type: EntityTypeLocal, id: string) {
    const r = await pushEntity(this.devices, this.state, this.dataDir, type, id)
    return r
  }

  /** 供 puller 使用的目录删除（未导出给渲染层）。 */
  get _removeLocalDir() {
    return (dir: string) => removeLocalDir(this.dataDir, dir)
  }
}
