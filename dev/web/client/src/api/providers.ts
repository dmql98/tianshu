import { apiGet, apiPost, apiPut, apiDelete } from './client'
import type { Provider } from '@/types'

export interface ProviderModel {
  id: string
  name: string
  context_window?: number
  api_style?: 'auto' | 'chat_completions' | 'responses'
  compact_threshold_ratio?: number
  compact_retain_ratio?: number
  compact_snip_ratio?: number
  compact_provider?: string
  compact_model?: string
}

export interface ProviderPresetField {
  key: string
  type: 'text' | 'password' | 'select'
  label: string
  required?: boolean
  placeholder?: string
  defaultValue?: string
  options?: Array<{ label: string; value: string }>
}

export interface ProviderPresetOAuth {
  authorizeUrl: string
  exchangeUrl: string
  keyName: string
  appUrl: string
}

export interface ProviderPreset {
  id: string
  name: string
  description?: string
  format: 'openai' | 'anthropic' | 'gemini'
  runtime_plugin: string
  base_url: string
  env: string[]
  env_available: boolean
  icon_url: string
  popular: boolean
  sort_order: number
  fields: ProviderPresetField[]
  /** 声明后渲染「一键获取」按钮（如 TokenDance OAuth 授权）。 */
  oauth?: ProviderPresetOAuth
  /** 是否已被当前用户添加。 */
  added: boolean
}

export const fetchProviders = () => apiGet<Provider[]>('/api/providers')

export const fetchBuiltinProviders = () => apiGet<ProviderPreset[]>('/api/providers/builtin')

export const createProvider = (data: Partial<Provider> & { id: string }) =>
  apiPost<Provider>('/api/providers', data)

export const updateProvider = (id: string, data: Partial<Provider>) =>
  apiPut<Provider>(`/api/providers/${id}`, data)

export const deleteProvider = (id: string) =>
  apiDelete(`/api/providers/${id}`)

export const fetchProviderModels = (id: string) =>
  apiGet<ProviderModel[]>(`/api/providers/${id}/models`)

export const testProvider = (id: string) =>
  apiPost<{ ok: boolean; status?: number; error?: string; protocols?: { chat: boolean; responses?: boolean } }>(`/api/providers/${id}/test`)

// ── Provider 一键授权（OAuth PKCE，如 TokenDance）──

export interface ProviderOAuthStartResult {
  flowId: string
  authorizeUrl: string
}

export interface ProviderOAuthStatusResult {
  status: 'pending' | 'done' | 'error'
  provider: string
  applied?: number
  error?: string
}

export const startProviderOAuth = (provider: string, mode: 'callback' | 'manual' = 'callback') =>
  apiPost<ProviderOAuthStartResult>('/api/provider-oauth/start', { provider, mode })

export const pollProviderOAuth = (flowId: string) =>
  apiGet<ProviderOAuthStatusResult>(`/api/provider-oauth/${encodeURIComponent(flowId)}`)

export const submitProviderOAuthCode = (flowId: string, code: string) =>
  apiPost<{ ok: boolean; applied?: number; error?: string }>(`/api/provider-oauth/${encodeURIComponent(flowId)}/code`, { code })
