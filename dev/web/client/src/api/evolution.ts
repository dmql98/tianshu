import { apiGet, apiPut, apiPost } from './client'

export interface EvolutionConfig {
  character_id: string
  group_id: string
  provider_id: string
  model: string
  workspace: string
  content: string
  detect_window: number
  error_rate_threshold: number
  repetition_count: number
  high_freq_min_calls: number
  high_freq_max_unique: number
  notify_enabled: boolean
  notify_timeout: number
}

export const fetchEvolutionConfig = () => apiGet<EvolutionConfig>('/api/evolution-config')
export const saveEvolutionConfig = (config: Partial<EvolutionConfig>) => apiPut<EvolutionConfig>('/api/evolution-config', config)
export const clearEvolutionConfig = () => apiPost<{ ok: true }>('/api/evolution-config/clear')
