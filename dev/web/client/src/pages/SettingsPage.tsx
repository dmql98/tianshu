import { useState, useEffect } from 'react'
import { useProvidersStore } from '@/stores/providersStore'
import { testProvider } from '@/api/providers'
import { fetchDefaultPrompt, saveDefaultPrompt } from '@/api/prompts'
import { fetchDataspace, saveDataspace, reloadDataspace, reimportBuiltin, fetchRtk, saveRtk, installRtk, updateRtk } from '@/api/config'
import { fetchEvolutionConfig, saveEvolutionConfig, clearEvolutionConfig, type EvolutionConfig } from '@/api/evolution'
import { fetchCharacters } from '@/api/characters'
import type { Provider, Character } from '@/types'
import type { DesktopServerStatus } from '../../../../shared/desktop-contract.js'
import UpdatePanel from '@/features/update/UpdatePanel'
import AddProviderDialog from '@/components/AddProviderDialog'
import EditProviderDialog from '@/components/EditProviderDialog'
import ModelCompactDialog from '@/components/ModelCompactDialog'

/** Parse a hand-entered context value like "128k", "1m" or "200000". */
function parseContextOverride(raw: string): number | null {
  const s = raw.trim().toLowerCase()
  if (!s) return null
  if (s.endsWith('k')) { const n = parseFloat(s.slice(0, -1)); return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) : null }
  if (s.endsWith('m')) { const n = parseFloat(s.slice(0, -1)); return Number.isFinite(n) && n > 0 ? Math.round(n * 1000_000) : null }
  const n = parseInt(s, 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

function formatContext(tokens?: number): string {
  if (!tokens || tokens <= 0) return ''
  if (tokens >= 1000000) return (tokens / 1000000).toFixed(tokens % 1000000 ? 1 : 0) + 'm'
  if (tokens >= 1000) return (tokens / 1000).toFixed(tokens % 1000 ? 1 : 0) + 'k'
  return String(tokens)
}
import SystemRunPolicySettings from '@/features/run-policy/SystemRunPolicySettings'
import ThemeSelector from '@/features/theme/ThemeSelector'
import ThemeStudio from '@/features/theme/ThemeStudio'
import IconPackSelector from '@/features/icons/IconPackSelector'
import IconPackEditor from '@/features/icons/IconPackEditor'
import Icon from '@/features/icons/Icon'
import type { CustomIconPack } from '@/features/icons/iconPacksApi'
import type { ThemeDefinition } from '@/features/theme/themeDefinitions'
import { useI18n, useI18nStore } from '@/i18n'
import type { Locale } from '@/i18n'
import { setThemeSelection } from '@/features/theme/themeRuntime'
import { loadThemePreferences } from '@/features/theme/themePreferences'
import { textColorContrastOn } from '@/features/display/displayPreferences'
import {
  DEFAULT_DISPLAY_PREFERENCES,
  applyDisplayPreferences,
  isValidHexColor,
  loadDisplayPreferences,
  normalizeDisplayPreferences,
  resetDisplayPreferences,
  saveDisplayPreferences,
  type DisplayPreferences,
  type FontFamilyId,
} from '@/features/display/displayPreferences'

const ls = (key: string, fallback: string) => localStorage.getItem(`tianshu:${key}`) ?? fallback
const lsBool = (key: string, fallback: boolean) => { const v = localStorage.getItem(`tianshu:${key}`); return v === null ? fallback : v === 'true' }
const lsNum = (key: string, fallback: number) => { const v = localStorage.getItem(`tianshu:${key}`); return v === null ? fallback : Number(v) || fallback }
const saveLs = (key: string, value: string | boolean | number) => localStorage.setItem(`tianshu:${key}`, String(value))

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState('provider')
  const { providers, loading, load, update, remove, fetchModels } = useProvidersStore()
  const [loadingModels, setLoadingModels] = useState<Record<string, boolean>>({})
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; msg: string }>>({})
  const [testing, setTesting] = useState<Record<string, boolean>>({})
  const [showAddModal, setShowAddModal] = useState(false)
  const [editTarget, setEditTarget] = useState<Provider | null>(null)
  const [compactTarget, setCompactTarget] = useState<{ provider: Provider; modelId: string } | null>(null)
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null)

  // ── 显示设置 ──
  const t = useI18n()
  const locale = useI18nStore(s => s.locale)
  const setLocale = useI18nStore(s => s.setLocale)
  const [notify, setNotify] = useState(lsBool('notify', true))
  const [sound, setSound] = useState(lsBool('sound', false))
  const [displayPreferences, setDisplayPreferences] = useState(loadDisplayPreferences)
  const [textColorDraft, setTextColorDraft] = useState(() => loadDisplayPreferences().textColor)
  // ── 主题工作台 ──
  const [studioOpen, setStudioOpen] = useState(false)
  const [studioEditing, setStudioEditing] = useState<ThemeDefinition | undefined>(undefined)

  // ── 图标包编辑器 ──
  const [iconPackEditorOpen, setIconPackEditorOpen] = useState(false)
  const [iconPackEditorTarget, setIconPackEditorTarget] = useState<CustomIconPack | null>(null)
  const [iconPackEditorOverrides, setIconPackEditorOverrides] = useState(false)

  // ── 会话设置 ──
  const [workspace, setWorkspace] = useState(ls('defaultWorkspace', ''))
  const [compact, setCompact] = useState(lsBool('compact', false))
  const [showReasoning, setShowReasoning] = useState(lsBool('showReasoning', true))
  const [showCost, setShowCost] = useState(lsBool('showCost', false))
  const [defaultPrompt, setDefaultPrompt] = useState('')
  const [promptDirty, setPromptDirty] = useState(false)

  // ── 事件设置 ──
  const [blockEventInterrupt, setBlockEventInterrupt] = useState(lsBool('blockEventInterrupt', false))
  const [schedulerEnabled, setSchedulerEnabled] = useState(lsBool('schedulerEnabled', true))
  const [schedulerInterval, setSchedulerInterval] = useState(lsNum('schedulerInterval', 10))
  const [archiveHours, setArchiveHours] = useState(lsNum('archiveHours', 24))
  const [evo, setEvo] = useState<EvolutionConfig | null>(null)
  const [characters, setCharacters] = useState<Character[]>([])
  const [notifyEnabled, setNotifyEnabled] = useState(true)
  const [reloading, setReloading] = useState(false)
  const [reimporting, setReimporting] = useState(false)

  // ── token节省设置 ──
  const [rtkEnabled, setRtkEnabled] = useState(false)
  const [rtkAvailable, setRtkAvailable] = useState(false)
  const [rtkVersion, setRtkVersion] = useState('')
  const [rtkLatestVersion, setRtkLatestVersion] = useState('')
  const [rtkUpdateAvailable, setRtkUpdateAvailable] = useState(false)
  const [rtkBusy, setRtkBusy] = useState<null | 'install' | 'update'>(null)

  // ── 桌面客户端信息 ──
  const [serverStatus, setServerStatus] = useState<DesktopServerStatus | null>(null)

  useEffect(() => {
    const api = window.tianshuDesktop
    if (!api) return
    api.getServerStatus().then(setServerStatus).catch(() => {})
    const unsubscribe = api.onServerStatus(setServerStatus)
    return unsubscribe
  }, [])

  const serverStatusLabel = (s: DesktopServerStatus | null): string => {
    if (!s) return t('未知')
    switch (s.phase) {
      case 'starting': return t('正在启动本地服务…')
      case 'ready': return t('本地服务运行中（端口 {port}）', { port: s.port })
      case 'failed': return t('本地服务异常：{msg}', { msg: s.message })
      case 'stopping': return t('正在停止本地服务…')
      case 'stopped': return t('本地服务已停止')
    }
  }

  const handleChooseDir = async () => {
    const api = window.tianshuDesktop
    if (!api) {
      showToast(t('目录选择仅在桌面客户端中可用'), 'err')
      return
    }
    const dir = await api.openDirectoryDialog(workspace)
    if (dir) {
      setWorkspace(dir)
      saveLs('defaultWorkspace', dir)
      await saveDataspace(dir)
        .then(() => { window.dispatchEvent(new Event('dataspace-configured')) })
        .catch(() => {})
      showToast(t('已选择数据目录'))
    }
  }

  const handleOpenConfigFolder = async () => {
    const api = window.tianshuDesktop
    if (!api) {
      showToast(t('打开文件夹仅在桌面客户端中可用'), 'err')
      return
    }
    try {
      const ok = await api.openPath(workspace)
      if (!ok) showToast(t('配置目录不存在，请先刷新配置路径'), 'err')
    } catch {
      showToast(t('打开文件夹仅在桌面客户端中可用'), 'err')
    }
  }

  useEffect(() => {
    load()
    fetchDefaultPrompt().then(setDefaultPrompt).catch(() => {})
    fetchEvolutionConfig().then(setEvo).catch(() => {})
    fetchCharacters().then(setCharacters).catch(() => {})
    // 从后端加载配置路径
    fetchDataspace().then(res => { setWorkspace(res.dataDir); saveLs('defaultWorkspace', res.dataDir) }).catch(() => {})
    // 从后端加载 RTK 集成配置与服务端可用性
    fetchRtk().then(res => {
      setRtkEnabled(res.config.enabled)
      setRtkAvailable(res.available)
      setRtkVersion(res.version)
      setRtkLatestVersion(res.latestVersion)
      setRtkUpdateAvailable(res.updateAvailable)
    }).catch(() => {})
  }, [])

  const showToast = (msg: string, type: 'ok' | 'err' = 'ok') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }

  const handleToggleRtk = async () => {
    const next = !rtkEnabled
    setRtkEnabled(next)
    try {
      const saved = await saveRtk({ enabled: next })
      setRtkEnabled(saved.enabled)
      showToast(next ? t('RTK 已开启') : t('RTK 已关闭'))
    } catch {
      setRtkEnabled(!next)
      showToast(t('保存失败'), 'err')
    }
  }

  const refreshRtkStatus = () => {
    fetchRtk(true).then(res => {
      setRtkAvailable(res.available)
      setRtkVersion(res.version)
      setRtkLatestVersion(res.latestVersion)
      setRtkUpdateAvailable(res.updateAvailable)
    }).catch(() => {})
  }

  const handleInstallRtk = async () => {
    if (!window.confirm(t('即将安装 rtk（按当前系统选择官方安装方式：macOS 用 brew，Windows / Linux 下载官方预编译二进制）。是否继续？'))) return
    setRtkBusy('install')
    try {
      const res = await installRtk()
      if (res.ok) {
        showToast(t('RTK 安装成功'))
        refreshRtkStatus()
      } else {
        showToast(t('RTK 安装失败：{msg}', { msg: res.output.slice(0, 300) }), 'err')
      }
    } catch {
      showToast(t('RTK 安装失败'), 'err')
    } finally {
      setRtkBusy(null)
    }
  }

  const handleUpdateRtk = async () => {
    if (!window.confirm(t('即将把 rtk 更新到 {latest}。是否继续？', { latest: rtkLatestVersion }))) return
    setRtkBusy('update')
    try {
      const res = await updateRtk()
      if (res.ok) {
        showToast(t('RTK 更新成功'))
        refreshRtkStatus()
      } else {
        showToast(t('RTK 更新失败：{msg}', { msg: res.output.slice(0, 300) }), 'err')
      }
    } catch {
      showToast(t('RTK 更新失败'), 'err')
    } finally {
      setRtkBusy(null)
    }
  }

  const handleReloadDataspace = async () => {
    setReloading(true)
    try {
      await saveDataspace(workspace)
      await reloadDataspace()
      // 重新拉取所有后端数据，使新配置路径立即生效
      saveLs('defaultWorkspace', workspace)
      window.dispatchEvent(new Event('dataspace-configured'))
      await Promise.allSettled([
        load(),
        fetchDefaultPrompt().then(setDefaultPrompt),
        fetchEvolutionConfig().then(setEvo),
        fetchCharacters().then(setCharacters),
      ])
      showToast(t('已重新加载数据'))
    } catch (err: any) {
      showToast(`${t('加载失败')}: ${err.message || t('网络错误')}`, 'err')
    } finally {
      setReloading(false)
    }
  }

  const handleReimportBuiltin = async () => {
    if (!window.confirm(t('重新导入初始配置将恢复所有内置角色和技能到出厂版本，用户自建内容会保留。确定继续？'))) return
    setReimporting(true)
    try {
      const res = await reimportBuiltin()
      await Promise.allSettled([
        load(),
        fetchCharacters().then(setCharacters),
      ])
      const restored =
        (res.restoredCharacters?.length || 0) +
        (res.restoredSkills?.length || 0) +
        (res.restoredIconPacks?.length || 0) +
        (res.restoredProviders?.length || 0) +
        (res.restoredPrompts || 0)
      showToast(t('已恢复 {n} 项内置内容', { n: restored }))
    } catch (err: any) {
      showToast(`${t('恢复失败')}: ${err.message || t('网络错误')}`, 'err')
    } finally {
      setReimporting(false)
    }
  }

  const openStudio = (editing?: ThemeDefinition) => {
    setStudioEditing(editing)
    setStudioOpen(true)
  }

  const closeStudio = () => {
    setStudioOpen(false)
    setStudioEditing(undefined)
  }

  const openIconPackEditor = (pack: CustomIconPack | null, focusOverrides = false) => {
    setIconPackEditorTarget(pack)
    setIconPackEditorOverrides(focusOverrides)
    setIconPackEditorOpen(true)
  }

  const closeIconPackEditor = () => {
    setIconPackEditorOpen(false)
    setIconPackEditorTarget(null)
    setIconPackEditorOverrides(false)
  }

  const updateDisplayPreferences = (patch: Partial<DisplayPreferences>) => {
    const next = normalizeDisplayPreferences({ ...displayPreferences, ...patch })
    setDisplayPreferences(next)
    saveDisplayPreferences(next)
    applyDisplayPreferences(next)
    return next
  }

  const commitTextColor = () => {
    if (!isValidHexColor(textColorDraft)) {
      setTextColorDraft(displayPreferences.textColor)
      showToast(t('请输入 #RRGGBB 格式的颜色值'), 'err')
      return
    }
    const next = updateDisplayPreferences({ textColor: textColorDraft, textColorMode: 'custom' })
    setTextColorDraft(next.textColor)
  }

  const handleResetDisplayPreferences = () => {
    const defaults = resetDisplayPreferences()
    setDisplayPreferences(defaults)
    setTextColorDraft(defaults.textColor)
    showToast(t('显示设置已恢复默认'))
  }

  // ── Provider handlers ──
  const loadModels = async (providerId: string) => {
    setLoadingModels(prev => ({ ...prev, [providerId]: true }))
    try {
      await fetchModels(providerId)
      showToast(t('模型列表已刷新'))
    } catch (err: any) {
      showToast(`${t('获取模型失败')}: ${err.message || t('网络错误')}`, 'err')
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
      setTestResult(prev => ({ ...prev, [providerId]: { ok: false, msg: e.message || t('请求失败') } }))
    } finally {
      setTesting(prev => ({ ...prev, [providerId]: false }))
    }
  }

  const handleDelete = async (providerId: string) => {
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
    const parsed = parseContextOverride(raw)
    if (parsed == null) { showToast(t('上下文格式无效'), 'err'); return }
    const models = (provider.models || []).map((m: any) =>
      m.id === modelId ? { ...m, context_window: parsed, context_window_overridden: true } : m
    )
    try { await update(provider.id, { models }); showToast(t('已保存')) } catch { showToast(t('保存失败'), 'err') }
  }

  // ── 保存 handlers ──
  const handleSavePrompt = async () => {
    try { await saveDefaultPrompt(defaultPrompt); setPromptDirty(false); showToast(t('默认提示词已保存')) }
    catch { showToast(t('保存失败'), 'err') }
  }

  const handleSaveEvo = async () => {
    if (!evo) return
    try { await saveEvolutionConfig(evo); showToast(t('进化配置已保存')) }
    catch { showToast(t('保存失败'), 'err') }
  }

  const handleResetEvo = async () => {
    try { const r = await clearEvolutionConfig(); setEvo(r as any); showToast(t('已重置为默认值')) }
    catch { showToast(t('重置失败'), 'err') }
  }

  const handleClearEvo = async () => {
    try {
      await clearEvolutionConfig()
      setEvo({
        character_id: '', group_id: '', provider_id: '', model: '', workspace: '', content: '',
        detect_window: 8, error_rate_threshold: 0.5, repetition_count: 3,
        high_freq_min_calls: 6, high_freq_max_unique: 2, notify_enabled: true, notify_timeout: 2
      } as any)
      setNotifyEnabled(true)
      showToast(t('已清除配置'))
    } catch { showToast(t('清除失败'), 'err') }
  }

  const handleResetTriggerDefaults = () => {
    setEvo(prev => prev ? {
      ...prev,
      detect_window: 8,
      error_rate_threshold: 0.5,
      repetition_count: 3,
      high_freq_min_calls: 6,
      high_freq_max_unique: 2
    } : prev)
    showToast(t('触发条件已恢复默认值'))
  }

  const tabs = [
    { id: 'provider', icon: 'nav-mcp', label: t('模型服务') },
    { id: 'system', icon: 'nav-settings', label: t('系统') },
    { id: 'display', icon: 'palette', label: t('显示') },
    { id: 'session', icon: 'nav-chat', label: t('会话') },
    { id: 'tokensaving', icon: 'tool-bash', label: t('token节省') },
    { id: 'event', icon: 'nav-events', label: t('事件') },
    { id: 'about', icon: 'info', label: t('关于') },
  ]

  return (
    <div style={{flex:1,display:'flex',overflow:'hidden'}}>
      {/* 设置导航 */}
      <div className="settings-nav">
        <div className="settings-nav-header"><span className="settings-nav-title">设置</span></div>
        <div className="settings-nav-list">
              {tabs.map(tab => (
                <button
                  key={tab.id}
                  className={`settings-nav-item ${activeTab === tab.id ? 'active' : ''}`}
                  onClick={() => setActiveTab(tab.id)}
                >
                  <Icon name={tab.icon} size={15} ariaHidden />
                  {tab.label}
                </button>
              ))}
        </div>
      </div>

      {/* 设置内容 */}
      <div className="settings-content">

        {/* 模型服务 */}
        <div className="tab-page" style={{display: activeTab === 'provider' ? 'block' : 'none'}}>
          <div className="settings-section">
            <div className="section-title">{t('模型服务')}</div>
            <div className="section-desc">{t('配置 LLM 模型服务提供商，管理 API 密钥和可用模型。')}</div>

            {loading ? (
              <div style={{textAlign:'center',padding:'40px',color:'var(--ink-faint)'}}>{t('加载中...')}</div>
            ) : (
              providers.map(provider => (
                <div key={provider.id} className="provider-card">
                  <div className="provider-header">
                    <span className="provider-name">{provider.name}</span>
                    <span className={`provider-badge ${provider.is_builtin ? 'builtin' : 'custom'}`}>
                      {provider.is_builtin ? t('内置') : t('自定义')}
                    </span>
                    {testResult[provider.id] && (
                      <span style={{fontSize: 'calc(11px * var(--ui-font-scale))',color:testResult[provider.id].ok ? 'var(--jade)' : 'var(--cinnabar)',marginLeft:4}}>
                        {testResult[provider.id].msg}
                      </span>
                    )}
                    <button
                      className="btn sm"
                      onClick={() => handleTest(provider.id)}
                      disabled={testing[provider.id]}
                    >
                      {testing[provider.id] ? t('测试中...') : t('测试联通')}
                    </button>
                    <button 
                      className="btn sm" 
                      onClick={() => loadModels(provider.id)}
                      disabled={loadingModels[provider.id]}
                    >
                      {loadingModels[provider.id] ? t('加载中...') : t('刷新模型')}
                    </button>
                    <button className="btn sm" onClick={() => setEditTarget(provider)}>{t('编辑')}</button>
                    <button className="btn sm danger" onClick={() => handleDelete(provider.id)}>{t('删除')}</button>
                  </div>
                  <div className="provider-url">{provider.base_url}</div>
                  {provider.api_key && (
                    <div className="provider-key">
                      API Key: {'•'.repeat(Math.min(provider.api_key.length, 32))}
                    </div>
                  )}
                  <div className="model-list">
                    {provider.models?.map(model => {
                      const on = isModelEnabled(provider, model.id)
                      return (
                        <div key={model.id} className="model-item" onClick={() => toggleModel(provider, model.id)}>
                          <div className={`toggle ${on ? 'on' : ''}`} style={{flexShrink:0}} />
                          <span className="model-item-name">{model.name || model.id}</span>
                          <input
                            key={`ctx-${model.id}-${model.context_window}`}
                            type="text"
                            defaultValue={formatContext(model.context_window)}
                            placeholder={model.context_window ? undefined : t('上下文')}
                            onClick={e => e.stopPropagation()}
                            onChange={e => e.stopPropagation()}
                            onKeyDown={e => {
                              e.stopPropagation()
                              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                            }}
                            onBlur={e => handleContextOverride(provider, model.id, e.target.value)}
                            className="model-item-ctx-input"
                            title={t('上下文窗口（可手动覆盖，如 128k / 1m）')}
                            style={{width:52,marginLeft:6,fontSize:'calc(11px * var(--ui-font-scale))',padding:'1px 4px',textAlign:'right'}}
                          />
                          <select
                            value={(model as any).api_style || 'auto'}
                            onClick={e => e.stopPropagation()}
                            onChange={e => handleModelApiStyle(provider, model.id, e.target.value)}
                            className="io-select"
                            title={t('API 协议')}
                            style={{marginLeft:8,width:76,fontSize:'calc(11px * var(--ui-font-scale))',padding:'1px 2px'}}
                          >
                            <option value="auto">{t('自动')}</option>
                            <option value="chat_completions">Chat</option>
                            <option value="responses">Resp</option>
                          </select>
                          <button
                            onClick={e => { e.stopPropagation(); setCompactTarget({ provider, modelId: model.id }) }}
                            title={t('压缩策略')}
                            style={{marginLeft:8,background:'none',border:'none',cursor:'pointer',color:'var(--ink-light)',fontSize:'calc(13px * var(--ui-font-scale))',padding:'0 2px',flexShrink:0}}
                          >
                            ⚙
                          </button>
                          {(model as any).compact_threshold_ratio != null || (model as any).compact_retain_ratio != null || (model as any).compact_provider != null || (model as any).compact_model != null ? (
                            <span style={{width:6,height:6,borderRadius:3,background:'var(--jade)',marginLeft:6,flexShrink:0}} />
                          ) : null}
                        </div>
                      )
                    }) || (
                      <span style={{fontSize: 'calc(11px * var(--ui-font-scale))',color:'var(--ink-faint)'}}>
                        {t('点击"刷新模型"加载模型列表')}
                      </span>
                    )}
                  </div>
                </div>
              ))
            )}

            <button className="btn primary" style={{marginTop:8}} onClick={() => setShowAddModal(true)}>+ {t('添加服务')}</button>
          </div>
        </div>

        {/* 添加服务弹窗 */}
        {showAddModal && (
          <AddProviderDialog onClose={() => setShowAddModal(false)} />
        )}

        {/* 编辑服务弹窗 */}
        {editTarget && (
          <EditProviderDialog provider={editTarget} onClose={() => setEditTarget(null)} />
        )}

        {/* 压缩策略弹窗 */}
        {compactTarget && (
          <ModelCompactDialog provider={compactTarget.provider} modelId={compactTarget.modelId} onClose={() => setCompactTarget(null)} />
        )}

        {/* 系统 */}
        <div className="tab-page" style={{display: activeTab === 'system' ? 'block' : 'none'}}>
          <div className="settings-section">
            <div className="section-title">{t('系统')}</div>
            <div className="section-desc">{t('全局系统配置，影响所有会话和角色。')}</div>

            <div className="setting-row setting-row-stacked">
              <div className="setting-info"><span className="setting-label">{t('配置路径')}</span><span className="setting-hint">{t('天枢系统配置与数据的根目录')}</span></div>
              <div className="setting-control">
                <input type="text" value={workspace} onChange={e => { setWorkspace(e.target.value); saveLs('defaultWorkspace', e.target.value); saveDataspace(e.target.value).then(() => { window.dispatchEvent(new Event('dataspace-configured')) }).catch(() => {}) }} style={{width:280}}/>
                <button className="btn" onClick={handleChooseDir} style={{marginLeft:8}}>{t('选择目录')}</button>
                <button className="btn" onClick={handleReloadDataspace} disabled={reloading} style={{marginLeft:8}}>
                  {reloading ? t('加载中…') : t('刷新')}
                </button>
                <button className="btn" onClick={handleOpenConfigFolder} style={{marginLeft:8}}>{t('打开配置文件夹')}</button>
              </div>
            </div>

            <div className="setting-row">
              <div className="setting-info"><span className="setting-label">{t('重新导入初始配置')}</span><span className="setting-hint">{t('将内置角色和技能恢复到出厂版本（用户自建内容保留）')}</span></div>
              <div className="setting-control">
                <button className="btn danger" onClick={handleReimportBuiltin} disabled={reimporting} style={{marginLeft:8}}>
                  {reimporting ? t('恢复中…') : t('重新导入')}
                </button>
              </div>
            </div>
          </div>

          <div className="settings-section" style={{marginTop:32}}>
            <div className="section-title">{t('默认系统提示词')}</div>
            <div className="section-desc">{t('所有未自定义 prompt.md 的角色使用此模板。')}</div>
            <textarea rows={10} value={defaultPrompt} onChange={e => { setDefaultPrompt(e.target.value); setPromptDirty(true) }} />
            <div style={{marginTop:8,display:'flex',alignItems:'center',gap:8}}>
              <button className="btn primary" onClick={handleSavePrompt} disabled={!promptDirty}>{t('保存')}</button>
              {promptDirty && <span style={{fontSize: 'calc(11px * var(--ui-font-scale))',color:'var(--ink-faint)'}}>{t('未保存')}</span>}
            </div>
          </div>

          <SystemRunPolicySettings showToast={showToast} />
        </div>

        {/* 显示 */}
        <div className="tab-page" style={{display: activeTab === 'display' ? 'block' : 'none'}}>
          <div className="settings-section">
            <div className="section-title">{t('显示')}</div>
            <div className="section-desc">{t('界面显示与主题设置。')}</div>

            <div className="setting-row">
              <div className="setting-info"><span className="setting-label">{t('界面语言')}</span><span className="setting-hint">{t('选择界面显示语言')}</span></div>
              <div className="setting-control">
                <select value={locale} onChange={e => setLocale(e.target.value as Locale)}>
                  <option value="zh">{t('中文')}</option>
                  <option value="en">{t('English')}</option>
                </select>
              </div>
            </div>
            <ThemeSelector
              showToast={showToast}
              onOpenStudio={openStudio}
            />
            <IconPackSelector
              showToast={showToast}
              onOpenEditor={openIconPackEditor}
            />
            <div className="setting-row">
              <div className="setting-info"><span className="setting-label">{t('界面字体')}</span><span className="setting-hint">{t('应用到所有页面的普通界面文字')}</span></div>
              <div className="setting-control">
                <select
                  value={displayPreferences.fontFamily}
                  onChange={e => updateDisplayPreferences({ fontFamily: e.target.value as FontFamilyId })}
                  aria-label={t('界面字体')}
                >
                  <option value="wenkai">{t('霞鹜文楷')}</option>
                  <option value="system-sans">{t('系统黑体')}</option>
                  <option value="system-serif">{t('系统宋体')}</option>
                  <option value="monospace">{t('等宽字体')}</option>
                </select>
              </div>
            </div>
            <div className="setting-row">
              <div className="setting-info"><span className="setting-label">{t('字体大小')}</span><span className="setting-hint">{t('调整普通界面文字，图标和角色资源不缩放')}</span></div>
              <div className="setting-control font-size-control">
                <input
                  type="range"
                  min="80"
                  max="140"
                  step="5"
                  value={displayPreferences.fontScale}
                  onChange={e => updateDisplayPreferences({ fontScale: Number(e.target.value) })}
                  aria-label={t('字体大小')}
                />
                <output>{displayPreferences.fontScale}%</output>
              </div>
            </div>
            <div className="setting-row">
              <div className="setting-info"><span className="setting-label">{t('字体颜色')}</span><span className="setting-hint">{t('调整普通文字颜色，语义状态色保持不变；主题模式下由主题控制')}</span></div>
              <div className="setting-control font-color-control">
                <input
                  type="color"
                  value={displayPreferences.textColor}
                  onChange={e => {
                    setTextColorDraft(e.target.value)
                    updateDisplayPreferences({ textColor: e.target.value, textColorMode: 'custom' })
                  }}
                  aria-label={t('选择字体颜色')}
                />
                <input
                  className="font-color-hex"
                  type="text"
                  value={textColorDraft}
                  maxLength={7}
                  spellCheck={false}
                  onChange={e => setTextColorDraft(e.target.value)}
                  onBlur={commitTextColor}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      commitTextColor()
                    }
                  }}
                  aria-label={t('字体颜色十六进制值')}
                />
                {displayPreferences.textColorMode === 'custom' && isValidHexColor(displayPreferences.textColor) && (
                  <span className={`font-color-contrast ${textColorContrastOn(displayPreferences.textColor, document.documentElement.style.getPropertyValue('--theme-canvas') || '#f5f0e8') >= 4.5 ? 'pass' : 'fail'}`}>
                    {t('与当前背景对比度')} {textColorContrastOn(displayPreferences.textColor, document.documentElement.style.getPropertyValue('--theme-canvas') || '#f5f0e8').toFixed(1)}:1
                  </span>
                )}
                {displayPreferences.textColorMode === 'theme' && (
                  <button className="btn sm" type="button" onClick={() => updateDisplayPreferences({ textColorMode: 'custom' })}>
                    {t('自定义颜色')}
                  </button>
                )}
              </div>
            </div>
            <div className="display-preferences-preview" aria-live="polite">
              <div className="display-preview-text">天枢 TianShu · {t('让智能体拥有长期记忆')}</div>
              <div className="display-preview-meta">
                {t('当前字体')} · {displayPreferences.fontScale}% · {displayPreferences.textColor}
              </div>
              <button
                className="btn sm"
                type="button"
                onClick={handleResetDisplayPreferences}
                disabled={
                  displayPreferences.fontFamily === DEFAULT_DISPLAY_PREFERENCES.fontFamily
                  && displayPreferences.fontScale === DEFAULT_DISPLAY_PREFERENCES.fontScale
                  && displayPreferences.textColor === DEFAULT_DISPLAY_PREFERENCES.textColor
                }
              >
                {t('恢复默认显示设置')}
              </button>
            </div>
            <div className="setting-row">
              <div className="setting-info"><span className="setting-label">{t('消息通知')}</span><span className="setting-hint">{t('接收新消息与事件通知')}</span></div>
              <div className="setting-control"><div className={`toggle ${notify ? 'on' : ''}`} onClick={() => { setNotify(!notify); saveLs('notify', !notify) }} /></div>
            </div>
            <div className="setting-row">
              <div className="setting-info"><span className="setting-label">{t('声音提示')}</span><span className="setting-hint">{t('任务完成时播放提示音')}</span></div>
              <div className="setting-control"><div className={`toggle ${sound ? 'on' : ''}`} onClick={() => { setSound(!sound); saveLs('sound', !sound) }} /></div>
            </div>
          </div>
        </div>

        {/* 会话 */}
        <div className="tab-page" style={{display: activeTab === 'session' ? 'block' : 'none'}}>
          <div className="settings-section">
            <div className="section-title">{t('会话')}</div>
            <div className="section-desc">{t('会话显示偏好与交互设置。')}</div>

            <div className="setting-row">
              <div className="setting-info"><span className="setting-label">{t('紧凑模式')}</span><span className="setting-hint">{t('缩小消息间距，显示更多内容')}</span></div>
              <div className="setting-control"><div className={`toggle ${compact ? 'on' : ''}`} onClick={() => { setCompact(!compact); saveLs('compact', !compact) }} /></div>
            </div>
            <div className="setting-row">
              <div className="setting-info"><span className="setting-label">{t('显示推理')}</span><span className="setting-hint">{t('展示模型的思考过程')}</span></div>
              <div className="setting-control"><div className={`toggle ${showReasoning ? 'on' : ''}`} onClick={() => { setShowReasoning(!showReasoning); saveLs('showReasoning', !showReasoning) }} /></div>
            </div>
            <div className="setting-row">
              <div className="setting-info"><span className="setting-label">{t('显示消耗')}</span><span className="setting-hint">{t('在消息中显示 token 消耗')}</span></div>
              <div className="setting-control"><div className={`toggle ${showCost ? 'on' : ''}`} onClick={() => { setShowCost(!showCost); saveLs('showCost', !showCost) }} /></div>
            </div>
          </div>
        </div>

        {/* token节省 */}
        <div className="tab-page" style={{ display: activeTab === 'tokensaving' ? 'block' : 'none' }}>
          <div className="settings-section">
            <div className="section-title">{t('token节省')}</div>
            <div className="section-desc">{t('压缩 agent 输入与命令输出，降低 token 消耗。')}</div>

            <div className="setting-row">
              <div className="setting-info">
                <span className="setting-label">{t('RTK 开关')}</span>
                <span className="setting-hint">{t('开启后所有 bash / pwsh 命令经 rtk 压缩输出，节省 token。')}</span>
              </div>
              <div className="setting-control">
                <div className={`toggle ${rtkEnabled ? 'on' : ''}`} onClick={handleToggleRtk} />
              </div>
            </div>

            {!rtkAvailable ? (
              <div className="setting-hint" style={{ color: 'var(--cinnabar)' }}>
                <span>{t('RTK 未安装。')}</span>
                <button className="btn sm" disabled={rtkBusy !== null} onClick={handleInstallRtk} style={{ marginLeft: 8 }}>
                  {rtkBusy === 'install' ? t('安装中…') : t('一键安装 rtk')}
                </button>
              </div>
            ) : (
              <div className="setting-hint" style={{ color: 'var(--jade)' }}>
                <span>{t('RTK 已启用（{version}）', { version: rtkVersion || '—' })}</span>
                {rtkUpdateAvailable ? (
                  <button className="btn sm" disabled={rtkBusy !== null} onClick={handleUpdateRtk} style={{ marginLeft: 8 }}>
                    {rtkBusy === 'update' ? t('更新中…') : t('更新到 {latest}', { latest: rtkLatestVersion })}
                  </button>
                ) : (
                  <button className="btn sm" disabled={rtkBusy !== null} onClick={refreshRtkStatus} style={{ marginLeft: 8 }}>
                    {t('检查更新')}
                  </button>
                )}
                {!rtkUpdateAvailable && rtkLatestVersion && <span style={{ marginLeft: 6 }}>· {t('已是最新')}</span>}
              </div>
            )}
          </div>
        </div>

        {/* 事件 */}
        <div className="tab-page" style={{display: activeTab === 'event' ? 'block' : 'none'}}>
          <div className="settings-section">
            <div className="section-title">{t('事件')}</div>
            <div className="section-desc">{t('事件引擎与进化引擎配置。')}</div>

            <div className="setting-group">
              <div className="setting-group-title">{t('事件引擎')}</div>
              <div className="setting-row">
                <div className="setting-info"><span className="setting-label">{t('阻止事件中断')}</span><span className="setting-hint">{t('事件执行期间禁止用户打断')}</span></div>
                <div className="setting-control"><div className={`toggle ${blockEventInterrupt ? 'on' : ''}`} onClick={() => { setBlockEventInterrupt(!blockEventInterrupt); saveLs('blockEventInterrupt', !blockEventInterrupt) }} /></div>
              </div>
              <div className="setting-row">
                <div className="setting-info"><span className="setting-label">{t('调度间隔')}</span><span className="setting-hint">{t('事件调度器检查间隔（秒）')}</span></div>
                <div className="setting-control"><input type="number" value={schedulerInterval} onChange={e => { setSchedulerInterval(Number(e.target.value)); saveLs('schedulerInterval', Number(e.target.value)) }} style={{width:60}}/> {t('秒')}</div>
              </div>
              <div className="setting-row">
                <div className="setting-info"><span className="setting-label">{t('归档时间')}</span><span className="setting-hint">{t('已完成事件保留时长')}</span></div>
                <div className="setting-control"><input type="number" value={archiveHours} onChange={e => { setArchiveHours(Number(e.target.value)); saveLs('archiveHours', Number(e.target.value)) }} style={{width:60}}/> {t('小时')}</div>
              </div>
            </div>

            <div className="setting-group">
              <div className="setting-group-title">{t('进化引擎')} <span style={{fontSize: 'calc(11px * var(--ui-font-scale))',fontWeight:400,color:'var(--ink-faint)'}}>{t('在线洞察检测 + 离线 LCS 聚类')}</span></div>
              <div className="setting-row">
                <div className="setting-info"><span className="setting-label">{t('进化角色')}</span><span className="setting-hint">{t('用于技能生成的 Agent 角色')}</span></div>
                <div className="setting-control">
                  <select value={evo?.character_id || ''} onChange={e => setEvo(prev => prev ? {...prev, character_id: e.target.value} : prev)}>
                    <option value="">{t('无')}</option>
                    {characters.map(ch => <option key={ch.id} value={ch.id}>{ch.name} ({ch.id})</option>)}
                  </select>
                </div>
              </div>
              {evo?.character_id && (characters.find(c => c.id === evo.character_id)?.groups?.length ?? 0) > 0 && (
                <div className="setting-row">
                  <div className="setting-info"><span className="setting-label">{t('进化分组')}</span><span className="setting-hint">{t('用于技能生成的分组')}</span></div>
                  <div className="setting-control">
                    <select value={evo?.group_id || ''} onChange={e => setEvo(prev => prev ? {...prev, group_id: e.target.value} : prev)}>
                      <option value="">{t('无')}</option>
                      {characters.find(c => c.id === evo?.character_id)?.groups?.filter(g => g.trim()).map(g => <option key={g} value={g}>{g}</option>)}
                    </select>
                  </div>
                </div>
              )}
              <div className="setting-row">
                <div className="setting-info"><span className="setting-label">{t('进化模型服务')}</span><span className="setting-hint">{t('技能生成使用的模型服务')}</span></div>
                <div className="setting-control">
                  <select value={evo?.provider_id || ''} onChange={e => setEvo(prev => prev ? {...prev, provider_id: e.target.value, model: ''} : prev)}>
                    <option value="">{t('无')}</option>
                    {providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="setting-row">
                <div className="setting-info"><span className="setting-label">{t('进化模型')}</span><span className="setting-hint">{t('技能生成使用的模型')}</span></div>
                <div className="setting-control">
                  <select value={evo?.model || ''} onChange={e => setEvo(prev => prev ? {...prev, model: e.target.value} : prev)} disabled={!evo?.provider_id}>
                    <option value="">{t('无')}</option>
                    {providers.find(p => p.id === evo?.provider_id)?.models?.filter((m: any) => m.enabled !== false).map(m => <option key={m.id} value={m.id}>{m.name || m.id}</option>)}
                  </select>
                </div>
              </div>
              <div className="setting-row">
                <div className="setting-info"><span className="setting-label">{t('进化工作区')}</span><span className="setting-hint">{t('技能生成使用的代码工作区')}</span></div>
                <div className="setting-control"><input type="text" value={evo?.workspace || ''} onChange={e => setEvo(prev => prev ? {...prev, workspace: e.target.value} : prev)} style={{width:280}}/></div>
              </div>
              <div className="setting-row" style={{alignItems:'flex-start'}}>
                <div className="setting-info"><span className="setting-label">{t('进化内容')}</span><span className="setting-hint">{t('自定义进化提示词')}</span></div>
                <div className="setting-control"><textarea value={evo?.content || ''} onChange={e => setEvo(prev => prev ? {...prev, content: e.target.value} : prev)} rows={3} style={{width:280,resize:'vertical'}}/></div>
              </div>
            </div>

            <div className="setting-group">
              <div className="setting-group-title">
                {t('触发条件（任一条件满足触发）')}
                <button className="btn sm" style={{marginLeft:12}} onClick={handleResetTriggerDefaults}>{t('恢复默认值')}</button>
              </div>
              <div className="detect-table">
                <div className="detect-row">
                  <span className="detect-type">{t('自我修正')}（self_correction）</span>
                  <span className="detect-condition">
                    {t('近')} <input type="number" className="detect-input" value={evo?.detect_window ?? 8} onChange={e => setEvo(prev => prev ? {...prev, detect_window: Number(e.target.value)} : prev)} min={2} max={50} /> {t('次调用错误率')} &gt; <input type="number" className="detect-input" value={evo?.error_rate_threshold ?? 0.5} onChange={e => setEvo(prev => prev ? {...prev, error_rate_threshold: Number(e.target.value)} : prev)} min={0.1} max={1} step={0.05} />
                  </span>
                  <span className="detect-desc">{t('发现 agent 在试错/探索')}</span>
                </div>
                <div className="detect-row">
                  <span className="detect-type">{t('重复模式')}（repeated_pattern）</span>
                  <span className="detect-condition">
                    {t('同一工具序列重复')} <input type="number" className="detect-input" value={evo?.repetition_count ?? 3} onChange={e => setEvo(prev => prev ? {...prev, repetition_count: Number(e.target.value)} : prev)} min={2} max={20} />+ {t('次')}
                  </span>
                  <span className="detect-desc">{t('发现死循环或固化模式')}</span>
                </div>
                <div className="detect-row">
                  <span className="detect-type">{t('高频使用')}（high_frequency）</span>
                  <span className="detect-condition">
                    <input type="number" className="detect-input" value={evo?.high_freq_min_calls ?? 6} onChange={e => setEvo(prev => prev ? {...prev, high_freq_min_calls: Number(e.target.value)} : prev)} min={3} max={50} />+ {t('次调用中仅用')} 1-<input type="number" className="detect-input" value={evo?.high_freq_max_unique ?? 2} onChange={e => setEvo(prev => prev ? {...prev, high_freq_max_unique: Number(e.target.value)} : prev)} min={1} max={10} /> {t('种工具')}
                  </span>
                  <span className="detect-desc">{t('发现工具使用过于集中')}</span>
                </div>
              </div>
            </div>

            <div className="setting-group">
              <div className="setting-group-title">{t('通知')}</div>
              <div className="setting-row">
                <div className="setting-info"><span className="setting-label">{t('创建进化时提醒')}</span><span className="setting-hint">{t('检测到进化信号创建事件时右下角弹提示')}</span></div>
                <div className="setting-control"><div className={`toggle ${notifyEnabled ? 'on' : ''}`} onClick={() => { setNotifyEnabled(!notifyEnabled); setEvo(prev => prev ? {...prev, notify_enabled: !notifyEnabled} : prev) }} /></div>
              </div>
              <div className="setting-row">
                <div className="setting-info"><span className="setting-label">{t('提示消失时间')}</span><span className="setting-hint">{t('通知自动消失的时间')}</span></div>
                <div className="setting-control"><input type="number" value={evo?.notify_timeout ?? 2} onChange={e => setEvo(prev => prev ? {...prev, notify_timeout: Number(e.target.value)} : prev)} style={{width:60}}/> {t('秒')}</div>
              </div>
            </div>

            <div style={{display:'flex',gap:8,marginTop:12}}>
              <button className="btn primary" onClick={handleSaveEvo}>{t('保存进化配置')}</button>
              <button className="btn" onClick={handleResetEvo}>{t('重置默认值')}</button>
              <button className="btn danger" onClick={handleClearEvo}>{t('清除')}</button>
            </div>
          </div>
        </div>

        {/* 关于 */}
        <div className="tab-page" style={{display: activeTab === 'about' ? 'block' : 'none'}}>
          <UpdatePanel />
          <div className="settings-section" style={{marginTop:32}}>
            <div className="setting-row">
              <div className="setting-info"><span className="setting-label">{t('本地服务')}</span></div>
              <div className="setting-control"><span style={{fontSize: 'calc(13px * var(--ui-font-scale))',color:'var(--ink-mid)'}}>{serverStatusLabel(serverStatus)}</span></div>
            </div>
          </div>
        </div>

      </div>

      {/* 主题工作台 */}
      {studioOpen && (
        <ThemeStudio
          editing={studioEditing}
          onClose={closeStudio}
          onSaved={(theme) => {
            closeStudio()
            // 保存成功后应用新版本（服务端 API 成功返回后才更新当前选择）
            setThemeSelection(
              loadThemePreferences(),
              { mode: 'custom', themeId: theme.id },
              { customThemes: [theme] },
            )
            showToast(t('主题已应用'))
          }}
          showToast={showToast}
        />
      )}

      {/* 图标包编辑器 */}
      {iconPackEditorOpen && (
        <IconPackEditor
          pack={iconPackEditorTarget}
          focusOverrides={iconPackEditorOverrides}
          onClose={closeIconPackEditor}
          onSaved={() => { /* 选择器自行刷新；无需额外动作 */ }}
          showToast={showToast}
        />
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          position:'fixed', bottom:24, left:'50%', transform:'translateX(-50%)',
          padding:'8px 20px', borderRadius:8, fontSize: 'calc(13px * var(--ui-font-scale))', zIndex:999,
          background: toast.type === 'ok' ? 'var(--jade)' : 'var(--cinnabar)',
          color:'var(--theme-text-on-accent)', boxShadow:'0 4px 12px var(--theme-shadow)',
        }}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}
