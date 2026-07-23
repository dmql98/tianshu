import { apiGet, apiPost, apiPut, apiDelete } from './client'
import type { Skill } from '@/types'

export const fetchSkills = () => apiGet<Skill[]>('/api/skills')

export const createSkill = (data: Partial<Skill> & { id: string }) =>
  apiPost<Skill>('/api/skills', data)

export const updateSkill = (id: string, data: Partial<Skill>) =>
  apiPut<Skill>(`/api/skills/${id}`, data)

export const deleteSkill = (id: string) =>
  apiDelete(`/api/skills/${id}`)
