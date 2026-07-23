interface ElectronAPI {
  version: string
  platform: string
  onUpdateStatus: (callback: (status: string) => void) => void
  checkForUpdates: () => void
  openDirectoryDialog: () => Promise<string | null>
}

interface Window {
  electronAPI?: ElectronAPI
}
