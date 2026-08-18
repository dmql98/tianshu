import { useState, useRef, useEffect } from 'react'
import { useChatStore } from '@/stores/chatStore'
import { useProvidersStore } from '@/stores/providersStore'
import { updateSession, compactSession } from '@/api/sessions'
import { fetchCharacters } from '@/api/characters'
import type { Character, Strategy } from '@/types'
import CharacterRenderer from '@/features/characters/CharacterRenderer'
import Icon from '@/features/icons/Icon'
import { useCharacterPresence } from '@/features/character-presence/useCharacterPresence'
import { useI18n } from '@/i18n'

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = ''
  const bytes = new Uint8Array(buffer)
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)))
  }
  return btoa(binary)
}

function mimeFromExt(name: string): string | null {
  const ext = name.split('.').pop()?.toLowerCase()
  if (!ext) return null
  const map: Record<string, string> = {
    md: 'text/markdown', txt: 'text/plain', json: 'application/json',
    xml: 'application/xml', csv: 'text/csv', yaml: 'application/x-yaml', yml: 'application/x-yaml',
    toml: 'application/toml', js: 'application/javascript', ts: 'application/typescript',
    py: 'text/x-python', sh: 'text/x-shellscript', html: 'text/html', htm: 'text/html',
    css: 'text/css', log: 'text/plain', env: 'text/plain', ini: 'text/plain',
    cfg: 'text/plain', conf: 'text/plain',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml', ico: 'image/x-icon',
    pdf: 'application/pdf',
  }
  return map[ext] ?? null
}

