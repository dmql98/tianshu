import { defineStore } from 'pinia'
import { ref } from 'vue'
import * as api from '@/api/providers'

export const useProvidersStore = defineStore('providers', () => {
  const providers = ref<api.Provider[]>([])
  async function load() { providers.value = await api.fetchProviders() }
  async function create(data: Partial<api.Provider>) { const p = await api.createProvider(data); providers.value.push(p) }
  async function update(id: string, data: Partial<api.Provider>) {
    const p = await api.updateProvider(id, data)
    const idx = providers.value.findIndex(x => x.id === id)
    if (idx >= 0) Object.assign(providers.value[idx], p)
  }
  async function remove(id: string) { await api.deleteProvider(id); providers.value = providers.value.filter(x => x.id !== id) }
  async function fetchModels(id: string) {
    const models = await api.fetchProviderModels(id)
    const idx = providers.value.findIndex(x => x.id === id)
    if (idx >= 0) {
      const p = providers.value[idx]
      const merged = models.map((m: any) => {
        const old: any = p.models?.find((o: any) => o.id === m.id)
        return { ...m, enabled: old ? old.enabled !== false : true }
      })
      p.models = merged
      // persist to server so models survive page refresh
      await api.updateProvider(id, { models: merged }).catch(() => {})
    }
  }
  return { providers, load, create, update, remove, fetchModels }
})
