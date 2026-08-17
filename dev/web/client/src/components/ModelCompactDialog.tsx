import { useState } from 'react'
import { useProvidersStore } from '@/stores/providersStore'
import type { Provider } from '@/types'
import { useI18n } from '@/i18n'

interface Props {
  provider: Provider
  modelId: string
  onClose: () => void
}

const hintStyle = {
  fontSize: 'calc(11px * var(--ui-font-scale))',
  color: 'var(--ink-faint)',
  marginTop: 4,
} as const

export default function ModelCompactDialog({ provider, modelId, onClose }: Props) {
  const { providers, update } = useProvidersStore()
  const t = useI18n()
  const model = provider.models?.find(m => m.id === modelId)
  const [threshold, setThreshold] = useState(model?.compact_threshold_ratio != null ? String(model.compact_threshold_ratio) : '')
  const [retain, setRetain] = useState(model?.compact_retain_ratio != null ? String(model.compact_retain_ratio) : '')
  const [summProvider, setSummProvider] = useState(model?.compact_provider || '')
  const [summModel, setSummModel] = useState(model?.compact_model || '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async () => {
    const thrRaw = threshold.trim()
    const retRaw = retain.trim()
    const thr = thrRaw === '' ? null : parseFloat(thrRaw)
    const ret = retRaw === '' ? null : parseFloat(retRaw)
    if ((thr !== null && (!Number.isFinite(thr) || thr < 0 || thr > 1)) ||
        (ret !== null && (!Number.isFinite(ret) || ret < 0 || ret > 1))) {
      setError(t('请输入 0~1 之间的数值'))
      return
    }
    setLoading(true)
    setError('')
    try {
      const models = (provider.models || []).map(m => {
        if (m.id !== modelId) return m
        const next: any = { ...m }
        if (thr === null) delete next.compact_threshold_ratio
        else next.compact_threshold_ratio = thr
        if (ret === null) delete next.compact_retain_ratio
        else next.compact_retain_ratio = ret
        const sp = summProvider.trim()
        if (!sp) delete next.compact_provider
        else next.compact_provider = sp
        const sm = summModel.trim()
        if (!sm) delete next.compact_model
        else next.compact_model = sm
        return next
      })
      await update(provider.id, { models })
      onClose()
    } catch {
      setError(t('保存失败，请重试'))
    } finally {
      setLoading(false)
    }
  }

  const clearAll = () => {
    setThreshold('')
    setRetain('')
    setSummProvider('')
    setSummModel('')
    setError('')
  }

  return (
    <div className="provider-dialog-overlay" onClick={onClose}>
      <div className="provider-dialog" onClick={e => e.stopPropagation()}>
        <div className="provider-dialog-header">
          <h2 className="provider-dialog-title">{t('压缩策略')} · {model?.name || modelId}</h2>
          <button className="provider-dialog-close" onClick={onClose}>✕</button>
        </div>
        <div className="provider-dialog-body">
          {error && <div className="provider-form-error">{error}</div>}
          <div className="provider-form">
            <div className="provider-form-field">
              <label>{t('触发阈值 (0-1)')}</label>
              <input type="text" value={threshold} onChange={e => setThreshold(e.target.value)} placeholder="0.75" />
              <div style={hintStyle}>{t('留空使用默认值 0.75')}</div>
            </div>
            <div className="provider-form-field">
              <label>{t('保留比例 (0-1)')}</label>
              <input type="text" value={retain} onChange={e => setRetain(e.target.value)} placeholder="0.16" />
              <div style={hintStyle}>{t('留空使用默认值 0.16')}</div>
            </div>
            <div className="provider-form-field">
              <label>{t('摘要服务')}</label>
              <select value={summProvider} onChange={e => setSummProvider(e.target.value)}>
                <option value="">{t('跟随主链路')}</option>
                {providers.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <div style={hintStyle}>{t('留空则使用主链路模型')}</div>
            </div>
            <div className="provider-form-field">
              <label>{t('摘要模型')}</label>
              <input type="text" value={summModel} onChange={e => setSummModel(e.target.value)} placeholder="model-id" />
              <div style={hintStyle}>{t('留空则使用主链路模型')}</div>
            </div>
          </div>
        </div>
        <div className="provider-dialog-footer">
          <button className="provider-btn secondary" onClick={clearAll}>{t('清空为默认')}</button>
          <button className="provider-btn secondary" onClick={onClose}>{t('取消')}</button>
          <button className="provider-btn primary" onClick={handleSubmit} disabled={loading}>
            {loading ? t('保存中...') : t('保存')}
          </button>
        </div>
      </div>
    </div>
  )
}
