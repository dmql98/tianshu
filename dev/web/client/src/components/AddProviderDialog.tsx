import { useState, useEffect } from 'react'
import { useProvidersStore } from '@/stores/providersStore'
import { createProvider, fetchBuiltinProviders, type ProviderModel } from '@/api/providers'

const ProviderIcon = ({ id, size = 24 }: { id: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 40 40">
    <use href={`/provider-icons/sprite.svg#${id}`} />
  </svg>
)

interface Props {
  onClose: () => void
}

export default function AddProviderDialog({ onClose }: Props) {
  const { load } = useProvidersStore()
  const [step, setStep] = useState<'select' | 'config'>('select')
  const [builtinProviders, setBuiltinProviders] = useState<any[]>([])
  const [selectedProvider, setSelectedProvider] = useState<any>(null)
  const [formData, setFormData] = useState({ name: '', baseUrl: '', apiKey: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchBuiltinProviders().then(setBuiltinProviders).catch(console.error)
  }, [])

  const handleSelectProvider = (provider: any) => {
    setSelectedProvider(provider)
    setFormData({
      name: provider.name,
      baseUrl: provider.base_url,
      apiKey: '',
    })
    setStep('config')
  }

  const handleSubmit = async () => {
    if (!formData.name || !formData.baseUrl) {
      setError('请填写服务名称和API地址')
      return
    }

    setLoading(true)
    setError('')

    try {
      await createProvider({
        id: selectedProvider?.id || `${formData.name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`,
        name: formData.name,
        base_url: formData.baseUrl,
        api_key: formData.apiKey || undefined,
        models: [],
      })
      await load()
      onClose()
    } catch (err) {
      setError('添加失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="provider-dialog-overlay" onClick={onClose}>
      <div className="provider-dialog" onClick={e => e.stopPropagation()}>
        <div className="provider-dialog-header">
          {step === 'config' && (
            <button className="provider-dialog-back" onClick={() => setStep('select')}>
              ← 返回
            </button>
          )}
          <h2 className="provider-dialog-title">
            {step === 'select' ? '选择服务商' : (selectedProvider ? `连接 ${selectedProvider.name}` : '添加自定义服务')}
          </h2>
          <button className="provider-dialog-close" onClick={onClose}>✕</button>
        </div>

        <div className="provider-dialog-body">
          {step === 'select' ? (
            <div className="provider-list">
              {builtinProviders.map(provider => (
                <div
                  key={provider.id}
                  className="provider-list-item"
                  onClick={() => handleSelectProvider(provider)}
                >
                  <div className="provider-list-icon">
                    <ProviderIcon id={provider.id} />
                  </div>
                  <div className="provider-list-info">
                    <div className="provider-list-name">{provider.name}</div>
                  </div>
                  <div className="provider-list-arrow">›</div>
                </div>
              ))}
              <div
                className="provider-list-item"
                style={{borderStyle: 'dashed'}}
                onClick={() => {
                  setSelectedProvider(null)
                  setFormData({ name: '', baseUrl: '', apiKey: '' })
                  setStep('config')
                }}
              >
                <div className="provider-list-icon">➕</div>
                <div className="provider-list-info">
                  <div className="provider-list-name">自定义服务商</div>
                </div>
                <div className="provider-list-arrow">›</div>
              </div>
            </div>
          ) : (
            <div className="provider-form">
              {error && (
                <div className="provider-form-error">{error}</div>
              )}
              
              <div className="provider-form-field">
                <label>服务名称</label>
                <input 
                  type="text" 
                  value={formData.name}
                  onChange={e => setFormData(p => ({...p, name: e.target.value}))}
                  placeholder="例如：Anthropic"
                />
              </div>
              
              <div className="provider-form-field">
                <label>API 地址</label>
                <input 
                  type="text" 
                  value={formData.baseUrl}
                  onChange={e => setFormData(p => ({...p, baseUrl: e.target.value}))}
                  placeholder="例如：https://api.anthropic.com/v1/"
                />
              </div>
              
              <div className="provider-form-field">
                <label>
                  API Key
                  {selectedProvider?.envKey && (
                    <span className="provider-form-hint">或设置 {selectedProvider.envKey} 环境变量</span>
                  )}
                </label>
                <input 
                  type="password" 
                  value={formData.apiKey}
                  onChange={e => setFormData(p => ({...p, apiKey: e.target.value}))}
                  placeholder="sk-..."
                />
              </div>
            </div>
          )}
        </div>

        <div className="provider-dialog-footer">
          {step === 'select' ? (
            <button className="provider-btn secondary" onClick={onClose}>取消</button>
          ) : (
            <>
              <button className="provider-btn secondary" onClick={() => setStep('select')}>返回</button>
              <button 
                className="provider-btn primary" 
                onClick={handleSubmit}
                disabled={loading || !formData.name || !formData.baseUrl}
              >
                {loading ? '添加中...' : '添加'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
