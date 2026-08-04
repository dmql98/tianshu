import { useState, useEffect } from 'react'
import { useProvidersStore } from '@/stores/providersStore'
import { testProvider } from '@/api/providers'
import { fetchDefaultPrompt, saveDefaultPrompt } from '@/api/prompts'
import { fetchDataspace, saveDataspace } from '@/api/config'
import { fetchEvolutionConfig, saveEvolutionConfig, clearEvolutionConfig, type EvolutionConfig } from '@/api/evolution'
import { fetchCharacters } from '@/api/characters'
import type { Provider, Character } from '@/types'
import AddProviderDialog from '@/components/AddProviderDialog'
import EditProviderDialog from '@/components/EditProviderDialog'

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
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null)

  // ── 显示设置 ──
  const [lang, setLang] = useState(ls('lang', 'zh'))
  const [theme, setTheme] = useState(ls('theme', 'light'))
  const [notify, setNotify] = useState(lsBool('notify', true))
  const [sound, setSound] = useState(lsBool('sound', false))

  // ── 会话设置 ──
  const [workspace, setWorkspace] = useState(ls('defaultWorkspace', 'C:\\.Tianshu'))
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

  useEffect(() => {
    load()
    fetchDefaultPrompt().then(setDefaultPrompt).catch(() => {})
    fetchEvolutionConfig().then(setEvo).catch(() => {})
    fetchCharacters().then(setCharacters).catch(() => {})
    // 从后端加载配置路径
    fetchDataspace().then(res => { setWorkspace(res.dataDir); saveLs('defaultWorkspace', res.dataDir) }).catch(() => {})
    // 应用主题
    const t = ls('theme', 'light')
    applyTheme(t)
  }, [])

  const showToast = (msg: string, type: 'ok' | 'err' = 'ok') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }

  const applyTheme = (t: string) => {
    let theme = t
    if (t === 'system') {
      theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }
    document.documentElement.setAttribute('data-theme', theme)
  }

  // ── Provider handlers ──
  const loadModels = async (providerId: string) => {
    setLoadingModels(prev => ({ ...prev, [providerId]: true }))
    try {
      await fetchModels(providerId)
      showToast('模型列表已刷新')
    } catch (err: any) {
      showToast(`获取模型失败: ${err.message || '网络错误'}`, 'err')
    } finally {
      setLoadingModels(prev => ({ ...prev, [providerId]: false }))
    }
  }

  const handleTest = async (providerId: string) => {
    setTesting(prev => ({ ...prev, [providerId]: true }))
    setTestResult(prev => ({ ...prev, [providerId]: { ok: false, msg: '测试中...' } }))
    try {
      const res = await testProvider(providerId)
      setTestResult(prev => ({
        ...prev,
        [providerId]: res.ok
          ? { ok: true, msg: `连通 (${res.status})` }
          : { ok: false, msg: res.error || '连接失败' },
      }))
    } catch (e: any) {
      setTestResult(prev => ({ ...prev, [providerId]: { ok: false, msg: e.message || '请求失败' } }))
    } finally {
      setTesting(prev => ({ ...prev, [providerId]: false }))
    }
  }

  const handleDelete = async (providerId: string) => {
    try { await remove(providerId); showToast('已删除') } catch { showToast('删除失败', 'err') }
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

  // ── 保存 handlers ──
  const handleSavePrompt = async () => {
    try { await saveDefaultPrompt(defaultPrompt); setPromptDirty(false); showToast('默认提示词已保存') }
    catch { showToast('保存失败', 'err') }
  }

  const handleSaveEvo = async () => {
    if (!evo) return
    try { await saveEvolutionConfig(evo); showToast('进化配置已保存') }
    catch { showToast('保存失败', 'err') }
  }

  const handleResetEvo = async () => {
    try { const r = await clearEvolutionConfig(); setEvo(r as any); showToast('已重置为默认值') }
    catch { showToast('重置失败', 'err') }
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
      showToast('已清除配置')
    } catch { showToast('清除失败', 'err') }
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
    showToast('触发条件已恢复默认值')
  }

  const tabs = [
    { id: 'provider', label: '🔗 模型服务' },
    { id: 'system', label: '⚙️ 系统' },
    { id: 'display', label: '🎨 显示' },
    { id: 'session', label: '💬 会话' },
    { id: 'event', label: '⚡ 事件' },
    { id: 'about', label: 'ℹ️ 关于' },
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
            <div className="section-title">模型服务</div>
            <div className="section-desc">配置 LLM 模型服务提供商，管理 API 密钥和可用模型。</div>

            {loading ? (
              <div style={{textAlign:'center',padding:'40px',color:'var(--ink-faint)'}}>加载中...</div>
            ) : (
              providers.map(provider => (
                <div key={provider.id} className="provider-card">
                  <div className="provider-header">
                    <span className="provider-name">{provider.name}</span>
                    <span className={`provider-badge ${provider.is_builtin ? 'builtin' : 'custom'}`}>
                      {provider.is_builtin ? '内置' : '自定义'}
                    </span>
                    {testResult[provider.id] && (
                      <span style={{fontSize:11,color:testResult[provider.id].ok ? 'var(--jade)' : 'var(--cinnabar)',marginLeft:4}}>
                        {testResult[provider.id].msg}
                      </span>
                    )}
                    <button
                      className="btn sm"
                      onClick={() => handleTest(provider.id)}
                      disabled={testing[provider.id]}
                    >
                      {testing[provider.id] ? '测试中...' : '测试联通'}
                    </button>
                    <button 
                      className="btn sm" 
                      onClick={() => loadModels(provider.id)}
                      disabled={loadingModels[provider.id]}
                    >
                      {loadingModels[provider.id] ? '加载中...' : '刷新模型'}
                    </button>
                    <button className="btn sm" onClick={() => setEditTarget(provider)}>编辑</button>
                    <button className="btn sm danger" onClick={() => handleDelete(provider.id)}>删除</button>
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
                          {model.context_window && (
                            <span className="model-item-ctx">{Math.round(model.context_window / 1000)}k</span>
                          )}
                        </div>
                      )
                    }) || (
                      <span style={{fontSize:11,color:'var(--ink-faint)'}}>
                        点击"刷新模型"加载模型列表
                      </span>
                    )}
                  </div>
                </div>
              ))
            )}

            <button className="btn primary" style={{marginTop:8}} onClick={() => setShowAddModal(true)}>+ 添加服务</button>
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

        {/* 系统 */}
        <div className="tab-page" style={{display: activeTab === 'system' ? 'block' : 'none'}}>
          <div className="settings-section">
            <div className="section-title">系统</div>
            <div className="section-desc">全局系统配置，影响所有会话和角色。</div>

            <div className="setting-row">
              <div className="setting-info"><span className="setting-label">配置路径</span><span className="setting-hint">天枢系统配置与数据的根目录</span></div>
              <div className="setting-control"><input type="text" value={workspace} onChange={e => { setWorkspace(e.target.value); saveLs('defaultWorkspace', e.target.value); saveDataspace(e.target.value).then(() => { window.dispatchEvent(new Event('dataspace-configured')) }).catch(() => {}) }} style={{width:280}}/></div>
            </div>
          </div>

          <div className="settings-section" style={{marginTop:32}}>
            <div className="section-title">默认系统提示词</div>
            <div className="section-desc">所有未自定义 prompt.md 的角色使用此模板。</div>
            <textarea rows={10} value={defaultPrompt} onChange={e => { setDefaultPrompt(e.target.value); setPromptDirty(true) }} />
            <div style={{marginTop:8,display:'flex',alignItems:'center',gap:8}}>
              <button className="btn primary" onClick={handleSavePrompt} disabled={!promptDirty}>保存</button>
              {promptDirty && <span style={{fontSize:11,color:'var(--ink-faint)'}}>未保存</span>}
            </div>
          </div>
        </div>

        {/* 显示 */}
        <div className="tab-page" style={{display: activeTab === 'display' ? 'block' : 'none'}}>
          <div className="settings-section">
            <div className="section-title">显示</div>
            <div className="section-desc">界面显示与主题设置。</div>

            <div className="setting-row">
              <div className="setting-info"><span className="setting-label">界面语言</span><span className="setting-hint">选择界面显示语言</span></div>
              <div className="setting-control">
                <select value={lang} onChange={e => { setLang(e.target.value); saveLs('lang', e.target.value) }}>
                  <option value="zh">中文</option>
                  <option value="en">English</option>
                </select>
              </div>
            </div>
            <div className="setting-row">
              <div className="setting-info"><span className="setting-label">主题</span><span className="setting-hint">界面显示主题</span></div>
              <div className="setting-control">
                <select value={theme} onChange={e => { setTheme(e.target.value); saveLs('theme', e.target.value); applyTheme(e.target.value) }}>
                  <option value="light">浅色</option>
                  <option value="dark">深色</option>
                  <option value="system">跟随系统</option>
                </select>
              </div>
            </div>
            <div className="setting-row">
              <div className="setting-info"><span className="setting-label">消息通知</span><span className="setting-hint">接收新消息与事件通知</span></div>
              <div className="setting-control"><div className={`toggle ${notify ? 'on' : ''}`} onClick={() => { setNotify(!notify); saveLs('notify', !notify) }} /></div>
            </div>
            <div className="setting-row">
              <div className="setting-info"><span className="setting-label">声音提示</span><span className="setting-hint">任务完成时播放提示音</span></div>
              <div className="setting-control"><div className={`toggle ${sound ? 'on' : ''}`} onClick={() => { setSound(!sound); saveLs('sound', !sound) }} /></div>
            </div>
          </div>
        </div>

        {/* 会话 */}
        <div className="tab-page" style={{display: activeTab === 'session' ? 'block' : 'none'}}>
          <div className="settings-section">
            <div className="section-title">会话</div>
            <div className="section-desc">会话显示偏好与交互设置。</div>

            <div className="setting-row">
              <div className="setting-info"><span className="setting-label">紧凑模式</span><span className="setting-hint">缩小消息间距，显示更多内容</span></div>
              <div className="setting-control"><div className={`toggle ${compact ? 'on' : ''}`} onClick={() => { setCompact(!compact); saveLs('compact', !compact) }} /></div>
            </div>
            <div className="setting-row">
              <div className="setting-info"><span className="setting-label">显示推理</span><span className="setting-hint">展示模型的思考过程</span></div>
              <div className="setting-control"><div className={`toggle ${showReasoning ? 'on' : ''}`} onClick={() => { setShowReasoning(!showReasoning); saveLs('showReasoning', !showReasoning) }} /></div>
            </div>
            <div className="setting-row">
              <div className="setting-info"><span className="setting-label">显示消耗</span><span className="setting-hint">在消息中显示 token 消耗</span></div>
              <div className="setting-control"><div className={`toggle ${showCost ? 'on' : ''}`} onClick={() => { setShowCost(!showCost); saveLs('showCost', !showCost) }} /></div>
            </div>
          </div>
        </div>

        {/* 事件 */}
        <div className="tab-page" style={{display: activeTab === 'event' ? 'block' : 'none'}}>
          <div className="settings-section">
            <div className="section-title">事件</div>
            <div className="section-desc">事件引擎与进化引擎配置。</div>

            <div className="setting-group">
              <div className="setting-group-title">事件引擎</div>
              <div className="setting-row">
                <div className="setting-info"><span className="setting-label">阻止事件中断</span><span className="setting-hint">事件执行期间禁止用户打断</span></div>
                <div className="setting-control"><div className={`toggle ${blockEventInterrupt ? 'on' : ''}`} onClick={() => { setBlockEventInterrupt(!blockEventInterrupt); saveLs('blockEventInterrupt', !blockEventInterrupt) }} /></div>
              </div>
              <div className="setting-row">
                <div className="setting-info"><span className="setting-label">调度间隔</span><span className="setting-hint">事件调度器检查间隔（秒）</span></div>
                <div className="setting-control"><input type="number" value={schedulerInterval} onChange={e => { setSchedulerInterval(Number(e.target.value)); saveLs('schedulerInterval', Number(e.target.value)) }} style={{width:60}}/> 秒</div>
              </div>
              <div className="setting-row">
                <div className="setting-info"><span className="setting-label">归档时间</span><span className="setting-hint">已完成事件保留时长</span></div>
                <div className="setting-control"><input type="number" value={archiveHours} onChange={e => { setArchiveHours(Number(e.target.value)); saveLs('archiveHours', Number(e.target.value)) }} style={{width:60}}/> 小时</div>
              </div>
            </div>

            <div className="setting-group">
              <div className="setting-group-title">进化引擎 <span style={{fontSize:11,fontWeight:400,color:'var(--ink-faint)'}}>在线洞察检测 + 离线 LCS 聚类</span></div>
              <div className="setting-row">
                <div className="setting-info"><span className="setting-label">进化角色</span><span className="setting-hint">用于技能生成的 Agent 角色</span></div>
                <div className="setting-control">
                  <select value={evo?.character_id || ''} onChange={e => setEvo(prev => prev ? {...prev, character_id: e.target.value} : prev)}>
                    <option value="">无</option>
                    {characters.map(ch => <option key={ch.id} value={ch.id}>{ch.name} ({ch.id})</option>)}
                  </select>
                </div>
              </div>
              {evo?.character_id && (characters.find(c => c.id === evo.character_id)?.groups?.length ?? 0) > 0 && (
                <div className="setting-row">
                  <div className="setting-info"><span className="setting-label">进化分组</span><span className="setting-hint">用于技能生成的分组</span></div>
                  <div className="setting-control">
                    <select value={evo?.group_id || ''} onChange={e => setEvo(prev => prev ? {...prev, group_id: e.target.value} : prev)}>
                      <option value="">无</option>
                      {characters.find(c => c.id === evo?.character_id)?.groups?.filter(g => g.trim()).map(g => <option key={g} value={g}>{g}</option>)}
                    </select>
                  </div>
                </div>
              )}
              <div className="setting-row">
                <div className="setting-info"><span className="setting-label">进化模型服务</span><span className="setting-hint">技能生成使用的模型服务</span></div>
                <div className="setting-control">
                  <select value={evo?.provider_id || ''} onChange={e => setEvo(prev => prev ? {...prev, provider_id: e.target.value, model: ''} : prev)}>
                    <option value="">无</option>
                    {providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="setting-row">
                <div className="setting-info"><span className="setting-label">进化模型</span><span className="setting-hint">技能生成使用的模型</span></div>
                <div className="setting-control">
                  <select value={evo?.model || ''} onChange={e => setEvo(prev => prev ? {...prev, model: e.target.value} : prev)} disabled={!evo?.provider_id}>
                    <option value="">无</option>
                    {providers.find(p => p.id === evo?.provider_id)?.models?.filter((m: any) => m.enabled !== false).map(m => <option key={m.id} value={m.id}>{m.name || m.id}</option>)}
                  </select>
                </div>
              </div>
              <div className="setting-row">
                <div className="setting-info"><span className="setting-label">进化工作区</span><span className="setting-hint">技能生成使用的代码工作区</span></div>
                <div className="setting-control"><input type="text" value={evo?.workspace || ''} onChange={e => setEvo(prev => prev ? {...prev, workspace: e.target.value} : prev)} style={{width:280}}/></div>
              </div>
              <div className="setting-row" style={{alignItems:'flex-start'}}>
                <div className="setting-info"><span className="setting-label">进化内容</span><span className="setting-hint">自定义进化提示词</span></div>
                <div className="setting-control"><textarea value={evo?.content || ''} onChange={e => setEvo(prev => prev ? {...prev, content: e.target.value} : prev)} rows={3} style={{width:280,resize:'vertical'}}/></div>
              </div>
            </div>

            <div className="setting-group">
              <div className="setting-group-title">
                触发条件（任一条件满足触发）
                <button className="btn sm" style={{marginLeft:12}} onClick={handleResetTriggerDefaults}>恢复默认值</button>
              </div>
              <div className="detect-table">
                <div className="detect-row">
                  <span className="detect-type">自我修正（self_correction）</span>
                  <span className="detect-condition">
                    近 <input type="number" className="detect-input" value={evo?.detect_window ?? 8} onChange={e => setEvo(prev => prev ? {...prev, detect_window: Number(e.target.value)} : prev)} min={2} max={50} /> 次调用错误率 &gt; <input type="number" className="detect-input" value={evo?.error_rate_threshold ?? 0.5} onChange={e => setEvo(prev => prev ? {...prev, error_rate_threshold: Number(e.target.value)} : prev)} min={0.1} max={1} step={0.05} />
                  </span>
                  <span className="detect-desc">发现 agent 在试错/探索</span>
                </div>
                <div className="detect-row">
                  <span className="detect-type">重复模式（repeated_pattern）</span>
                  <span className="detect-condition">
                    同一工具序列重复 <input type="number" className="detect-input" value={evo?.repetition_count ?? 3} onChange={e => setEvo(prev => prev ? {...prev, repetition_count: Number(e.target.value)} : prev)} min={2} max={20} />+ 次
                  </span>
                  <span className="detect-desc">发现死循环或固化模式</span>
                </div>
                <div className="detect-row">
                  <span className="detect-type">高频使用（high_frequency）</span>
                  <span className="detect-condition">
                    <input type="number" className="detect-input" value={evo?.high_freq_min_calls ?? 6} onChange={e => setEvo(prev => prev ? {...prev, high_freq_min_calls: Number(e.target.value)} : prev)} min={3} max={50} />+ 次调用中仅用 1-<input type="number" className="detect-input" value={evo?.high_freq_max_unique ?? 2} onChange={e => setEvo(prev => prev ? {...prev, high_freq_max_unique: Number(e.target.value)} : prev)} min={1} max={10} /> 种工具
                  </span>
                  <span className="detect-desc">发现工具使用过于集中</span>
                </div>
              </div>
            </div>

            <div className="setting-group">
              <div className="setting-group-title">通知</div>
              <div className="setting-row">
                <div className="setting-info"><span className="setting-label">创建进化时提醒</span><span className="setting-hint">检测到进化信号创建事件时右下角弹提示</span></div>
                <div className="setting-control"><div className={`toggle ${notifyEnabled ? 'on' : ''}`} onClick={() => { setNotifyEnabled(!notifyEnabled); setEvo(prev => prev ? {...prev, notify_enabled: !notifyEnabled} : prev) }} /></div>
              </div>
              <div className="setting-row">
                <div className="setting-info"><span className="setting-label">提示消失时间</span><span className="setting-hint">通知自动消失的时间</span></div>
                <div className="setting-control"><input type="number" value={evo?.notify_timeout ?? 2} onChange={e => setEvo(prev => prev ? {...prev, notify_timeout: Number(e.target.value)} : prev)} style={{width:60}}/> 秒</div>
              </div>
            </div>

            <div style={{display:'flex',gap:8,marginTop:12}}>
              <button className="btn primary" onClick={handleSaveEvo}>保存进化配置</button>
              <button className="btn" onClick={handleResetEvo}>重置默认值</button>
              <button className="btn danger" onClick={handleClearEvo}>清除</button>
            </div>
          </div>
        </div>

        {/* 关于 */}
        <div className="tab-page" style={{display: activeTab === 'about' ? 'block' : 'none'}}>
          <div className="settings-section">
            <div className="section-title">关于</div>
            <div className="setting-row">
              <div className="setting-info"><span className="setting-label">天枢版本</span></div>
              <div className="setting-control"><span style={{fontSize:13,color:'var(--ink-mid)',fontWeight:500}}>v0.1.0</span></div>
            </div>
            <div className="setting-row">
              <div className="setting-info"><span className="setting-label">检查更新</span></div>
              <div className="setting-control"><button className="btn">检查</button></div>
            </div>
          </div>
        </div>

      </div>

      {/* Toast */}
      {toast && (
        <div style={{
          position:'fixed', bottom:24, left:'50%', transform:'translateX(-50%)',
          padding:'8px 20px', borderRadius:8, fontSize:13, zIndex:999,
          background: toast.type === 'ok' ? 'var(--jade)' : 'var(--cinnabar)',
          color:'#fff', boxShadow:'0 4px 12px rgba(0,0,0,0.15)',
        }}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}
