import { apiGet, apiPost, apiPut, apiDelete } from './client'
import type { Tool } from '@/types'

export const fetchTools = () => apiGet<Tool[]>('/api/tools')

export const createTool = (data: Partial<Tool> & { id: string }) =>
  apiPost<Tool>('/api/tools', data)

export const updateTool = (id: string, data: Partial<Tool>) =>
  apiPut<Tool>(`/api/tools/${id}`, data)

export const deleteTool = (id: string) =>
  apiDelete(`/api/tools/${id}`)
