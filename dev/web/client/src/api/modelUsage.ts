/** 常用模型计数 API：服务端 <dataDir>/config/model-usage.json 是跨重启权威来源。 */
import { apiGet, apiPut } from '@/api/client'

export interface ModelUsage {
  version: 1
  counts: Record<string, number>
}

export const TOP_MODELS_LIMIT = 3

export function getModelUsage(): Promise<ModelUsage> {
  return apiGet<ModelUsage>('/api/preferences/model-usage')
}

export function setModelUsage(usage: ModelUsage): Promise<ModelUsage> {
  return apiPut<ModelUsage>('/api/preferences/model-usage', usage)
}
