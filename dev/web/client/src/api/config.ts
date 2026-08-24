import { apiGet, apiPut, apiPost } from './client'

export async function fetchDataDir(): Promise<{ dataDir: string; configured: boolean }> {
  return apiGet<{ dataDir: string; configured: boolean }>('/api/config/datadir')
}

export async function saveDataDir(dataDir: string): Promise<void> {
  await apiPut('/api/config/datadir', { dataDir })
}

export async function reloadDataDir(): Promise<{ dataDir: string }> {
  return apiPost<{ dataDir: string }>('/api/config/reload')
}

export interface ReimportBuiltinResult {
  ok: boolean
  restoredCharacters: string[]
  restoredSkills: string[]
  restoredIconPacks: string[]
  restoredProviders: string[]
  restoredPrompts: number
  kept: string[]
  materialized: number
  failed: Array<{ id: string; error: string }>
}

/** 重新导入初始配置：恢复所有内置角色/技能到出厂版（用户自建的保留）。 */
export async function reimportBuiltin(): Promise<ReimportBuiltinResult> {
  return apiPost<ReimportBuiltinResult>('/api/config/reimport-builtin')
}

export interface RtkConfig {
  enabled: boolean
}

export interface RtkStatus {
  config: RtkConfig
  /** 服务端是否能在 PATH / 已知目录上找到 rtk 可执行文件。 */
  available: boolean
  /** rtk 版本号；不可用时为空串。 */
  version: string
  /** GitHub Releases 最新版本号（如 v0.45.0）；探测失败为空串。 */
  latestVersion: string
  /** 当前版本是否落后于最新版。 */
  updateAvailable: boolean
}

/** 读取 RTK 集成配置、服务端可用性与最新版本。refresh=true 时强制刷新最新版本缓存。 */
export async function fetchRtk(refresh = false): Promise<RtkStatus> {
  return apiGet<RtkStatus>(`/api/config/rtk${refresh ? '?refresh=1' : ''}`)
}

/** 保存 RTK 启用开关，返回服务端规范化后的配置。 */
export async function saveRtk(config: RtkConfig): Promise<RtkConfig> {
  return apiPut<{ ok: boolean; config: RtkConfig }>('/api/config/rtk', { config }).then(r => r.config)
}

/** 一键安装 rtk（按服务端所在平台执行官方安装方式）。 */
export async function installRtk(): Promise<{ ok: boolean; output: string }> {
  return apiPost<{ ok: boolean; output: string }>('/api/config/rtk/install')
}

/** 更新 rtk 到最新版。 */
export async function updateRtk(): Promise<{ ok: boolean; output: string }> {
  return apiPost<{ ok: boolean; output: string }>('/api/config/rtk/update')
}
