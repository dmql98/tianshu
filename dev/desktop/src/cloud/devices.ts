/**
 * cloud/devices.ts — 设备注册（登录后首次同步前执行一次）。
 *
 * deviceToken 与 access token 分开保存（<userData>/cloud-device.json）。
 */

import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { hostname } from 'os'
import type { CloudAuth } from './auth'

export interface DeviceCredentials {
  cloudUrl: string
  deviceToken: string
  deviceId: string
  username: string
}

const DEVICE_FILE = 'cloud-device.json'

function devicePath(): string {
  return join(app.getPath('userData'), DEVICE_FILE)
}

function load(): DeviceCredentials | null {
  if (!existsSync(devicePath())) return null
  try {
    const raw = JSON.parse(readFileSync(devicePath(), 'utf-8')) as { plain?: string }
    return raw.plain ? JSON.parse(raw.plain) as DeviceCredentials : null
  } catch {
    return null
  }
}

function save(cred: DeviceCredentials): void {
  const file = devicePath()
  const { mkdirSync } = require('fs') as typeof import('fs')
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify({ plain: JSON.stringify(cred) }))
}

export function loadDevice(): DeviceCredentials | null {
  return load()
}

function machineId(): string {
  // 稳定标识：hostname + 平台（P1 可换硬件指纹；冲突时服务端按 username+machineId 幂等复用）
  return `${hostname().toLowerCase()}-${process.platform}`
}

export class DeviceRegistry {
  constructor(private auth: CloudAuth) {}

  /** 确保当前账号下本机已注册；返回 deviceToken。 */
  async ensureRegistered(): Promise<DeviceCredentials> {
    const existing = load()
    const cred = this.auth.credentials
    if (!cred) throw new Error('未登录天枢云')
    if (existing && existing.cloudUrl === cred.cloudUrl && existing.username === cred.username) {
      return existing
    }
    const res = await this.auth.apiFetch('/sync/devices/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: hostname(), os: process.platform, machineId: machineId() }),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`设备注册失败（${res.status}）${detail.slice(0, 120)}`)
    }
    const body = await res.json() as { deviceToken: string; device: { id: string } }
    const cred2: DeviceCredentials = {
      cloudUrl: cred.cloudUrl,
      deviceToken: body.deviceToken,
      deviceId: body.device.id,
      username: cred.username,
    }
    save(cred2)
    return cred2
  }

  /** 带 device 凭据的请求（X-Device-Id + Bearer deviceToken）。 */
  async deviceFetch(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
    const dev = await this.ensureRegistered()
    const res = await fetch(`${dev.cloudUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${dev.deviceToken}`,
        'X-Device-Id': dev.deviceId,
        ...(init.headers as Record<string, string>),
      },
      signal: init.signal ?? AbortSignal.timeout(120_000),
    })
    if (res.status === 401 && retry) {
      // deviceToken 过期：重新注册（幂等）
      await this.ensureRegistered()
      return this.deviceFetch(path, init, false)
    }
    return res
  }
}
