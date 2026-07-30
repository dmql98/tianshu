import { apiGet, apiPut } from './client'

export async function fetchDataspace(): Promise<{ dataDir: string; configured: boolean }> {
  return apiGet<{ dataDir: string; configured: boolean }>('/api/config/dataspace')
}

export async function saveDataspace(dataDir: string): Promise<void> {
  await apiPut('/api/config/dataspace', { dataDir })
}
