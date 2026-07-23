import { create } from 'zustand'
import type { Character } from '@/types'
import * as charactersApi from '@/api/characters'

interface CharactersState {
  characters: Character[]
  loading: boolean
  load: () => Promise<void>
  getById: (id: string) => Character | undefined
}

export const useCharactersStore = create<CharactersState>((set, get) => ({
  characters: [],
  loading: false,

  load: async () => {
    set({ loading: true })
    try {
      const characters = await charactersApi.fetchCharacters()
      set({ characters, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  getById: (id) => {
    return get().characters.find(c => c.id === id)
  },
}))
