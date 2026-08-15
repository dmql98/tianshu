import { useState } from 'react'
import { useI18n } from '@/i18n'
import type { UpdateState } from '../../../../../shared/desktop-contract.js'
import { useDesktopUpdater } from './useDesktopUpdater'

const MAX_NOTES_LENGTH = 2000

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

function formatSpeed(bytesPerSecond?: number): string {
  return typeof bytesPerSecond === 'number' && bytesPerSecond > 0
    ? `${formatBytes(bytesPerSecond)}/s`
    : ''
}

/** Release notes rendered as capped plain text — no dangerouslySetInnerHTML. */
function ReleaseNotes({ notes }: { notes?: string }) {
  if (!notes) return null
  const text = notes.length > MAX_NOTES_LENGTH ? `${notes.slice(0, MAX_NOTES_LENGTH)}…` : notes
  return (
    <div style={{ marginTop: 8, padding: 10, borderRadius: 8, background: 'var(--bg-input,#f5f3ef)', whiteSpace: 'pre-wrap', fontSize: 'calc(12px * var(--ui-font-scale))', lineHeight: 1.6, maxHeight: 180, overflowY: 'auto', color: 'var(--ink-mid)' }}>
      {text}
    </div>
  )
}

export default function UpdatePanel() {
  const { appInfo, updateState, check, download, install } = useDesktopUpdater()
  const t = useI18n()
  const [dismissed, setDismissed] = useState(false)
  const state = updateState
  const versionLabel = `v${state.currentVersion || appInfo?.version || '0.0.0'}`

  const renderControls = () => {
    switch (state.phase) {
      case 'disabled':
        return (
          <div className="setting-row">
            <div className="setting-info"><span className="setting-label">{t('自动更新')}</span><span className="setting-hint">{t('仅打包客户端支持自动更新')}</span></div>
            <div className="setting-control"><span style={{ fontSize: 'calc(12px * var(--ui-font-scale))', color: 'var(--ink-faint)' }}>disabled</span></div>
          </div>
        )
      case 'checking':
        return <div className="setting-row"><div className="setting-control"><span style={{ fontSize: 'calc(13px * var(--ui-font-scale))', color: 'var(--ink-mid)' }}>{t('正在检查…')}</span></div></div>
      case 'available':
        return (
          <div className="setting-row">
            <div className="setting-info"><span className="setting-label">{t('发现新版本')}</span><span className="setting-hint">{t('发现 {version}，点击下载后手动安装', { version: state.targetVersion ? `v${state.targetVersion}` : t('新版本') })}</span></div>
            <div className="setting-control">
              <button className="btn primary" onClick={() => void download()}>{t('下载更新')}</button>
            </div>
          </div>
        )
      case 'downloading': {
        const percent = state.percent ?? 0
        return (
          <div className="setting-row" style={{ alignItems: 'flex-start' }}>
            <div className="setting-info"><span className="setting-label">{t('正在下载')}</span></div>
            <div className="setting-control" style={{ minWidth: 260 }}>
              <div style={{ height: 8, borderRadius: 4, background: 'var(--bg-input,#eae6df)', overflow: 'hidden', marginBottom: 6 }}>
                <div style={{ height: '100%', width: `${percent}%`, background: 'var(--jade,#1f9d72)', transition: 'width 0.2s' }} />
              </div>
              <span style={{ fontSize: 'calc(12px * var(--ui-font-scale))', color: 'var(--ink-mid)' }}>
                {percent.toFixed(0)}%&nbsp;/&nbsp;{formatBytes(state.transferred)}&nbsp;/&nbsp;{formatBytes(state.total)}
                {formatSpeed(state.bytesPerSecond) && `　${formatSpeed(state.bytesPerSecond)}`}
              </span>
            </div>
          </div>
        )
      }
      case 'downloaded':
        if (dismissed) {
          return (
            <div className="setting-row">
              <div className="setting-control"><span style={{ fontSize: 'calc(12px * var(--ui-font-scale))', color: 'var(--ink-faint)' }}>{t('将在退出时自动安装新版本')}</span></div>
            </div>
          )
        }
        return (
          <div className="setting-row">
            <div className="setting-info"><span className="setting-label">{t('更新已就绪')}</span><span className="setting-hint">{t('安装时将自动重启天枢')}</span></div>
            <div className="setting-control">
              <button className="btn primary" style={{ marginRight: 8 }} onClick={() => void install()}>{t('立即重启安装')}</button>
              <button className="btn" onClick={() => setDismissed(true)}>{t('稍后')}</button>
            </div>
          </div>
        )
      case 'error':
        return (
          <div className="setting-row" style={{ alignItems: 'flex-start' }}>
            <div className="setting-info"><span className="setting-label">{t('更新失败')}</span></div>
            <div className="setting-control">
              <div style={{ fontSize: 'calc(12px * var(--ui-font-scale))', color: 'var(--cinnabar,#c0392b)', marginBottom: 6, maxWidth: 340 }}>{state.message || t('未知错误')}</div>
              <button className="btn" onClick={() => void check()}>{t('重试')}</button>
            </div>
          </div>
        )
      case 'not-available':
      case 'idle':
      default:
        return (
          <div className="setting-row">
            <div className="setting-info"><span className="setting-label">{t('检查更新')}</span>
              <span className="setting-hint">
                {state.phase === 'not-available' ? t('已是最新版本（{time}）', { time: state.checkedAt ? new Date(state.checkedAt).toLocaleString() : '' }) : t('手动检查 GitHub Releases 上的新版本')}
              </span>
            </div>
            <div className="setting-control"><button className="btn" onClick={() => void check()}>检查更新</button></div>
          </div>
        )
    }
  }

  return (
    <div className="settings-section">
      <div className="section-title">{t('关于')}</div>
      <div className="setting-row">
        <div className="setting-info"><span className="setting-label">{t('天枢版本')}</span></div>
        <div className="setting-control"><span style={{ fontSize: 'calc(13px * var(--ui-font-scale))', color: 'var(--ink-mid)', fontWeight: 500 }}>{versionLabel}</span></div>
      </div>
      <div className="setting-row">
        <div className="setting-info"><span className="setting-label">{t('更新渠道')}</span></div>
        <div className="setting-control"><span style={{ fontSize: 'calc(13px * var(--ui-font-scale))', color: 'var(--ink-mid)' }}>Stable</span></div>
      </div>
      <div className="setting-row">
        <div className="setting-info"><span className="setting-label">{t('运行模式')}</span></div>
        <div className="setting-control"><span style={{ fontSize: 'calc(13px * var(--ui-font-scale))', color: 'var(--ink-mid)' }}>{appInfo ? (appInfo.packaged ? t('桌面客户端') : t('浏览器开发模式')) : t('浏览器开发模式')}</span></div>
      </div>
      {renderControls()}
      {(state.phase === 'available' || state.phase === 'downloaded' || state.phase === 'downloading') && (
        <ReleaseNotes notes={state.releaseNotes} />
      )}
    </div>
  )
}
