import { useState, useEffect } from 'react'
import { useProvidersStore } from '@/stores/providersStore'
import { fetchProviderModels, type ProviderModel } from '@/api/providers'
import AddProviderDialog from '@/components/AddProviderDialog'

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState('provider')
  const { providers, loading, load } = useProvidersStore()
  const [providerModels, setProviderModels] = useState<Record<string, ProviderModel[]>>({})
  const [loadingModels, setLoadingModels] = useState<Record<string, boolean>>({})
  const [showAddModal, setShowAddModal] = useState(false)

  useEffect(() => {
    load()
  }, [])

  const loadModels = async (providerId: string) => {
    setLoadingModels(prev => ({ ...prev, [providerId]: true }))
    try {
      const models = await fetchProviderModels(providerId)
      setProviderModels(prev => ({ ...prev, [providerId]: models }))
    } catch (err) {
      console.error('Failed to load models:', err)
    } finally {
      setLoadingModels(prev => ({ ...prev, [providerId]: false }))
    }
  }

  const tabs = [
    { id: 'provider', label: '🔗 模型服务' },
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
                    <button 
                      className="btn sm" 
                      onClick={() => loadModels(provider.id)}
                      disabled={loadingModels[provider.id]}
                    >
                      {loadingModels[provider.id] ? '加载中...' : '刷新模型'}
                    </button>
                    <button className="btn sm">编辑</button>
                    {!provider.is_builtin && (
                      <button className="btn sm danger">删除</button>
                    )}
                  </div>
                  <div className="provider-url">{provider.base_url}</div>
                  <div className="model-list">
                    {providerModels[provider.id]?.map(model => (
                      <span 
                        key={model.id} 
                        className={`model-tag ${provider.models?.includes(model.id) ? 'on' : ''}`}
                      >
                        {model.id}
                      </span>
                    )) || (
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

        {/* 显示 */}
        <div className="tab-page" style={{display: activeTab === 'display' ? 'block' : 'none'}}>
          <div className="settings-section">
            <div className="section-title">显示</div>
            <div className="setting-row">
              <div className="setting-info"><span className="setting-label">界面语言</span><span className="setting-hint">选择界面显示语言</span></div>
              <div className="setting-control"><select><option>简体中文</option><option>English</option></select></div>
            </div>
            <div className="setting-row">
              <div className="setting-info"><span className="setting-label">主题</span><span className="setting-hint">界面显示主题</span></div>
              <div className="setting-control"><select><option>宣纸</option><option>暗夜</option><option>自动</option></select></div>
            </div>
            <div className="setting-row">
              <div className="setting-info"><span className="setting-label">消息通知</span><span className="setting-hint">接收新消息与事件通知</span></div>
              <div className="setting-control"><div className="toggle on"></div></div>
            </div>
            <div className="setting-row">
              <div className="setting-info"><span className="setting-label">声音提示</span><span className="setting-hint">任务完成时播放提示音</span></div>
              <div className="setting-control"><div className="toggle"></div></div>
            </div>
          </div>
        </div>

        {/* 会话 */}
        <div className="tab-page" style={{display: activeTab === 'session' ? 'block' : 'none'}}>
          <div className="settings-section">
            <div className="section-title">会话</div>
            <div className="section-desc">会话显示偏好与默认配置。</div>

            <div className="setting-row">
              <div className="setting-info"><span className="setting-label">默认工作区</span><span className="setting-hint">新会话的默认工作目录</span></div>
              <div className="setting-control"><input type="text" defaultValue="C:\.Tianshu" style={{width:280}}/></div>
            </div>
            <div className="setting-row">
              <div className="setting-info"><span className="setting-label">流式输出</span><span className="setting-hint">实时逐字显示 LLM 回复</span></div>
              <div className="setting-control"><div className="toggle on"></div></div>
            </div>
            <div className="setting-row">
              <div className="setting-info"><span className="setting-label">紧凑模式</span><span className="setting-hint">缩小消息间距，显示更多内容</span></div>
              <div className="setting-control"><div className="toggle"></div></div>
            </div>
            <div className="setting-row">
              <div className="setting-info"><span className="setting-label">显示推理</span><span className="setting-hint">展示模型的思考过程</span></div>
              <div className="setting-control"><div className="toggle on"></div></div>
            </div>
            <div className="setting-row">
              <div className="setting-info"><span className="setting-label">显示消耗</span><span className="setting-hint">在消息中显示 token 消耗</span></div>
              <div className="setting-control"><div className="toggle"></div></div>
            </div>
          </div>

          <div className="settings-section" style={{marginTop:32}}>
            <div className="section-title">默认系统提示词</div>
            <div className="section-desc">所有未自定义 prompt.md 的角色使用此模板。<code style={{background:'var(--bg-hover)',padding:'1px 4px',borderRadius:3,fontSize:11}}>{'{{GUIDANCE}}'}</code> 会被自动替换为工具使用指引。</div>
            <textarea rows={10} defaultValue="你是天枢 AI 助手，一个专业的 AI Agent 系统。你可以使用工具来完成任务，包括读写文件、执行命令、搜索网页等。

请遵循以下原则：
1. 优先使用工具获取准确信息
2. 操作前确认用户意图
3. 结果清晰简洁地呈现" />
            <div style={{marginTop:8,display:'flex',alignItems:'center',gap:8}}>
              <button className="btn primary">保存</button>
            </div>
          </div>
        </div>

        {/* 事件 */}
        <div className="tab-page" style={{display: activeTab === 'event' ? 'block' : 'none'}}>
          <div className="settings-section">
            <div className="section-title">事件</div>

            <div className="setting-group">
              <div className="setting-group-title">事件引擎</div>
              <div className="setting-row">
                <div className="setting-info"><span className="setting-label">启用事件调度</span><span className="setting-hint">定时执行 Cron 事件</span></div>
                <div className="setting-control"><div className="toggle on"></div></div>
              </div>
              <div className="setting-row">
                <div className="setting-info"><span className="setting-label">调度间隔</span><span className="setting-hint">事件调度器检查间隔（秒）</span></div>
                <div className="setting-control"><input type="number" defaultValue={30} style={{width:60}}/> 秒</div>
              </div>
              <div className="setting-row">
                <div className="setting-info"><span className="setting-label">归档时间</span><span className="setting-hint">已完成事件保留时长</span></div>
                <div className="setting-control"><input type="number" defaultValue={72} style={{width:60}}/> 小时</div>
              </div>
            </div>

            <div className="setting-group">
              <div className="setting-group-title">进化引擎 <span style={{fontSize:11,fontWeight:400,color:'var(--ink-faint)'}}>在线洞察检测 + 离线 LCS 聚类</span></div>
              <div className="setting-row">
                <div className="setting-info"><span className="setting-label">每日离线复盘</span><span className="setting-hint">凌晨 2:00 运行进化引擎聚类分析</span></div>
                <div className="setting-control"><div className="toggle on"></div></div>
              </div>
              <div className="setting-row">
                <div className="setting-info"><span className="setting-label">进化角色</span><span className="setting-hint">用于技能生成的 Agent 角色</span></div>
                <div className="setting-control"><select><option value="">无</option><option value="changgeng">长庚 (changgeng)</option><option value="tianxuan">天璇 (tianxuan)</option><option value="wenqu">文曲 (wenqu)</option><option value="ziwei">紫微 (ziwei)</option></select></div>
              </div>
              <div className="setting-row">
                <div className="setting-info"><span className="setting-label">进化模型服务</span><span className="setting-hint">技能生成使用的模型服务</span></div>
                <div className="setting-control"><select><option>OpenCode Go</option><option>OpenCode Zen</option></select></div>
              </div>
              <div className="setting-row">
                <div className="setting-info"><span className="setting-label">进化模型</span><span className="setting-hint">技能生成使用的模型</span></div>
                <div className="setting-control"><select><option>kimi-k2.7-code</option><option>deepseek-v4-pro</option><option>glm-5.2</option></select></div>
              </div>
              <div className="setting-row">
                <div className="setting-info"><span className="setting-label">进化工作区</span><span className="setting-hint">技能生成使用的代码工作区</span></div>
                <div className="setting-control"><input type="text" defaultValue="C:\Users\dmql\Documents\TianShu" style={{width:220}}/></div>
              </div>
            </div>

            <div className="setting-group">
              <div className="setting-group-title">触发参数</div>
              <div className="evo-grid">
                <div className="evo-item"><label>检测窗口</label><input type="number" defaultValue={8}/></div>
                <div className="evo-item"><label>错误率阈值</label><input type="number" defaultValue={0.5} step="0.1"/></div>
                <div className="evo-item"><label>重复次数</label><input type="number" defaultValue={3}/></div>
                <div className="evo-item"><label>高频最小调用</label><input type="number" defaultValue={6}/></div>
                <div className="evo-item"><label>高频最大去重</label><input type="number" defaultValue={2}/></div>
                <div className="evo-item"><label>通知超时（秒）</label><input type="number" defaultValue={2}/></div>
              </div>
            </div>

            <div style={{display:'flex',gap:8,marginTop:12}}>
              <button className="btn">重置默认值</button>
              <button className="btn danger">清空配置</button>
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
    </div>
  )
}
