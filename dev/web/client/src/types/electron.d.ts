import type { TianShuDesktopAPI } from '../../../../shared/desktop-contract.js'

declare global {
  interface Window {
    tianshuDesktop?: TianShuDesktopAPI
  }
}

export {}
