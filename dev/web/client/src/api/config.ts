import { apiGet, apiPut, apiPost } from './client'

export async function fetchDataspace(): Promise<{ dataDir: string; configured: boolean }> {
  return apiGet<{ dataDir: string; configured: boolean }>('/api/config/dataspace')
}

export async function saveDataspace(dataDir: string): Promise<void> {
  await apiPut('/api/config/dataspace', { dataDir })
}

export async function reloadDataspace(): Promise<{ dataDir: string }> {
  return apiPost<{ dataDir: string }>('/api/config/reload')
}

export interface ReimportBuiltinResult {
  ok: boolean
  restoredCharacters: string[]
  restoredSkills: string[]
  kept: string[]
  materialized: number
  failed: Array<{ id: string; error: string }>
}

/** 重新导入初始配置：恢复所有内置角色/技能到出厂版（用户自建的保留）。 */
export async function reimportBuiltin(): Promise<ReimportBuiltinResult> {
  return apiPost<ReimportBuiltinResult>('/api/config/reimport-builtin')
}
