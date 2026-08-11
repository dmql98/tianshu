import { useState, useEffect, useMemo, useRef } from 'react'
import { useProvidersStore } from '@/stores/providersStore'
import { createProvider, fetchBuiltinProviders, type ProviderModel } from '@/api/providers'

const formatLabel: Record<string, string> = {
  openai: 'OpenAI 兼容', anthropic: 'Anthropic 格式', gemini: 'Gemini 格式',
}

interface Props {
  onClose: () => void
}

export default function AddProviderDialog({ onClose }: Props) {
  const { load } = useProvidersStore()
  const [step, setStep] = useState<'select' | 'config'>('select')
  const [builtinProviders, setBuiltinProviders] = useState<any[]>([])
  const [search, setSearch] = useState('')
  const [selectedProvider, setSelectedProvider] = useState<any>(null)
  const [formData, setFormData] = useState({ name: '', baseUrl: '', apiKey: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetchBuiltinProviders().then(setBuiltinProviders).catch(console.error)
  }, [])

  useEffect(() => {
    if (step === 'select') searchRef.current?.focus()
  }, [step])

  const filtered = useMemo(() => {
    if (!search) return builtinProviders
    const q = search.toLowerCase()
    return builtinProviders.filter(p =>
      p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q) || (p.format || '').includes(q)
    )
  }, [builtinProviders, search])

  const handleSelectProvider = (provider: any) => {
    setSelectedProvider(provider)
    setFormData({
      name: provider.name,
      baseUrl: provider.base_url,
      apiKey: '',
    })
    setSearch('')
    setStep('config')
  }

  const handleCustom = () => {
    setSelectedProvider(null)
    setFormData({ name: '', baseUrl: '', apiKey: '' })
    setSearch('')
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
              <div style={{padding:'0 4px 8px'}}>
                <input
                  ref={searchRef}
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="搜索服务商..."
                  style={{
                    width:'100%', padding:'6px 10px', borderRadius:6,
                    border:'1px solid var(--border)', background:'var(--bg)',
                    color:'var(--ink)', outline:'none', fontSize: 'calc(13px * var(--ui-font-scale))',
                  }}
                />
              </div>
              {filtered.map(provider => (
                <div
                  key={provider.id}
                  className="provider-list-item"
                  onClick={() => handleSelectProvider(provider)}
                >
                  <div className="provider-list-icon">
                    <svg width={24} height={24} viewBox="0 0 40 40">
                      <use href={`/provider-icons/sprite.svg#${provider.id}`} />
                    </svg>
                  </div>
                  <div className="provider-list-info">
                    <div className="provider-list-name">{provider.name}</div>
                    <div className="provider-list-desc">{formatLabel[provider.format] || provider.format}</div>
                  </div>
                  <div className="provider-list-arrow">›</div>
                </div>
              ))}
              <div
                className="provider-list-item"
                style={{borderStyle: 'dashed'}}
                onClick={handleCustom}
              >
                <div className="provider-list-icon" style={{fontSize:18}}>➕</div>
                <div className="provider-list-info">
                  <div className="provider-list-name">自定义服务商</div>
                </div>
                <div className="provider-list-arrow">›</div>
              </div>
              {filtered.length === 0 && search && (
                <div style={{textAlign:'center',padding:24,color:'var(--ink-faint)',fontSize: 'calc(13px * var(--ui-font-scale))'}}>
                  未找到匹配的服务商
                </div>
              )}
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
                </label>
                {selectedProvider?.envKey && (
                  <div style={{fontSize: 'calc(11px * var(--ui-font-scale))',color:'var(--ink-faint)',marginBottom:4}}>
                    也可设置环境变量 <code style={{background:'var(--bg-hover)',padding:'1px 4px',borderRadius:3}}>{selectedProvider.envKey}</code>
                  </div>
                )}
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
              <button className="provider-btn secondary" onClick={() => { setStep('select'); setSearch('') }}>返回</button>
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