export default function ChatInput() {
  const [input, setInput] = useState('')
  const [character, setCharacter] = useState<Character | null>(null)
  const [isFocused, setIsFocused] = useState(false)
  const [compacting, setCompacting] = useState(false)
  const [compactNotice, setCompactNotice] = useState<string | null>(null)
  const compactNoticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { sendMessage, isStreaming, abortRun, sessions, activeSessionId, attachments, addAttachment, removeAttachment, activeRun, limitNotice, clearLimitNotice, setStrategy, tokenUsage } = useChatStore()
  const { providers } = useProvidersStore()
  const t = useI18n()
  const session = sessions.find(s => s.id === activeSessionId)
  const presence = useCharacterPresence(session?.character_id ?? '', activeSessionId ?? undefined)
  const inputMotion = isFocused && presence === 'idle' ? 'listening' : undefined
  // Cross-run phases: continuation_pending keeps sending disabled while the
  // successor run is still queued/starting (§14.4).
  const blockInput = isStreaming || activeRun.phase === 'continuation_pending'

  // Load current character. Reset synchronously when the session switches so
  // the previous session's avatar never lingers.
  useEffect(() => {
    setCharacter(null)
    if (!session?.character_id) return
    let cancelled = false
    fetchCharacters()
      .then(chars => { if (!cancelled) setCharacter(chars.find(c => c.id === session.character_id) || null) })
      .catch(() => { if (!cancelled) setCharacter(null) })
    return () => { cancelled = true }
  }, [session?.character_id])

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + 'px'
    }
  }, [input])

  const handleSend = () => {
    if ((!input.trim() && attachments.length === 0) || blockInput) return
    sendMessage(input.trim())
    setInput('')
  }

  const showCompactNotice = (text: string) => {
    if (compactNoticeTimer.current) clearTimeout(compactNoticeTimer.current)
    setCompactNotice(text)
    compactNoticeTimer.current = setTimeout(() => setCompactNotice(null), 3000)
  }

  const handleCompact = async () => {
    if (!activeSessionId || compacting || blockInput) return
    setCompacting(true)
    try {
      const res = await compactSession(activeSessionId)
      if (res.didCompact && typeof res.tokensAfter === 'number') {
        useChatStore.setState(state => ({
          sessions: state.sessions.map(s =>
            s.id === activeSessionId ? { ...s, context_usage: res.tokensAfter, compacted: true } : s
          ),
        }))
        showCompactNotice(t('已压缩至 {tokens}', { tokens: formatTokens(res.tokensAfter) }))
      } else {
        showCompactNotice(t('无需压缩'))
      }
    } catch {
      showCompactNotice(t('压缩失败'))
    } finally {
      setCompacting(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files || files.length === 0) return
    for (const file of Array.from(files)) {
      const mime = file.type || mimeFromExt(file.name) || 'application/octet-stream'
      if (mime.startsWith('image/')) {
        const reader = new FileReader()
        reader.onload = () => {
          const result = reader.result as string
          const base64 = result.includes(',') ? result.split(',', 2)[1] : result
          addAttachment(file.name, mime, base64, result)
        }
        reader.readAsDataURL(file)
      } else {
        const reader = new FileReader()
        reader.onload = () => {
          const buffer = reader.result as ArrayBuffer
          addAttachment(file.name, mime, arrayBufferToBase64(buffer))
        }
        reader.readAsArrayBuffer(file)
      }
    }
    e.target.value = ''
  }

  const starName = character?.name || '天枢'
  const starColor = character?.color || 'var(--gold)'
  const canSend = (input.trim().length > 0 || attachments.length > 0) && !blockInput

  // Context usage estimate (match RightPanel logic). Prefer the provider-
  // reported real token count (`context_usage`, persisted server-side) once the
  // official API has replied — never fall back to the character estimate for a
  // session that has a real measurement, otherwise the bar jumps between the
  // two (the char/4 guess overcounts CJK-heavy / tool-output-heavy contexts).
  const msgs = session?.messages || []
  let totalChars = 0
  for (const m of msgs) {
    if (m.role === 'tool') {
      if (m.tool_output) totalChars += m.tool_output.length
    } else {
      if (m.content) totalChars += m.content.length
    }
    if (m.reasoning) totalChars += m.reasoning.length
    totalChars += 16
  }
  const hasRealUsage = typeof session?.context_usage === 'number' && session.context_usage > 0
  const tokenEst = hasRealUsage
    ? session.context_usage!
    : Math.ceil(totalChars / 4)
  const contextWindow = session?.context_window || 200000
  const contextPct = Math.min(100, Math.round((tokenEst / contextWindow) * 100))
  const cacheHit = session?.cacheStats?.hitRatio || session?.cache_hit_ratio

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
      useChatStore.setState(state => ({
        sessions: state.sessions.map(s =>
          s.id === activeSessionId ? { ...s, provider_id: providerId, model } : s
        ),
      }))
    }
  }

  function handleStrategyChange(strategy: Strategy) {
    setStrategy(strategy)
    if (activeSessionId) {
      updateSession(activeSessionId, { current_strategy: strategy }).catch(() => {})
    }
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

  function handleExecutionModeChange(mode: 'direct' | 'plan_first' | 'goal') {
    if (activeSessionId) {
      updateSession(activeSessionId, { execution_mode: mode }).catch(() => {})
      useChatStore.setState(state => ({
        sessions: state.sessions.map(s =>
          s.id === activeSessionId ? { ...s, execution_mode: mode } : s
        ),
      }))
    }
  }

  // Build model options grouped by provider (only enabled models)
  const modelOptions: { providerId: string; providerName: string; modelId: string; modelName: string }[] = []
  for (const p of providers) {
    const enabledSet = p.enabled_models && p.enabled_models.length > 0 ? new Set(p.enabled_models) : null
    for (const m of p.models || []) {
      const mid = m.id || m.name
      if (enabledSet && !enabledSet.has(mid)) continue
      modelOptions.push({
        providerId: p.id,
        providerName: p.name,
        modelId: `${p.id}::${mid}`,
        modelName: m.name || m.id,
      })
    }
  }

  const currentModelKey = `${session?.provider_id || ''}::${session?.model || ''}`

  return (
    <div className="input-area">
      <div className="input-main">
        <div className="input-star-col">
          <div
            className="input-star-avatar"
            title={character ? `${character.name} · ${character.description}` : t('当前星官')}
            style={{ '--star-color': starColor } as React.CSSProperties}
          >
            <CharacterRenderer
              characterId={session?.character_id ?? ''}
              name={character?.name || ''}
              legacyAvatar={character?.avatar}
              mode="stage"
              motion={inputMotion}
              sessionId={activeSessionId ?? undefined}
              className="character-renderer-input"
            />
          </div>
        </div>
        <div className="input-box">
          {/* Attachment previews */}
          {attachments.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '8px 10px 0' }}>
              {attachments.map((a, i) => (
                <div key={i} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '2px 6px', fontSize: 'calc(11px * var(--ui-font-scale))', borderRadius: 4,
                  background: 'rgba(42,157,92,0.06)', border: '1px solid rgba(42,157,92,0.2)',
                  color: 'var(--jade)', maxWidth: 160,
                }}>
                  {a.dataUrl
                    ? <img src={a.dataUrl} style={{ width: 16, height: 16, borderRadius: 2, objectFit: 'cover' }} />
                    : <span style={{ display: 'inline-flex' }}><Icon name={a.mime?.startsWith('image/') ? 'image' : 'attach'} size={14} ariaHidden /></span>
                  }
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
                  <span
                    onClick={() => removeAttachment(i)}
                    style={{ cursor: 'pointer', color: 'rgba(42,157,92,0.5)', fontSize: 'calc(13px * var(--ui-font-scale))', lineHeight: 1, flexShrink: 0 }}
                  >×</span>
                </div>
              ))}
            </div>
          )}

          <textarea
            ref={textareaRef}
            className="chat-textarea"
            rows={1}
            placeholder={character ? t('与{name}聊点什么...', { name: starName }) : t('添加角色以开始会话')}
            value={input}
            onChange={e => setInput(e.target.value)}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            onKeyDown={handleKeyDown}
          />
          <div className="input-bottom">
            <button className="tool-btn" title={t('附件')} onClick={() => fileInputRef.current?.click()}>+ {t('附件')}</button>
            <input ref={fileInputRef} type="file" multiple hidden onChange={onFilePicked} />
          </div>
          <div className="input-actions">
            {blockInput ? (
              <button className="send-btn" onClick={abortRun} title={t('停止整条自动续跑链')} style={{ background: 'var(--cinnabar)' }}>
                ⏹
              </button>
            ) : (
              <button
                className="send-btn"
                onClick={handleSend}
                disabled={!canSend}
                title={t('发送')}
              >
                ⬆
              </button>
            )}
          </div>
          {limitNotice && (
            <div
              onClick={clearLimitNotice}
              style={{
                position: 'absolute', bottom: 'calc(100% + 8px)', left: 16, right: 16,
                padding: '6px 12px', borderRadius: 8, fontSize: 'calc(12px * var(--ui-font-scale))',
                background: limitNotice.tone === 'warn' ? 'rgba(200,60,40,0.1)' : 'rgba(42,157,92,0.08)',
                border: `1px solid ${limitNotice.tone === 'warn' ? 'rgba(200,60,40,0.3)' : 'rgba(42,157,92,0.25)'}`,
                color: limitNotice.tone === 'warn' ? 'var(--cinnabar)' : 'var(--jade)',
                cursor: 'pointer',
                zIndex: 20,
              }}
            >
              {limitNotice.text}
            </div>
          )}
        </div>
      </div>
      <div className="input-options">
        <div className="input-ctx">
          <div className="input-ctx-cache">
            <span>{t('缓存命中')}：{cacheHit || '--'}</span>
            <button
              className="ctx-compact-btn"
              onClick={handleCompact}
              disabled={!activeSessionId || blockInput || compacting}
              title={t('压缩上下文')}
            >
              {compacting ? '…' : '⇕'}
            </button>
          </div>
          <div className="input-ctx-row">
            <div className="input-ctx-bar">
              <div className="fill" style={{ width: `${contextPct}%` }}></div>
              <span className="input-ctx-text">{formatTokens(tokenEst)} / {formatTokens(contextWindow)}</span>
            </div>
          </div>
          {compactNotice && <div className="input-ctx-notice">{compactNotice}</div>}
        </div>
        <select
          value={currentModelKey}
          onChange={e => handleModelChange(e.target.value)}
          title={t('模型')}
          className="io-select"
        >
          {modelOptions.length === 0 && <option value="">--</option>}
          {providers.map(p => {
            const enabledSet = p.enabled_models && p.enabled_models.length > 0 ? new Set(p.enabled_models) : null
            const models = (p.models || []).filter(m => !enabledSet || enabledSet.has(m.id || m.name))
            if (models.length === 0) return null
            return (
              <optgroup key={p.id} label={p.name}>
                {models.map(m => {
                  const key = `${p.id}::${m.id || m.name}`
                  return <option key={key} value={key}>{m.name || m.id}</option>
                })}
              </optgroup>
            )
          })}
        </select>
        <select
          value={session?.reasoning_effort || 'medium'}
          onChange={e => handleReasoningEffortChange(e.target.value)}
          title={t('思考强度')}
          className="io-select"
        >
          <option value="low">{t('低')}</option>
          <option value="medium">{t('中')}</option>
          <option value="high">{t('高')}</option>
          <option value="max">{t('最高')}</option>
        </select>
        <select
          value={session?.execution_mode || 'direct'}
          onChange={e => handleExecutionModeChange(e.target.value as 'direct' | 'plan_first' | 'goal')}
          title={t('执行模式：Direct 可选计划/目标；Plan-first 必须建计划；Goal 必须建计划与目标')}
          className="io-select"
        >
          <option value="direct">{t('Direct（直接执行）')}</option>
          <option value="plan_first">{t('Plan-first（先计划后执行）')}</option>
          <option value="goal">{t('Goal（目标+计划）')}</option>
        </select>
        <select
          value={session?.current_strategy || 'Ask Risky'}
          onChange={e => handleStrategyChange(e.target.value as Strategy)}
          title={session?.current_strategy === 'Auto Approve'
            ? t('所有工具操作和授权路径均自动允许')
            : session?.current_strategy === 'Auto in Workspace'
              ? t('授权工作区内自动允许，新增路径时询问')
            : t('审批模式')}
          className="io-select"
        >
          <option value="Read Only">{t('Read Only')}</option>
          <option value="Ask Every Change">{t('Ask Every Change')}</option>
          <option value="Ask Risky">{t('Ask Risky')}</option>
          <option value="Auto in Workspace">{t('Auto in Workspace')}</option>
          <option value="Auto Approve">{t('Auto Approve')}</option>
        </select>
      </div>
    </div>
  )
}
