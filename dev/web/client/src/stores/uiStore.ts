import { create } from 'zustand'

interface UIState {
  sidebarOpen: boolean
  rightPanelOpen: boolean
  filePanelOpen: boolean

  toggleSidebar: () => void
  toggleRightPanel: () => void
  toggleFilePanel: () => void
}

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
  rightPanelOpen: true,
  filePanelOpen: false,

  toggleSidebar: () => set(state => ({ sidebarOpen: !state.sidebarOpen })),
  toggleRightPanel: () => set(state => ({ rightPanelOpen: !state.rightPanelOpen })),
  toggleFilePanel: () => set(state => ({ filePanelOpen: !state.filePanelOpen })),
}))
