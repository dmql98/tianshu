import { create } from 'zustand'
import type { Provider } from '@/types'
import * as providersApi from '@/api/providers'

interface ProvidersState {
  providers: Provider[]
  loading: boolean
  load: () => Promise<void>
}

export const useProvidersStore = create<ProvidersState>((set) => ({
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
}))
