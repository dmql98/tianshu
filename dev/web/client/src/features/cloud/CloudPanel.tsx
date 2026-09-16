import { useEffect, useState } from 'react'
import { useI18n } from '@/i18n'
import type {
  CloudState,
  CloudEntityInfo,
} from '../../../../../shared/desktop-contract.js'

/**
 * 天枢云面板（设置页）。登录/注册/登出 + 云端实体索引。
 * 三处六按钮的其余动作在角色页/技能页/设置配置行就地触发（见 useCloudSync）。
 */

const DEFAULT_CLOUD_URL = 'http://localhost:8787'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let v = bytes / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`
}

function relativeTime(ms: number | null): string {
  if (!ms) return '—'
  const diff = Date.now() - ms
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return new Date(ms).toLocaleDateString()
}

export function useCloudSync() {
  const [state, setState] = useState<CloudState | null>(null)
  useEffect(() => {
    const api = window.tianshuDesktop
    if (!api) return
    api.getCloudState().then(setState).catch(() => {})
    return api.onCloudState(setState)
  }, [])
  return state
}

/** 云端实体索引行。 */
function EntityRow({ entity }: { entity: CloudEntityInfo }) {
  const t = useI18n()
  const typeLabel = entity.type === 'character' ? t('角色')
    : entity.type === 'skill-package' ? t('技能包')
    : t('配置')
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border-weak,rgba(0,0,0,.06))', fontSize: 'calc(12px * var(--ui-font-scale))' }}>
      <span style={{ color: 'var(--ink-mid)' }}>{typeLabel} · {entity.id}</span>
      <span style={{ color: 'var(--ink-weak)' }}>{entity.fileCount} {t('个文件')} · {formatBytes(entity.bytes)} · {relativeTime(entity.updatedAt)}</span>
    </div>
  )
}

export default function CloudPanel() {
  const t = useI18n()
  const state = useCloudSync()
  const api = window.tianshuDesktop
  const [cloudUrl, setCloudUrl] = useState(DEFAULT_CLOUD_URL)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [entities, setEntities] = useState<CloudEntityInfo[]>([])

  useEffect(() => {
    if (state?.phase === 'idle') {
      api?.cloudListEntities().then(r => setEntities(r.entities)).catch(() => {})
    } else {
      setEntities([])
    }
  }, [state?.phase, state?.lastSyncAt, api])

  if (!api) {
    return (
      <div className="setting-row">
        <div className="setting-info">
          <span className="setting-label">{t('天枢云')}</span>
          <span className="setting-hint">{t('云同步功能仅在桌面客户端中可用。')}</span>
        </div>
      </div>
    )
  }

  const handleAuth = async () => {
    setBusy(true)
    setMessage(null)
    try {
      const fn = mode === 'login' ? api.cloudLogin : api.cloudRegister
      const r = await fn(cloudUrl, username.trim(), password)
      setMessage(r.ok ? null : (r.error ?? t('操作失败')))
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
      setPassword('')
    }
  }

  const lastError = state?.lastError
  const phaseLabel = state?.phase === 'logged-out' ? t('未登录')
    : state?.phase === 'offline' ? t('云端不可达')
    : state?.phase === 'syncing' ? t('同步中…')
    : state?.phase === 'error' ? t('出错')
    : t('已连接')

  return (
    <div>
      <div className="setting-row setting-row-stacked">
        <div className="setting-info">
          <span className="setting-label">{t('天枢云')}</span>
          <span className="setting-hint">
            {t('把角色、技能与配置同步到你的私有云端。同步完全手动，只在点击按钮时发生。')}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontSize: 'calc(11px * var(--ui-font-scale))',
            padding: '2px 10px',
            borderRadius: 999,
            background: state?.phase === 'idle' ? 'rgba(74,144,84,.15)' : 'rgba(120,120,120,.15)',
            color: state?.phase === 'idle' ? 'var(--accent,#4a9054)' : 'var(--ink-mid)',
          }}>{phaseLabel}</span>
          {state?.username && (
            <span style={{ fontSize: 'calc(12px * var(--ui-font-scale))', color: 'var(--ink-mid)' }}>{state.username}</span>
          )}
          {state && state.phase !== 'logged-out' && (
            <button className="settings-btn" onClick={() => api.cloudLogout()}>{t('退出登录')}</button>
          )}
        </div>
      </div>

      {/* 登录表单 */}
      {(!state || state.phase === 'logged-out') && (
        <div className="setting-row setting-row-stacked" style={{ gap: 10 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ fontSize: 'calc(12px * var(--ui-font-scale))', color: 'var(--ink-mid)' }}>{t('服务器')}</label>
            <input
              className="settings-input"
              style={{ flex: 1, minWidth: 220 }}
              value={cloudUrl}
              onChange={e => setCloudUrl(e.target.value)}
              placeholder={DEFAULT_CLOUD_URL}
            />
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ fontSize: 'calc(12px * var(--ui-font-scale))', color: 'var(--ink-mid)', width: 54 }}>{t('用户名')}</label>
            <input className="settings-input" style={{ flex: 1 }} value={username} onChange={e => setUsername(e.target.value)} />
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ fontSize: 'calc(12px * var(--ui-font-scale))', color: 'var(--ink-mid)', width: 54 }}>{t('密码')}</label>
            <input className="settings-input" style={{ flex: 1 }} type="password" value={password} onChange={e => setPassword(e.target.value)} />
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="settings-btn primary" disabled={busy || !username.trim() || password.length < 8} onClick={handleAuth}>
              {mode === 'login' ? t('登录') : t('注册')}
            </button>
            <button
              className="settings-btn"
              onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
            >
              {mode === 'login' ? t('没有账号？注册') : t('已有账号？登录')}
            </button>
          </div>
        </div>
      )}

      {(message || lastError) && (
        <div style={{ margin: '8px 0', padding: '8px 12px', borderRadius: 8, background: 'rgba(180,70,60,.1)', color: 'var(--danger,#b4463c)', fontSize: 'calc(12px * var(--ui-font-scale))', whiteSpace: 'pre-wrap' }}>
          {message || lastError}
        </div>
      )}

      {state?.op && (
        <div style={{ margin: '8px 0', fontSize: 'calc(12px * var(--ui-font-scale))', color: 'var(--ink-mid)' }}>
          {state.op.label}{state.op.total > 0 ? ` (${state.op.done}/${state.op.total})` : '…'}
        </div>
      )}

      {/* 云端实体索引 */}
      {state?.phase === 'idle' && entities.length > 0 && (
        <div className="setting-row setting-row-stacked">
          <div className="setting-info">
            <span className="setting-label">{t('云端内容')}</span>
            <span className="setting-hint">{t('上次同步')}: {relativeTime(state?.lastSyncAt ?? null)}</span>
          </div>
          <div>
            {entities.map(e => <EntityRow key={`${e.type}:${e.id}`} entity={e} />)}
          </div>
        </div>
      )}
    </div>
  )
}
