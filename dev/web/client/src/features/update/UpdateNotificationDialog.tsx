import { useEffect, useRef, useState } from 'react'
import { useDesktopUpdater } from './useDesktopUpdater'

function formatBytes(bytes?: number): string {
  if (typeof bytes !== 'number' || Number.isNaN(bytes)) return '—'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[i]}`
}

/**
 * Global startup popup: surfaces the update manager's state when a new version
 * is found (phase 'available'), shows download progress, then prompts to
 * install once the download completes ('downloaded'). Dismissing a phase hides
 * it until the phase changes (e.g. a manual download from settings finishes).
 */
export default function UpdateNotificationDialog() {
  const { appInfo, updateState, download, install } = useDesktopUpdater()
  const [dismissed, setDismissed] = useState(false)
  const prevPhaseRef = useRef(updateState.phase)

  const phase = updateState.phase

  useEffect(() => {
    if (prevPhaseRef.current !== phase) {
      if (phase === 'available' || phase === 'downloaded') setDismissed(false)
      prevPhaseRef.current = phase
    }
  }, [phase])

  const visible = !dismissed && (phase === 'available' || phase === 'downloading' || phase === 'downloaded')
  if (!visible) return null

  const currentVersion = `v${updateState.currentVersion || appInfo?.version || '0.0.0'}`
  const targetVersion = updateState.targetVersion ? `v${updateState.targetVersion}` : ''

  const actions =
    phase === 'available' ? (
      <div className="update-dialog-actions">
        <button className="btn" onClick={() => setDismissed(true)}>稍后</button>
        <button className="btn primary" onClick={() => void download()}>下载更新</button>
      </div>
    ) : phase === 'downloaded' ? (
      <div className="update-dialog-actions">
        <button className="btn" onClick={() => setDismissed(true)}>稍后</button>
        <button className="btn primary" onClick={() => void install()}>立即重启安装</button>
      </div>
    ) : null

  return (
    <div className="update-overlay" onClick={() => setDismissed(true)}>
      <div className="update-dialog" onClick={e => e.stopPropagation()}>
        <div className="update-dialog-body">
          {phase === 'available' && (
            <>
              <div className="update-dialog-title">🎉 发现新版本</div>
              <div className="update-dialog-desc">
                天枢 {currentVersion} 有新版本 <strong>{targetVersion}</strong> 可更新，是否现在下载？
              </div>
              {updateState.releaseNotes && <div className="update-dialog-notes">{updateState.releaseNotes}</div>}
            </>
          )}
          {phase === 'downloading' && (
            <>
              <div className="update-dialog-title">正在下载更新</div>
              <div className="update-dialog-progress">
                <div className="update-dialog-progress-track">
                  <div className="update-dialog-progress-bar" style={{ width: `${updateState.percent ?? 0}%` }} />
                </div>
                <span className="update-dialog-progress-label">
                  {Math.round(updateState.percent ?? 0)}% / {formatBytes(updateState.transferred)} / {formatBytes(updateState.total)}
                </span>
              </div>
            </>
          )}
          {phase === 'downloaded' && (
            <>
              <div className="update-dialog-title">更新已就绪</div>
              <div className="update-dialog-desc">
                新版本 {targetVersion} 已下载完成，重启天枢后即可使用。
              </div>
            </>
          )}
        </div>
        {actions}
      </div>
    </div>
  )
}
