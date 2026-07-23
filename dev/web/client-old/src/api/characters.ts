import { apiGet, apiPost, apiPut, apiDelete } from './client'

export interface ToolConstraint {
  allowed_paths?: string[]
  denied_paths?: string[]
  max_file_size?: string
  allowed_commands?: string[]
  denied_patterns?: string[]
  readonly?: boolean
  max_rows?: number
}

export interface ToolBinding {
  name: string
  constraints?: ToolConstraint
}

export interface CharacterMemory {
  enabled: boolean
  selfEvolution?: boolean
  charLimit?: number
  maxEntries?: number
}

export interface Character {
  id: string
  name: string
  description?: string
  avatar?: string
  color?: string
  soul?: string
  userProfile?: string
  memory?: CharacterMemory
  memoryContent?: string
  customPrompt?: string
  model?: string
  provider?: string
  tools?: ToolBinding[]
  maxSteps?: number
  role?: 'main' | 'sub' | 'both'
  groups?: string[]
  default_strategy?: 'Plan' | 'Ask' | 'Bypass'
  skills?: string[]
  enabled?: boolean
  builtIn?: boolean
  createdAt?: number
  updatedAt?: number
}

export type CharacterConfig = Omit<Character, 'id' | 'builtIn' | 'createdAt' | 'updatedAt'>

export const fetchCharacters = () => apiGet<Character[]>('/api/characters')
export const fetchCharacter = (id: string) => apiGet<Character>(`/api/characters/${id}`)
export const createCharacter = (data: CharacterConfig) => apiPost<Character>('/api/characters', data)
export const updateCharacter = (id: string, data: Partial<CharacterConfig>) => apiPut<Character>(`/api/characters/${id}`, data)
export const deleteCharacter = (id: string) => apiDelete(`/api/characters/${id}`)
