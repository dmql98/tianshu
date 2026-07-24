import { apiGet, apiPost, apiPut, apiDelete } from './client'
import type { Character, CharacterStats } from '@/types'

export const fetchCharacters = () => apiGet<Character[]>('/api/characters')

export const fetchCharacter = (id: string) => apiGet<Character>(`/api/characters/${id}`)

export const fetchCharacterStats = (id: string) => apiGet<CharacterStats>(`/api/characters/${id}/stats`)

export const createCharacter = (data: Partial<Character> & { id: string }) =>
  apiPost<Character>('/api/characters', data)

export const updateCharacter = (id: string, data: Partial<Character>) =>
  apiPut<Character>(`/api/characters/${id}`, data)

export const deleteCharacter = (id: string) =>
  apiDelete(`/api/characters/${id}`)
