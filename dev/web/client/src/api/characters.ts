import { apiGet, apiPost, apiPut, apiDelete } from './client'
import type { Character } from '@/types'

export const fetchCharacters = () => apiGet<Character[]>('/api/characters')

export const createCharacter = (data: Partial<Character> & { id: string }) =>
  apiPost<Character>('/api/characters', data)

export const updateCharacter = (id: string, data: Partial<Character>) =>
  apiPut<Character>(`/api/characters/${id}`, data)

export const deleteCharacter = (id: string) =>
  apiDelete(`/api/characters/${id}`)
