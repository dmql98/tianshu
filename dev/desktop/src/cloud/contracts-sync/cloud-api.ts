/**
 * contracts/cloud-api.ts — /auth 账号中心 + /sync 设备 REST 契约（唯一权威）。
 *
 * /auth 形态与 docs/mobile-cloud-architecture-plan.md §5.1 一致（统一账号中心，
 * 未来 /remote 等服务复用同一 JWT）。
 */

// ── /auth ──

export interface AuthUser {
  id: string
  username: string
  createdAt: number
}

export interface LoginResponse {
  accessToken: string // JWT, 30min
  refreshToken: string // 30d，哈希入库、可撤销
  user: AuthUser
}

export interface RefreshResponse {
  accessToken: string
}

// ── /sync 设备 ──

export interface DeviceRegisterRequest {
  name: string // 用户可读设备名，如 'pc-home'
  os: string
  /** 本机稳定标识（同一台机器重复注册返回同一 deviceToken）。 */
  machineId: string
}

export interface DeviceRegisterResponse {
  deviceToken: string // 后续 /sync 请求以 X-Device-Id + Bearer deviceToken 调用
  device: SyncDeviceImport
}

import type { SyncDevice as SyncDeviceImport } from './sync-contract.js'

export type { SyncDeviceImport as SyncDevice }

// ── 错误响应统一形态 ──

export interface ApiError {
  error: string
}
