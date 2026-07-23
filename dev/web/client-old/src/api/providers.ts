import { apiGet, apiPost, apiPut, apiDelete } from './client'

export interface Provider {
  id: string; name: string; base_url: string; api_key: string
  models: Array<{ id: string; name: string; context_window?: number }>
  builtIn?: boolean
}

export const fetchProviders = () => apiGet<Provider[]>('/api/providers')
export const createProvider = (data: Partial<Provider>) => apiPost<Provider>('/api/providers', data)
export const updateProvider = (id: string, data: Partial<Provider>) => apiPut<Provider>(`/api/providers/${id}`, data)
export const deleteProvider = (id: string) => apiDelete(`/api/providers/${id}`)
export const fetchProviderModels = (id: string) => apiGet<Array<{ id: string; name: string; context_window?: number }>>(`/api/providers/${id}/models`)
