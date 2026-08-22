/** 图标包选择 API：服务端 <dataDir>/config/iconpack.json 是跨重启权威来源。 */
import { apiGet, apiPut } from '@/api/client'

export interface IconPackSelection {
  packId: string
}

export function getIconPack(): Promise<IconPackSelection> {
  return apiGet<IconPackSelection>('/api/preferences/iconpack')
}

export function setIconPack(selection: IconPackSelection): Promise<IconPackSelection> {
  return apiPut<IconPackSelection>('/api/preferences/iconpack', selection)
}
