import { useEffect } from 'react'

/** Electron-only draggable title bar; native window controls remain on Windows. */
export default function DesktopTitleBar() {
  const desktop = window.tianshuDesktop

  useEffect(() => {
    if (!desktop) return

    const root = document.documentElement
    const syncTheme = () => {
      const styles = getComputedStyle(root)
      const background = styles.getPropertyValue('--theme-surface-1').trim()
      const foreground = styles.getPropertyValue('--theme-text-primary').trim()
      if (background && foreground) {
        void desktop.setTitleBarTheme(background, foreground)
      }
    }

    syncTheme()
    const observer = new MutationObserver(syncTheme)
    observer.observe(root, {
      attributes: true,
      attributeFilter: ['data-color-scheme', 'data-theme-id', 'style'],
    })
    return () => observer.disconnect()
  }, [desktop])

  if (!desktop) return null

  return (
    <header className="desktop-titlebar">
      <img src="/logo.png" alt="" />
      <span>天枢</span>
    </header>
  )
}
