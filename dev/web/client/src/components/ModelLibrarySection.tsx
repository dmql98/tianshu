import { useState, useEffect, useMemo, useCallback } from 'react'
import { useProvidersStore } from '@/stores/providersStore'
import { testProvider } from '@/api/providers'
import type { Provider } from '@/types'
import { useI18n } from '@/i18n'
import AddProviderDialog from '@/components/AddProviderDialog'
import EditProviderDialog from '@/components/EditProviderDialog'
import ModelCompactDialog from '@/components/ModelCompactDialog'

/** 解析手输上下文值：\"128k\" / \"1m\" / \"200000\"。 */
function parseContextOverride(raw: string): number | null {
  const s = raw.trim().toLowerCase()
  if (!s) return null
  if (s.endsWith('k')) { const n = parseFloat(s.slice(0, -1)); return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) : null }
  if (s.endsWith('m')) { const n = parseFloat(s.slice(0, -1)); return Number.isFinite(n) && n > 0 ? Math.round(n * 1000_000) : null }
  const n = parseInt(s, 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** 数字 → 可读上下文（1400 → \"1.4k\"）。 */
function formatContext(tokens?: number): string {
  if (!tokens || tokens <= 0) return ''
  if (tokens >= 1000000) return (tokens / 1000000).toFixed(tokens % 1000000 ? 1 : 0) + 'm'
  if (tokens >= 1000) return (tokens / 1000).toFixed(tokens % 1000 ? 1 : 0) + 'k'
  return String(tokens)
}

const LS_EXPANDED = 'tianshu:model-lib-expanded'

/** 内置分组在前、自定义分组在后（对齐 penguin 的内置目录组在前语义）。 */
function sortProviders(providers: Provider[]): Provider[] {
  return [...providers].sort((a, b) => {
    const ab = a.is_builtin || a.preset_id ? 0 : 1
    const bb = b.is_builtin || b.preset_id ? 0 : 1
    return ab - bb || a.name.localeCompare(b.name, 'zh')
  })
}

/** 模型是否启用了压缩策略（任意压缩字段被设置即视为已压缩）。 */
function hasCompact(m: any): boolean {
  return m.compact_threshold_ratio != null ||
    m.compact_retain_ratio != null ||
    m.compact_snip_ratio != null ||
    m.compact_provider != null ||
    m.compact_model != null
}

/** 分组头的服务商图标：内置服务用官方图标端点，自定义用首字母。 */
function ProviderLogo({ provider }: { provider: Provider }) {
  const [failed, setFailed] = useState(false)
  const iconUrl = provider.preset_id
    ? `/api/providers/builtin/${encodeURIComponent(provider.preset_id)}/icon`
    : null
  if (!iconUrl || failed) {
    return (
      <span className="model-lib-logo">
        {provider.name.slice(0, 1).toUpperCase()}
      </span>
    )
  }
  return (
    <span className="model-lib-logo">
      <img src={iconUrl} alt="" onError={() => setFailed(true)} />
    </span>
  )
}

export default function ModelLibrarySection() {
  const t = useI18n()
  const { providers, loading, load, update, remove, fetchModels } = useProvidersStore()
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    try {
      const v = JSON.parse(localStorage.getItem(LS_EXPANDED) || '[]')
      return new Set(Array.isArray(v) ? v : [])
    } catch { return new Set() }
  })
  const [query, setQuery] = useState('')
  const [loadingModels, setLoadingModels] = useState<Record<string, boolean>>({})
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; msg: string }>>({})
  const [testing, setTesting] = useState<Record<string, boolean>>({})
  const [showAddModal, setShowAddModal] = useState(false)
  const [editTarget, setEditTarget] = useState<Provider | null>(null)
  const [compactTarget, setCompactTarget] = useState<{ provider: Provider; modelId: string } | null>(null)
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null)
  const [editingCtx, setEditingCtx] = useState<{ providerId: string; modelId: string } | null>(null)
  const [ctxDraft, setCtxDraft] = useState('')

  useEffect(() => { void load() }, [load])

  const showToast = useCallback((msg: string, type: 'ok' | 'err' = 'ok') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }, [])

  // ── 展开态持久化（默认全部收起，仅用户手动展开的分组进入此集合）──
  const toggleExpanded = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      try { localStorage.setItem(LS_EXPANDED, JSON.stringify([...next])) } catch {}
      return next
    })
  }

  // ── 搜索过滤：命中模型的分组保留并强制展开 ──
  const searching = query.trim() !== ''
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return sortProviders(providers).map(p => {
      if (!q) return { provider: p, models: p.models || [], matched: false }
      const models = (p.models || []).filter(m =>
        m.name?.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)
      )
      return { provider: p, models, matched: models.length > 0 }
    }).filter(g => g.matched || !q)
  }, [providers, query])

  // ── handler：与 SettingsPage 原逻辑完全一致 ──
  const loadModels = async (providerId: string) => {
    setLoadingModels(prev => ({ ...prev, [providerId]: true }))
    try {
      await fetchModels(providerId)
      showToast(t('模型列表已刷新'))
    } catch (err: any) {
      showToast(`${t('获取模型失败')}: ${err?.message || t('网络错误')}`, 'err')
    } finally {
      setLoadingModels(prev => ({ ...prev, [providerId]: false }))
    }
  }

  const handleTest = async (providerId: string) => {
    setTesting(prev => ({ ...prev, [providerId]: true }))
    setTestResult(prev => ({ ...prev, [providerId]: { ok: false, msg: t('测试中...') } }))
    try {
      const res = await testProvider(providerId)
      setTestResult(prev => ({
        ...prev,
        [providerId]: res.ok
          ? {
              ok: true,
              msg: `${t('连通')} (${res.status})` + (res.protocols
                ? ` · ${t('协议')}: ${res.protocols.responses ? 'Chat + Responses' : 'Chat'}`
                : ''),
            }
          : { ok: false, msg: res.error || t('连接失败') },
      }))
    } catch (e: any) {
      setTestResult(prev => ({ ...prev, [providerId]: { ok: false, msg: e?.message || t('请求失败') } }))
    } finally {
      setTesting(prev => ({ ...prev, [providerId]: false }))
    }
  }

  const handleDelete = async (providerId: string) => {
    if (!window.confirm(t('确认删除该服务？'))) return
    try { await remove(providerId); showToast(t('已删除')) } catch { showToast(t('删除失败'), 'err') }
  }

  const isModelEnabled = (provider: Provider, modelId: string) => {
    const model = provider.models?.find((m: any) => m.id === modelId)
    return model ? (model as any).enabled !== false : true
  }

  const toggleModel = async (provider: Provider, modelId: string) => {
    const models = [...(provider.models || [])]
    const model = models.find((m: any) => m.id === modelId) as any
    if (model) {
      model.enabled = model.enabled === false ? true : false
      try { await update(provider.id, { models }) } catch {}
    }
  }

  const handleModelApiStyle = async (provider: Provider, modelId: string, apiStyle: string) => {
    const models = (provider.models || []).map((m: any) =>
      m.id === modelId ? { ...m, api_style: apiStyle } : m
    )
    try { await update(provider.id, { models }); showToast(t('已保存')) } catch { showToast(t('保存失败'), 'err') }
  }

  const handleContextOverride = async (provider: Provider, modelId: string, raw: string) => {
    setEditingCtx(null)
    const parsed = parseContextOverride(raw)
    if (parsed == null) { showToast(t('上下文格式无效'), 'err'); return }
    const models = (provider.models || []).map((m: any) =>
      m.id === modelId ? { ...m, context_window: parsed, context_window_overridden: true } : m
    )
    try { await update(provider.id, { models }); showToast(t('已保存')) } catch { showToast(t('保存失败'), 'err') }
  }

  const startCtxEdit = (providerId: string, modelId: string, current?: number) => {
    setEditingCtx({ providerId, modelId })
    setCtxDraft(current ? formatContext(current) : '')
  }

  return (
    <div className="model-lib">
      {/* 监听 provider 更新后刷新折叠态无关，直接渲染 */}
      <div className="model-lib-head">
        <div className="model-lib-title">{t('模型服务')}</div>
        <div className="model-lib-tools">
          <input
            className="model-lib-search"
            placeholder={t('搜索模型…')}
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>
      </div>

      {loading && providers.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--ink-faint)' }}>{t('加载中...')}</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--ink-faint)' }}>{t('无匹配的服务')}</div>
      ) : (
        filtered.map(({ provider, models, matched }) => {
          const id = provider.id
          const open = searching ? matched || models.length > 0 : expanded.has(id)
          const test = testResult[id]
          return (
            <div key={id} className={`model-lib-group ${open ? 'open' : ''}`}>
              <div
                className="model-lib-ghead"
                onClick={() => toggleExpanded(id)}
              >
                <ProviderLogo provider={provider} />
                <span className="model-lib-gname">{provider.name}</span>
                <span className="model-lib-gcount">
                  {models.length} {t('个模型')}
                </span>
                {test && (
                  <span className={`model-lib-gstatus ${test.ok ? '' : 'err'}`}>{test.msg}</span>
                )}
                <div className="model-lib-gactions" onClick={e => e.stopPropagation()}>
                  <button
                    className="btn"
                    title={t('测试联通')}
                    onClick={() => handleTest(id)}
                    disabled={testing[id]}
                  >
                    {testing[id] ? t('测试中...') : t('测试联通')}
                  </button>
                  <button
                    className="btn"
                    title={t('刷新模型')}
                    onClick={() => loadModels(id)}
                    disabled={loadingModels[id]}
                  >
                    {loadingModels[id] ? t('加载中...') : t('刷新模型')}
                  </button>
                  <button className="btn" onClick={() => setEditTarget(provider)}>{t('编辑')}</button>
                  <button className="btn" style={{ color: 'var(--cinnabar)' }} onClick={() => handleDelete(id)}>{t('删除')}</button>
                </div>
                <span className={`model-lib-chev ${open ? 'open' : ''}`}>▶</span>
              </div>

              <div className="model-lib-gbody">
                <div className="model-lib-gbody-in">
                  <div className="model-lib-cards">
                    {models.length === 0 ? (
                      <p className="model-lib-empty">{t('点击刷新模型加载列表')}</p>
                    ) : models.map(m => {
                      const model = m as any
                      const on = isModelEnabled(provider, model.id)
                      const hasCompactCfg = hasCompact(model)
                      return (
                        <div key={model.id} className="model-lib-card">
                          <div className="model-lib-crow1">
                            <span className="model-lib-cname" title={model.id}>{model.name || model.id}</span>
                            <span
                              className="model-lib-ctoggle"
                              onClick={e => { e.stopPropagation(); toggleModel(provider, model.id) }}
                              title={on ? t('已启用，点击停用') : t('已停用，点击启用')}
                            >
                              <div className={`toggle ${on ? 'on' : ''}`} />
                            </span>
                          </div>
                          <div className="model-lib-ctags">
                            {hasCompactCfg && <span className="model-lib-tag compact">{t('已压缩')}</span>}
                            {model.supports_vision && <span className="model-lib-tag vision">{t('视觉')}</span>}
                          </div>
                          <div className="model-lib-cmeta">
                            {editingCtx?.providerId === provider.id && editingCtx?.modelId === model.id ? (
                              <input
                                autoFocus
                                className="model-lib-ctxedit"
                                value={ctxDraft}
                                onChange={e => setCtxDraft(e.target.value)}
                                onBlur={e => handleContextOverride(provider, model.id, e.target.value)}
                                onKeyDown={e => {
                                  e.stopPropagation()
                                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                                  if (e.key === 'Escape') setEditingCtx(null)
                                }}
                              />
                            ) : (
                              <span
                                className="model-lib-ctx"
                                title={t('上下文窗口（点击可修改）')}
                                onClick={e => { e.stopPropagation(); startCtxEdit(provider.id, model.id, model.context_window) }}
                              >
                                {formatContext(model.context_window) || t('上下文')}
                              </span>
                            )}
                            <select
                              className="model-lib-proto"
                              title={t('API 协议')}
                              value={model.api_style || 'auto'}
                              onClick={e => e.stopPropagation()}
                              onChange={e => handleModelApiStyle(provider, model.id, e.target.value)}
                            >
                              <option value="auto">{t('自动')}</option>
                              <option value="chat_completions">Chat</option>
                              <option value="responses">Resp</option>
                            </select>
                            <button
                              className="model-lib-gear"
                              title={t('压缩策略')}
                              onClick={e => { e.stopPropagation(); setCompactTarget({ provider, modelId: model.id }) }}
                            >
                              ⚙
                            </button>
                            {hasCompactCfg && <span className="model-lib-compact-dot" />}
                            {provider.has_api_key || provider.api_key ? (
                              <span className="model-lib-key-ok">••••</span>
                            ) : (
                              <span className="model-lib-key-missing">!</span>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>
          )
        })
      )}

      <button className="model-lib-addgroup" onClick={() => setShowAddModal(true)}>
        ＋ {t('添加服务')}
      </button>

      {showAddModal && <AddProviderDialog onClose={() => setShowAddModal(false)} />}
      {editTarget && <EditProviderDialog provider={editTarget} onClose={() => setEditTarget(null)} />}
      {compactTarget && (
        <ModelCompactDialog
          provider={compactTarget.provider}
          modelId={compactTarget.modelId}
          onClose={() => setCompactTarget(null)}
        />
      )}

      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 9999,
          padding: '8px 18px', borderRadius: 8, fontSize: 'calc(13px * var(--ui-font-scale))',
          color: '#fff', background: toast.type === 'ok' ? 'var(--jade)' : 'var(--cinnabar)',
          boxShadow: '0 4px 16px rgba(0,0,0,.2)', pointerEvents: 'none',
        }}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}