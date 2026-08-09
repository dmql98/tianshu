import { useCallback, useEffect, useState } from 'react'
import type { DesktopAppInfo, UpdateState } from '../../../../../shared/desktop-contract.js'

const DISABLED: UpdateState = { phase: 'disabled', currentVersion: '' }

/**
 * Wraps the desktop updater IPC contract. In a plain browser (no
 * `window.tianshuDesktop`) it stays in the `disabled` phase so the settings
 * page keeps working without a desktop shell.
 */
export function useDesktopUpdater() {
  const [appInfo, setAppInfo] = useState<DesktopAppInfo | null>(null)
  const [updateState, setUpdateState] = useState<UpdateState>(DISABLED)

  useEffect(() => {
    const api = window.tianshuDesktop
    if (!api) return
    api.getAppInfo().then(setAppInfo).catch(() => {})
    api.getUpdateState().then(setUpdateState).catch(() => {})
    const unsubscribe = api.onUpdateState(setUpdateState)
    return unsubscribe
  }, [])

  const check = useCallback(async () => {
    const api = window.tianshuDesktop
    if (!api) return
    try {
      setUpdateState(await api.checkForUpdates())
    } catch {
      /* state stays as-is; errors are surfaced through onUpdateState */
    }
  }, [])

  const download = useCallback(async () => {
    const api = window.tianshuDesktop
    if (!api) return
    try {
      await api.downloadUpdate()
    } catch {
      /* handled via onUpdateState */
    }
  }, [])

  const install = useCallback(async () => {
    const api = window.tianshuDesktop
    if (!api) return
    try {
      await api.installUpdate()
    } catch {
      /* handled via onUpdateState */
    }
  }, [])

  return { appInfo, updateState, check, download, install }
}
