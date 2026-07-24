import { create } from 'zustand'
import type { Provider } from '@/types'
import * as providersApi from '@/api/providers'

interface ProvidersState {
  providers: Provider[]
  loading: boolean
  load: () => Promise<void>
  create: (data: Partial<Provider> & { id: string }) => Promise<void>
  update: (id: string, data: Partial<Provider>) => Promise<void>
  remove: (id: string) => Promise<void>
  fetchModels: (id: string) => Promise<void>
}

export const useProvidersStore = create<ProvidersState>((set, get) => ({
  providers: [],
  loading: false,

  load: async () => {
    set({ loading: true })
    try {
      const providers = await providersApi.fetchProviders()
      set({ providers, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  create: async (data) => {
    await providersApi.createProvider(data)
    await get().load()
  },

  update: async (id, data) => {
    await providersApi.updateProvider(id, data)
    await get().load()
  },

  remove: async (id) => {
    await providersApi.deleteProvider(id)
    await get().load()
  },

  fetchModels: async (id) => {
    const models = await providersApi.fetchProviderModels(id)
    const { providers } = get()
    const provider = providers.find(p => p.id === id)
    if (provider) {
      const merged = models.map((m) => {
        const old = provider.models?.find((o: any) => o.id === m.id)
        return { ...m, enabled: old ? (old as any).enabled !== false : true }
      })
      await providersApi.updateProvider(id, { models: merged as any })
      await get().load()
    }
  },
}))
