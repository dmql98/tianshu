/**
 * cloud/auth.ts — 云账号登录/登出/token 管理（main 进程）。
 *
 * token 持久化：<userData>/cloud-credentials.json（Electron safeStorage 加密；
 * safeStorage 不可用时回退明文并标记，P1 改进）。凭据含 accessToken/refreshToken/username。
 */

import { app, safeStorage } from 'electron'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import type { CloudStateManager } from './state'

export interface CloudCredentials {
  cloudUrl: string
  accessToken: string
  refreshToken: string
  username: string
}

const CREDENTIALS_FILE = 'cloud-credentials.json'

function credentialsPath(): string {
  return join(app.getPath('userData'), CREDENTIALS_FILE)
}

function encode(plain: string): Buffer {
  if (safeStorage.isEncryptionAvailable()) return safeStorage.encryptString(plain)
  return Buffer.from(plain, 'utf-8')
}

function decode(data: Buffer): string {
  if (safeStorage.isEncryptionAvailable()) return safeStorage.decryptString(data)
  return data.toString('utf-8')
}

export function loadCredentials(): CloudCredentials | null {
  const file = credentialsPath()
  if (!existsSync(file)) return null
  try {
    const raw = JSON.parse(readFileSync(file, 'utf-8')) as { enc?: string; plain?: string }
    const json = raw.enc ? decode(Buffer.from(raw.enc, 'base64')) : raw.plain ?? ''
    return JSON.parse(json) as CloudCredentials
  } catch {
    return null
  }
}

export function saveCredentials(cred: CloudCredentials): void {
  const file = credentialsPath()
  mkdirSync(dirname(file), { recursive: true })
  const json = JSON.stringify(cred)
  if (safeStorage.isEncryptionAvailable()) {
    writeFileSync(file, JSON.stringify({ enc: encode(json).toString('base64') }))
  } else {
    // 回退：明文（标 plain 字段；企业环境无 DPAPI 时 P1 再想别的办法）
    writeFileSync(file, JSON.stringify({ plain: json }))
  }
}

export function clearCredentials(): void {
  const file = credentialsPath()
  if (existsSync(file)) {
    try { writeFileSync(file, '{}') } catch { /* best-effort */ }
  }
}

export class CloudAuth {
  constructor(private state: CloudStateManager) {}

  get credentials(): CloudCredentials | null {
    return loadCredentials()
  }

  async login(cloudUrl: string, username: string, password: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const base = cloudUrl.replace(/\/+$/, '')
    try {
      const res = await fetch(`${base}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
        signal: AbortSignal.timeout(15_000),
      })
      if (res.status === 429) return { ok: false, error: '尝试过于频繁，请稍后再试' }
      if (res.status === 401) return { ok: false, error: '用户名或密码错误' }
      if (!res.ok) return { ok: false, error: `登录失败（${res.status}）` }
      const body = await res.json() as { accessToken: string; refreshToken: string }
      saveCredentials({ cloudUrl: base, accessToken: body.accessToken, refreshToken: body.refreshToken, username })
      this.state.patch({ phase: 'idle', username, cloudUrl: base, lastError: null })
      return { ok: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.state.patch({ phase: 'offline', username: null, cloudUrl: base, lastError: `无法连接云端：${msg}` })
      return { ok: false, error: `无法连接云端：${msg}` }
    }
  }

  async register(cloudUrl: string, username: string, password: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const base = cloudUrl.replace(/\/+$/, '')
    try {
      const res = await fetch(`${base}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
        signal: AbortSignal.timeout(15_000),
      })
      if (res.status === 409) return { ok: false, error: '用户名已被占用' }
      if (res.status === 400) return { ok: false, error: '用户名需 3-32 位字母数字；密码至少 8 位' }
      if (res.status === 429) return { ok: false, error: '尝试过于频繁，请稍后再试' }
      if (!res.ok) return { ok: false, error: `注册失败（${res.status}）` }
      const body = await res.json() as { accessToken: string; refreshToken: string }
      saveCredentials({ cloudUrl: base, accessToken: body.accessToken, refreshToken: body.refreshToken, username })
      this.state.patch({ phase: 'idle', username, cloudUrl: base, lastError: null })
      return { ok: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.state.patch({ phase: 'offline', username: null, cloudUrl: base, lastError: `无法连接云端：${msg}` })
      return { ok: false, error: `无法连接云端：${msg}` }
    }
  }

  logout(): void {
    const cred = loadCredentials()
    if (cred) {
      // 尽力撤销 refresh（失败不影响本地登出）
      void fetch(`${cred.cloudUrl}/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: cred.refreshToken }),
        signal: AbortSignal.timeout(5_000),
      }).catch(() => {})
    }
    clearCredentials()
    this.state.patch({ phase: 'logged-out', username: null, lastError: null })
  }

  /** 带 access token 的请求封装；401 时自动 refresh 一次后重试。 */
  async apiFetch(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
    const cred = loadCredentials()
    if (!cred) throw new Error('未登录天枢云')
    const res = await fetch(`${cred.cloudUrl}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${cred.accessToken}`, ...(init.headers as Record<string, string>) },
      signal: init.signal ?? AbortSignal.timeout(60_000),
    })
    if (res.status === 401 && retry) {
      const refreshed = await this.refreshAccessToken()
      if (refreshed) return this.apiFetch(path, init, false)
    }
    return res
  }

  private async refreshAccessToken(): Promise<boolean> {
    const cred = loadCredentials()
    if (!cred) return false
    try {
      const res = await fetch(`${cred.cloudUrl}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: cred.refreshToken }),
        signal: AbortSignal.timeout(15_000),
      })
      if (!res.ok) {
        this.state.patch({ phase: 'logged-out', username: null, lastError: '登录已过期，请重新登录' })
        clearCredentials()
        return false
      }
      const body = await res.json() as { accessToken: string }
      saveCredentials({ ...cred, accessToken: body.accessToken })
      return true
    } catch {
      return false
    }
  }
}
