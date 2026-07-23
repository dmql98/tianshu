import { apiGet, apiPost, apiPut, apiDelete } from './client'
import type { Provider } from '@/types'

export interface ProviderModel {
  id: string
  name: string
  context_window?: number
}

export const fetchProviders = () => apiGet<Provider[]>('/api/providers')

export const fetchBuiltinProviders = () => apiGet<Provider[]>('/api/providers/builtin')

export const fetchCustomProviders = () => apiGet<Provider[]>('/api/providers/custom')

export const createProvider = (data: Partial<Provider> & { id: string }) =>
  apiPost<Provider>('/api/providers', data)

export const updateProvider = (id: string, data: Partial<Provider>) =>
  apiPut<Provider>(`/api/providers/${id}`, data)

export const deleteProvider = (id: string) =>
  apiDelete(`/api/providers/${id}`)

export const fetchProviderModels = (id: string) =>
  apiGet<ProviderModel[]>(`/api/providers/${id}/models`)
