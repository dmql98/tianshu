import { useState, useEffect, useMemo, useRef } from 'react'
import Icon from '@/features/icons/Icon'
import { useI18n } from '@/i18n'
import { useProvidersStore } from '@/stores/providersStore'
import { createProvider, fetchBuiltinProviders, type ProviderPreset } from '@/api/providers'
import ProviderOAuthDialog from '@/components/ProviderOAuthDialog'

const formatLabel: Record<string, string> = {
  openai: 'OpenAI 兼容', anthropic: 'Anthropic 格式', gemini: 'Gemini 格式',
}

interface Props {
  onClose: () => void
}

function ProviderIcon({ preset }: { preset: ProviderPreset }) {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return (
      <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink-mid)' }}>
        {preset.name.slice(0, 1).toUpperCase()}
      </span>
    )
  }
  return (
    <img
      src={preset.icon_url}
      alt=""
      width={24}
      height={24}
      onError={() => setFailed(true)}
      style={{ color: 'var(--ink-mid)' }}
    />
  )
}

export default function AddProviderDialog({ onClose }: Props) {
  const { load } = useProvidersStore()
  const t = useI18n()
  const [step, setStep] = useState<'select' | 'config'>('select')
  const [builtinProviders, setBuiltinProviders] = useState<ProviderPreset[]>([])
  const [search, setSearch] = useState('')
  const [selectedProvider, setSelectedProvider] = useState<ProviderPreset | null>(null)
  const [formData, setFormData] = useState({ name: '', baseUrl: '', apiKey: '' })
  const [loading, setLoading] = useState(false)
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState('')
  const [error, setError] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  /** 当前配置步骤是否展示「一键获取」授权弹窗（仅声明 oauth 的预设可用）。 */
  const [oauthOpen, setOauthOpen] = useState(false)

  const loadList = () => {
    setListLoading(true)
    setListError('')
    fetchBuiltinProviders()
      .then(setBuiltinProviders)
      .catch((err) => setListError(err?.message || t('加载预设服务商失败')))
      .finally(() => setListLoading(false))
  }

  useEffect(() => {
    loadList()
  }, [])

  useEffect(() => {
    if (step === 'select') searchRef.current?.focus()
  }, [step])

  const filtered = useMemo(() => {
    if (!search) return builtinProviders
    const q = search.toLowerCase()
    return builtinProviders.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.id.toLowerCase().includes(q) ||
      (p.description || '').toLowerCase().includes(q) ||
      (p.format || '').includes(q)
    )
  }, [builtinProviders, search])

  const handleSelectProvider = (provider: ProviderPreset) => {
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

  /**
   * 一键获取完成：服务端已按预设创建/更新记录并写入 Key。
   * 这里直接关掉整个添加流程——继续提交会因 preset_id 重复而 409。
   */
  const handleOauthApplied = async () => {
    await load()
    onClose()
  }

  const handleSubmit = async () => {
    if (!formData.name || !formData.baseUrl) {
      setError(t('请填写服务名称和API地址'))
      return
    }

    setLoading(true)
    setError('')

    try {
      const preset = selectedProvider
      await createProvider({
        id: preset?.id || `${formData.name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`,
        name: formData.name,
        base_url: formData.baseUrl,
        api_key: formData.apiKey || undefined,
        models: [],
        ...(preset ? {
          preset_id: preset.id,
          runtime_plugin: preset.runtime_plugin,
          format: preset.format,
          is_builtin: true,
        } : {}),
      })
      await load()
      onClose()
    } catch (err: any) {
      if (err?.message?.includes('409')) setError(t('该预设服务商已添加'))
      else setError(t('添加失败，请重试'))
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
            {step === 'select' ? t('选择服务商') : (selectedProvider ? t('连接 {name}', { name: selectedProvider.name }) : t('添加自定义服务'))}
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
                  placeholder={t('搜索服务商...')}
                  style={{
                    width:'100%', padding:'6px 10px', borderRadius:6,
                    border:'1px solid var(--border)', background:'var(--bg)',
                    color:'var(--ink)', outline:'none', fontSize: 'calc(13px * var(--ui-font-scale))',
                  }}
                />
              </div>

              {listLoading && (
                <div style={{textAlign:'center',padding:24,color:'var(--ink-faint)',fontSize: 'calc(13px * var(--ui-font-scale))'}}>
                  {t('加载预设服务商...')}
                </div>
              )}

              {listError && (
                <div className="provider-form-error" style={{margin:'8px 4px'}}>
                  {listError}
                  <button
                    className="provider-btn secondary"
                    style={{marginTop:8,width:'100%'}}
                    onClick={loadList}
                  >
                    重试
                  </button>
                </div>
              )}

              {!listLoading && !listError && filtered.map(provider => (
                <div
                  key={provider.id}
                  className="provider-list-item"
                  onClick={() => !provider.added && handleSelectProvider(provider)}
                  style={provider.added ? { opacity: 0.55, cursor: 'not-allowed' } : undefined}
                >
                  <div className="provider-list-icon">
                    <ProviderIcon preset={provider} />
                  </div>
                  <div className="provider-list-info">
                    <div className="provider-list-name">
                      {provider.name}
                      {provider.popular && (
                        <span
                          style={{
                            marginLeft: 6, fontSize: 'calc(10px * var(--ui-font-scale))',
                            padding: '1px 6px', borderRadius: 8,
                            background: 'rgba(240,180,41,.18)', color: '#b8860b',
                            verticalAlign: 'middle', fontWeight: 600,
                          }}
                        >
                          {t('推荐')}
                        </span>
                      )}
                    </div>
                    <div className="provider-list-desc">
                      {provider.description || formatLabel[provider.format] || provider.format}
                      {provider.env_available && (
                        <span style={{ color: 'var(--jade)', marginLeft: 6 }}>· {t('已检测到环境变量')}</span>
                      )}
                    </div>
                  </div>
                  <div className="provider-list-arrow">
                    {provider.added ? t('已添加') : '›'}
                  </div>
                </div>
              ))}

              {!listLoading && !listError && (
                <div
                  className="provider-list-item"
                  style={{borderStyle: 'dashed'}}
                  onClick={handleCustom}
                >
                  <div className="provider-list-icon"><Icon name="add" size={16} ariaHidden /></div>
                  <div className="provider-list-info">
                    <div className="provider-list-name">{t('自定义服务商')}</div>
                  </div>
                  <div className="provider-list-arrow">›</div>
                </div>
              )}

              {!listLoading && !listError && filtered.length === 0 && search && (
                <div style={{textAlign:'center',padding:24,color:'var(--ink-faint)',fontSize: 'calc(13px * var(--ui-font-scale))'}}>
                  {t('未找到匹配的服务商')}
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
                  placeholder={t('例如：Anthropic')}
                />
              </div>

              <div className="provider-form-field">
                <label>API 地址</label>
                <input
                  type="text"
                  value={formData.baseUrl}
                  onChange={e => setFormData(p => ({...p, baseUrl: e.target.value}))}
                  placeholder={t('例如：https://api.anthropic.com/v1/')}
                />
              </div>

              <div className="provider-form-field">
                <label>
                  API Key
                  {selectedProvider?.env_available && (
                    <span className="provider-form-hint" style={{ color: 'var(--jade)' }}>
                      {t('已检测到环境变量，可留空')}
                    </span>
                  )}
                </label>
                {selectedProvider?.env?.length ? (
                  <div style={{fontSize: 'calc(11px * var(--ui-font-scale))',color:'var(--ink-faint)',marginBottom:4}}>
                     {t('也可设置环境变量')} {selectedProvider.env.map(name => (
                      <code key={name} style={{background:'var(--bg-hover)',padding:'1px 4px',borderRadius:3}}>{name}</code>
                    ))}
                  </div>
                ) : null}
                <input
                  type="password"
                  value={formData.apiKey}
                  onChange={e => setFormData(p => ({...p, apiKey: e.target.value}))}
                  placeholder="sk-..."
                />
                {selectedProvider?.oauth && (
                  <button
                    type="button"
                    className="provider-btn secondary"
                    style={{ width: '100%', marginTop: 8, color: 'var(--jade)' }}
                    onClick={() => setOauthOpen(true)}
                  >
                    {t('一键获取 API Key（浏览器授权）')}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="provider-dialog-footer">
          {step === 'select' ? (
            <button className="provider-btn secondary" onClick={onClose}>{t('取消')}</button>
          ) : (
            <>
              <button className="provider-btn secondary" onClick={() => { setStep('select'); setSearch('') }}>{t('返回')}</button>
              <button
                className="provider-btn primary"
                onClick={handleSubmit}
                disabled={loading || !formData.name || !formData.baseUrl}
              >
                {loading ? t('添加中...') : t('添加')}
              </button>
            </>
          )}
        </div>
      </div>

      {oauthOpen && selectedProvider && (
        <ProviderOAuthDialog
          provider={{ id: selectedProvider.id, name: selectedProvider.name }}
          onClose={() => setOauthOpen(false)}
          onApplied={() => void handleOauthApplied()}
        />
      )}
    </div>
  )
}
