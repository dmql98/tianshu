import { useEffect, useRef, useState } from 'react'
import { useI18n } from '@/i18n'
import {
  startProviderOAuth,
  pollProviderOAuth,
  submitProviderOAuthCode,
} from '@/api/providers'

const POLL_MS = 2000

type Phase = 'starting' | 'ready' | 'waiting' | 'done' | 'failed'

/**
 * 「一键获取」弹窗：开流 → 打开授权页 → 轮询结果（callback 模式）
 * 或粘贴一次性 code（manual 模式）。密钥全程不经过浏览器。
 */
export default function ProviderOAuthDialog({
  provider,
  onClose,
  onApplied,
}: {
  provider: { id: string; name: string }
  onClose: () => void
  onApplied: (applied: number) => void
}) {
  const t = useI18n()
  const [manual, setManual] = useState(false)
  const [phase, setPhase] = useState<Phase>('starting')
  const [flow, setFlow] = useState<{ flowId: string; authorizeUrl: string } | null>(null)
  const [error, setError] = useState('')
  const [code, setCode] = useState('')
  const [applied, setApplied] = useState(0)
  const [attempt, setAttempt] = useState(0)
  const onAppliedRef = useRef(onApplied)
  onAppliedRef.current = onApplied

  // 打开弹窗即开流，授权 URL 在点击按钮时已就绪（popup blocker 友好）。
  useEffect(() => {
    let cancelled = false
    setPhase('starting')
    setFlow(null)
    setError('')
    setCode('')
    void (async () => {
      try {
        const res = await startProviderOAuth(provider.id, manual ? 'manual' : 'callback')
        if (cancelled) return
        setFlow(res)
        setPhase('ready')
      } catch (e: any) {
        if (cancelled) return
        setError(e?.message || t('授权失败'))
        setPhase('failed')
      }
    })()
    return () => { cancelled = true }
  }, [provider.id, manual, attempt])

  // callback 模式：结果落在服务端，本页轮询。
  useEffect(() => {
    if (phase !== 'waiting' || manual || flow === null) return
    let stopped = false
    const tick = async () => {
      try {
        const res = await pollProviderOAuth(flow.flowId)
        if (stopped) return
        if (res.status === 'done') {
          setApplied(res.applied ?? 0)
          setPhase('done')
          onAppliedRef.current(res.applied ?? 0)
          return
        }
        if (res.status === 'error') {
          setError(res.error ? t(`授权失败：${res.error}`) : t('授权超时，请重试'))
          setPhase('failed')
        }
      } catch {
        if (stopped) return
        setError(t('授权超时，请重试'))
        setPhase('failed')
      }
    }
    const timer = window.setInterval(() => void tick(), POLL_MS)
    return () => { stopped = true; window.clearInterval(timer) }
  }, [phase, manual, flow, t])

  const openAuthorizePage = () => {
    if (flow === null) return
    window.open(flow.authorizeUrl, '_blank', 'noopener,noreferrer')
    if (!manual) setPhase('waiting')
  }

  const submitCode = async () => {
    if (flow === null) return
    setPhase('waiting')
    setError('')
    try {
      const res = await submitProviderOAuthCode(flow.flowId, code.trim())
      if (res.ok) {
        setApplied(res.applied ?? 0)
        setPhase('done')
        onAppliedRef.current(res.applied ?? 0)
        return
      }
      setError(res.error ? t(`授权失败：${res.error}`) : t('授权失败，请重试'))
      setPhase('failed')
    } catch (e: any) {
      setError(e?.message || t('授权失败，请重试'))
      setPhase('failed')
    }
  }

  return (
    <div className="provider-dialog-overlay" onClick={onClose}>
      <div className="provider-dialog" onClick={e => e.stopPropagation()}>
        <div className="provider-dialog-header">
          <h2 className="provider-dialog-title">
            {t('一键获取 {name} API Key', { name: provider.name })}
          </h2>
          <button className="provider-dialog-close" onClick={onClose}>✕</button>
        </div>
        <div className="provider-dialog-body provider-form">
          {error && <div className="provider-form-error">{error}</div>}

          {phase === 'done' ? (
            <div style={{ textAlign: 'center', padding: '12px 0', color: 'var(--ink)' }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>✓</div>
              <p>
                {t('已获取新的 API Key 并写入 {name}', { name: provider.name })}
                {applied > 0 ? `（${t('已应用到 {count} 个模型', { count: applied })}）` : ''}
              </p>
              <p style={{ color: 'var(--ink-faint)', fontSize: 'calc(12px * var(--ui-font-scale))' }}>
                {t('后续调用将自动归因到本应用')}
              </p>
            </div>
          ) : phase === 'starting' ? (
            <p style={{ textAlign: 'center', padding: 12, color: 'var(--ink-faint)' }}>
              {t('准备授权中...')}
            </p>
          ) : (
            <>
              {manual ? (
                <>
                  <p style={{ marginBottom: 8, color: 'var(--ink)' }}>
                    {t('点击下方按钮在浏览器中完成授权，然后把授权页显示的一次性代码粘贴到此处。')}
                  </p>
                  <div className="provider-form-field">
                    <label>{t('一次性授权码')}</label>
                    <input
                      type="text"
                      value={code}
                      onChange={e => setCode(e.target.value)}
                      placeholder={t('粘贴授权码')}
                    />
                  </div>
                </>
              ) : (
                <p style={{ marginBottom: 8, color: 'var(--ink)' }}>
                  {t('将在浏览器中打开 {name} 授权页，确认后自动完成密钥获取。', { name: provider.name })}
                </p>
              )}
              <button
                type="button"
                onClick={() => setManual(m => !m)}
                style={{
                  background: 'none', border: 'none', color: 'var(--ink-mid)',
                  textDecoration: 'underline', cursor: 'pointer', fontSize: 'calc(12px * var(--ui-font-scale))',
                  padding: 0,
                }}
              >
                {manual ? t('使用浏览器回调') : t('无法自动回调？使用手动授权码')}
              </button>
            </>
          )}
        </div>
        <div className="provider-dialog-footer">
          {phase === 'done' ? (
            <button className="provider-btn primary" onClick={onClose}>{t('关闭')}</button>
          ) : phase === 'failed' ? (
            <>
              <button className="provider-btn secondary" onClick={onClose}>{t('取消')}</button>
              <button className="provider-btn primary" onClick={() => setAttempt(n => n + 1)}>
                {t('重试')}
              </button>
            </>
          ) : phase === 'starting' ? (
            <button className="provider-btn secondary" onClick={onClose}>{t('取消')}</button>
          ) : manual ? (
            <>
              <button className="provider-btn secondary" onClick={onClose}>{t('取消')}</button>
              <button
                className="provider-btn primary"
                disabled={!code.trim() || phase === 'waiting'}
                onClick={submitCode}
              >
                {phase === 'waiting' ? t('提交中...') : t('提交授权码')}
              </button>
            </>
          ) : (
            <>
              <button className="provider-btn secondary" onClick={onClose}>{t('取消')}</button>
              <button className="provider-btn primary" disabled={flow === null} onClick={openAuthorizePage}>
                {phase === 'waiting' ? t('等待授权完成...') : t('前往授权')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
