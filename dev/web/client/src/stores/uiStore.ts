import { create } from 'zustand'

interface UIState {
  sidebarOpen: boolean
  rightPanelOpen: boolean
  filePanelOpen: boolean
  activeTab: string

  toggleSidebar: () => void
  toggleRightPanel: () => void
  toggleFilePanel: () => void
  setActiveTab: (tab: string) => void
}

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
  rightPanelOpen: true,
  filePanelOpen: false,
  activeTab: 'chat',

  toggleSidebar: () => set(state => ({ sidebarOpen: !state.sidebarOpen })),
  toggleRightPanel: () => set(state => ({ rightPanelOpen: !state.rightPanelOpen })),
  toggleFilePanel: () => set(state => ({ filePanelOpen: !state.filePanelOpen })),
  setActiveTab: (tab) => set({ activeTab: tab }),
}))
