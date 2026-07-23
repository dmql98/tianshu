import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import * as api from '@/api/characters'
import type { CharacterConfig } from '@/api/characters'

export const useCharactersStore = defineStore('characters', () => {
  const characters = ref<api.Character[]>([])
  const activeId = ref('general')
  const active = computed(() => characters.value.find(c => c.id === activeId.value) || characters.value[0])

  async function load() { characters.value = await api.fetchCharacters() }

  async function create(data: CharacterConfig) {
    const created = await api.createCharacter(data)
    characters.value.push(created)
    return created
  }

  async function update(id: string, data: Partial<CharacterConfig>) {
    const updated = await api.updateCharacter(id, data)
    const idx = characters.value.findIndex(c => c.id === id)
    if (idx !== -1) characters.value[idx] = updated
    return updated
  }

  async function remove(id: string) {
    await api.deleteCharacter(id)
    characters.value = characters.value.filter(c => c.id !== id)
    if (activeId.value === id) {
      activeId.value = characters.value[0]?.id || 'general'
    }
  }

  function setActive(id: string) { activeId.value = id }

  return { characters, activeId, active, load, create, update, remove, setActive }
})
