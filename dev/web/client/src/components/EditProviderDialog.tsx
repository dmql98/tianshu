import { useState } from 'react'
import { useProvidersStore } from '@/stores/providersStore'
import { updateProvider } from '@/api/providers'
import type { Provider } from '@/types'
import { useI18n } from '@/i18n'

interface Props {
  provider: Provider
  onClose: () => void
}

export default function EditProviderDialog({ provider, onClose }: Props) {
  const { load } = useProvidersStore()
  const t = useI18n()
  const [name, setName] = useState(provider.name)
  const [baseUrl, setBaseUrl] = useState(provider.base_url)
  const [apiKey, setApiKey] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async () => {
    if (!name || !baseUrl) {
      setError(t('请填写服务名称和API地址'))
      return
    }
    setLoading(true)
    setError('')
    try {
      const patch: Partial<Provider> = { name, base_url: baseUrl }
      if (apiKey) patch.api_key = apiKey
      await updateProvider(provider.id, patch)
      await load()
      onClose()
    } catch {
      setError(t('保存失败，请重试'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="provider-dialog-overlay" onClick={onClose}>
      <div className="provider-dialog" onClick={e => e.stopPropagation()}>
        <div className="provider-dialog-header">
          <h2 className="provider-dialog-title">{t('编辑 {name}', { name: provider.name })}</h2>
          <button className="provider-dialog-close" onClick={onClose}>✕</button>
        </div>
        <div className="provider-dialog-body">
          {error && <div className="provider-form-error">{error}</div>}
          <div className="provider-form">
            <div className="provider-form-field">
              <label>{t('服务名称')}</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)} disabled={!!provider.is_builtin} />
            </div>
            <div className="provider-form-field">
              <label>{t('API 地址')}</label>
              <input type="text" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder={t('支持代理、私有网关或兼容端点')} />
            </div>
            <div className="provider-form-field">
              <label>API Key</label>
              {provider.envKey && (
                <div style={{fontSize: 'calc(11px * var(--ui-font-scale))',color:'var(--ink-faint)',marginBottom:4}}>
                  {t('也可设置环境变量 {key}', { key: '' })}
                  <code style={{background:'var(--bg-hover)',padding:'1px 4px',borderRadius:3}}>{provider.envKey}</code>
                </div>
              )}
              <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={provider.has_api_key ? t('已设置（留空保持不变）') : 'sk-...'} />
            </div>
          </div>
        </div>
        <div className="provider-dialog-footer">
          <button className="provider-btn secondary" onClick={onClose}>{t('取消')}</button>
          <button className="provider-btn primary" onClick={handleSubmit} disabled={loading || !name || !baseUrl}>
            {loading ? t('保存中...') : t('保存')}
          </button>
        </div>
      </div>
    </div>
  )
}
