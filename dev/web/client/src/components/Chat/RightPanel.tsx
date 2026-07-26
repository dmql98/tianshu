import { useState, useEffect, useRef } from 'react'
import { useChatStore } from '@/stores/chatStore'
import { useUIStore } from '@/stores/uiStore'
import { useProvidersStore } from '@/stores/providersStore'
import { fetchCharacters } from '@/api/characters'
import { updateSession } from '@/api/sessions'
import type { Character } from '@/types'

type Strategy = 'Plan' | 'Ask' | 'Bypass'

export default function RightPanel() {
  const { sessions, activeSessionId, addWorkspace, removeWorkspace, setStrategy, tokenUsage } = useChatStore()
  const { providers, load: loadProviders } = useProvidersStore()
  const { toggleRightPanel } = useUIStore()
  const session = sessions.find(s => s.id === activeSessionId)
  const [character, setCharacter] = useState<Character | null>(null)
  const charCache = useRef<Map<string, Character>>(new Map())

  useEffect(() => {
    if (!session?.character_id) { setCharacter(null); return }
    const cached = charCache.current.get(session.character_id)
    if (cached) { setCharacter(cached); return }
    fetchCharacters()
      .then(chars => {
        for (const c of chars) charCache.current.set(c.id, c)
        setCharacter(chars.find(c => c.id === session.character_id) || null)
      })
      .catch(() => setCharacter(null))
  }, [session?.character_id])

  if (!session) {
    return (
      <aside className="right-panel">
        <div className="rp-header"><span className="rp-title">详情</span><span className="rp-close" onClick={toggleRightPanel}>✕</span></div>
        <div className="rp-body" style={{ padding: 20, textAlign: 'center', color: 'var(--ink-faint)', fontSize: 12 }}>
          选择一个会话查看详情
        </div>
      </aside>
    )
  }

  const starColor = character?.color || 'var(--gold)'
  const starName = character?.name || session.character_id || '未分配'
  const starTitle = character?.description || ''
  const messages = session.messages || []
  const toolCalls = messages.filter(m => m.role === 'tool').length

  // Parse workspaces
  let workspaces: string[] = []
  if (session.workspaces) {
    try {
      workspaces = typeof session.workspaces === 'string'
        ? JSON.parse(session.workspaces) : session.workspaces
    } catch { /* ignore */ }
  } else if (session.workspace) {
    workspaces = [session.workspace]
  }

  // Context usage estimate (match old frontend logic)
  let totalChars = 0
  for (const m of messages) {
    if (m.role === 'tool') {
      if (m.tool_output) totalChars += m.tool_output.length
    } else {
      if (m.content) totalChars += m.content.length
    }
    if (m.reasoning) totalChars += m.reasoning.length
    totalChars += 16
  }
  const tokenEst = Math.ceil(totalChars / 4)
  const contextWindow = session.context_window || 200000
  const contextPct = Math.min(100, Math.round((tokenEst / contextWindow) * 100))
  const totalTokens = tokenUsage.total || ((session.input_tokens || 0) + (session.output_tokens || 0))

  // Step limit display
  const maxSteps = character?.maxSteps
  const stepLimitText = !maxSteps || maxSteps >= 999 ? '不限制' : `${maxSteps} 步`

  function formatTokens(n: number): string {
    if (n >= 1000000) return `${(n / 1000000).toFixed(n % 1000000 === 0 ? 0 : 1)}M`
    if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K`
    return String(n)
  }

  function handleModelChange(modelId: string) {
    // modelId format: "providerId::modelName"
    const [providerId, model] = modelId.split('::')
    if (activeSessionId) {
      updateSession(activeSessionId, { provider_id: providerId, model }).catch(() => {})
      // Update local state via chatStore
      useChatStore.setState(state => ({
        sessions: state.sessions.map(s =>
          s.id === activeSessionId ? { ...s, provider_id: providerId, model } : s
        ),
      }))
    }
  }

  function handleStrategyChange(strategy: Strategy) {
    setStrategy(strategy)
  }

  function handleReasoningEffortChange(effort: string) {
    if (activeSessionId) {
      updateSession(activeSessionId, { reasoning_effort: effort }).catch(() => {})
      useChatStore.setState(state => ({
        sessions: state.sessions.map(s =>
          s.id === activeSessionId ? { ...s, reasoning_effort: effort } : s
        ),
      }))
    }
  }

  // Build model options grouped by provider
  const modelOptions: { providerId: string; providerName: string; modelId: string; modelName: string }[] = []
  for (const p of providers) {
    for (const m of p.models || []) {
      modelOptions.push({
        providerId: p.id,
        providerName: p.name,
        modelId: `${p.id}::${m.id || m.name}`,
        modelName: m.name || m.id,
      })
    }
  }

  const currentModelKey = `${session.provider_id || ''}::${session.model || ''}`

  return (
    <aside className="right-panel">
      <div className="rp-header">
        <span className="rp-title">详情</span>
        <span className="rp-close" onClick={toggleRightPanel}>✕</span>
      </div>
      <div className="rp-body">
        {/* Character art */}
        {character && (
          <div className="rp-art-card">
            <div className="rp-art" style={{ background: `linear-gradient(135deg, ${starColor}15, ${starColor}08)` }}>
              {character.avatar
                ? <img src={character.avatar} alt={starName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <span style={{ fontSize: 64 }}>{starName[0]}</span>
              }
            </div>
            <div className="rp-art-info">
              <div className="rp-art-name">{starName}</div>
              <div className="rp-art-title">{starTitle}</div>
            </div>
          </div>
        )}

        {/* Running config */}
        <div className="rp-section">
          <div className="rp-section-title">运行配置</div>
          <div className="rp-row">
            <span className="label">模型</span>
            <select
              value={currentModelKey}
              onChange={e => handleModelChange(e.target.value)}
              style={{ fontSize: 12, padding: '2px 4px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--ink-mid)', maxWidth: 140 }}
            >
              {modelOptions.length === 0 && <option value="">--</option>}
              {providers.map(p => (
                <optgroup key={p.id} label={p.name}>
                  {(p.models || []).map(m => {
                    const key = `${p.id}::${m.id || m.name}`
                    return <option key={key} value={key}>{m.name || m.id}</option>
                  })}
                </optgroup>
              ))}
            </select>
          </div>
          <div className="rp-row">
            <span className="label">思考强度</span>
            <select
              value={session.reasoning_effort || 'medium'}
              onChange={e => handleReasoningEffortChange(e.target.value)}
              style={{ fontSize: 12, padding: '2px 4px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--ink-mid)' }}
            >
              <option value="low">低</option>
              <option value="medium">中</option>
              <option value="high">高</option>
              <option value="max">最高</option>
            </select>
          </div>
          <div className="rp-row">
            <span className="label">策略</span>
            <select
              value={session.current_strategy || 'Ask'}
              onChange={e => handleStrategyChange(e.target.value as Strategy)}
              style={{ fontSize: 12, padding: '2px 4px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--ink-mid)' }}
            >
              <option value="Plan">Plan</option>
              <option value="Ask">Ask</option>
              <option value="Bypass">Bypass</option>
            </select>
          </div>
          <div className="rp-row"><span className="label">角色类型</span><span className="value">{character?.role === 'both' ? '主/子 Agent' : character?.role === 'main' ? '主 Agent' : character?.role === 'sub' ? '子 Agent' : '--'}</span></div>
          <div className="rp-row"><span className="label">步数限制</span><span className="value">{stepLimitText}</span></div>
        </div>

        {/* Workspaces */}
        <div className="rp-section">
          <div className="rp-section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            工作区
            <button
              style={{ background: 'none', border: 'none', color: 'var(--gold)', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}
              title="添加路径"
              onClick={() => {
                const path = prompt('输入工作区路径：')
                if (path) addWorkspace(path)
              }}
            >+</button>
          </div>
          {workspaces.length === 0 ? (
            <div style={{ fontSize: 11, color: 'var(--ink-faint)' }}>无工作区</div>
          ) : workspaces.map((ws, i) => (
            <div key={i} className="rp-ws-item">
              <span className="rp-ws-path">{ws}</span>
              {i > 0 && (
                <button className="rp-ws-del" title="删除" onClick={() => removeWorkspace(ws)}>✕</button>
              )}
            </div>
          ))}
        </div>

        {/* Running status */}
        <div className="rp-section">
          <div className="rp-section-title">运行状态</div>
          <div className="rp-row">
            <span className="label">上下文</span>
            <span className="value">{tokenEst > 0 ? `${formatTokens(tokenEst)} / ${formatTokens(contextWindow)}` : '--'}</span>
          </div>
          {tokenEst > 0 && <div className="rp-meter"><div className="fill" style={{ width: `${contextPct}%` }}></div></div>}
          <div className="rp-row" style={{ marginTop: 6 }}>
            <span className="label">缓存命中</span>
            <span className="value" style={{ color: 'var(--jade)' }}>
              {session.cacheStats?.hitRatio || session.cache_hit_ratio || '--'}
            </span>
          </div>
          <div className="rp-row"><span className="label">当前策略</span><span className="value">{session.current_strategy || 'Ask'}</span></div>
          {session.compacted && (
            <div style={{ fontSize: 10, color: 'var(--gold)', marginTop: 4 }}>⚠ 会话已压缩</div>
          )}
        </div>

        {/* Capabilities */}
        {character && (
          <div className="rp-section">
            <div className="rp-section-title">能力</div>
            <div className="rp-row"><span className="label">技能</span><span className="value">{character.skills?.length || 0} 个</span></div>
            <div className="rp-row"><span className="label">工具</span><span className="value">{character.tools?.length || 0} 个就绪</span></div>
          </div>
        )}

        {/* Session stats */}
        <div className="rp-section">
          <div className="rp-section-title">会话统计</div>
          <div className="rp-stats">
            <div className="rp-stat"><div className="rp-stat-value">{messages.length}</div><div className="rp-stat-label">消息</div></div>
            <div className="rp-stat"><div className="rp-stat-value">{formatTokens(totalTokens || tokenEst)}</div><div className="rp-stat-label">Tokens</div></div>
            <div className="rp-stat"><div className="rp-stat-value">{toolCalls}</div><div className="rp-stat-label">工具调用</div></div>
            <div className="rp-stat"><div className="rp-stat-value">{session.cacheStats?.hitRatio || session.cache_hit_ratio || '--'}</div><div className="rp-stat-label">缓存命中</div></div>
          </div>
        </div>
      </div>
    </aside>
  )
}
