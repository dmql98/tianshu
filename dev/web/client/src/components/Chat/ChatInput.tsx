import { useState, useRef, useEffect } from 'react'
import { useChatStore } from '@/stores/chatStore'
import { fetchCharacters } from '@/api/characters'
import type { Character } from '@/types'
import CharacterRenderer from '@/features/characters/CharacterRenderer'
import { useCharacterPresence } from '@/features/character-presence/useCharacterPresence'

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
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { sendMessage, isStreaming, abortRun, sessions, activeSessionId, attachments, addAttachment, removeAttachment } = useChatStore()
  const session = sessions.find(s => s.id === activeSessionId)
  const presence = useCharacterPresence(session?.character_id ?? '', activeSessionId ?? undefined)
  const inputMotion = isFocused && presence === 'idle' ? 'listening' : undefined

  // Load current character
  useEffect(() => {
    if (!session?.character_id) { setCharacter(null); return }
    fetchCharacters()
      .then(chars => setCharacter(chars.find(c => c.id === session.character_id) || null))
      .catch(() => setCharacter(null))
  }, [session?.character_id])

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + 'px'
    }
  }, [input])

  const handleSend = () => {
    if ((!input.trim() && attachments.length === 0) || isStreaming) return
    sendMessage(input.trim())
    setInput('')
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
  const canSend = (input.trim().length > 0 || attachments.length > 0) && !isStreaming

  return (
    <div className="input-area">
      <div className="input-main">
        <div
          className="input-star-avatar"
          title={character ? `${character.name} · ${character.description}` : '当前星官'}
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
        <div className="input-box">
          {/* Attachment previews */}
          {attachments.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '8px 10px 0' }}>
              {attachments.map((a, i) => (
                <div key={i} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '2px 6px', fontSize: 11, borderRadius: 4,
                  background: 'rgba(42,157,92,0.06)', border: '1px solid rgba(42,157,92,0.2)',
                  color: 'var(--jade)', maxWidth: 160,
                }}>
                  {a.dataUrl
                    ? <img src={a.dataUrl} style={{ width: 16, height: 16, borderRadius: 2, objectFit: 'cover' }} />
                    : <span style={{ fontSize: 12 }}>{a.mime?.startsWith('image/') ? '🖼️' : '📎'}</span>
                  }
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
                  <span
                    onClick={() => removeAttachment(i)}
                    style={{ cursor: 'pointer', color: 'rgba(42,157,92,0.5)', fontSize: 13, lineHeight: 1, flexShrink: 0 }}
                  >×</span>
                </div>
              ))}
            </div>
          )}

          <textarea
            ref={textareaRef}
            className="chat-textarea"
            rows={1}
            placeholder={character ? `与${starName}聊点什么...` : '添加角色以开始会话'}
            value={input}
            onChange={e => setInput(e.target.value)}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            onKeyDown={handleKeyDown}
          />
          <div className="input-bottom">
            <button className="tool-btn" title="附件" onClick={() => fileInputRef.current?.click()}>+ 附件</button>
            <input ref={fileInputRef} type="file" multiple hidden onChange={onFilePicked} />
          </div>
          <div className="input-actions">
            {isStreaming ? (
              <button className="send-btn" onClick={abortRun} title="停止" style={{ background: 'var(--cinnabar)' }}>
                ⏹
              </button>
            ) : (
              <button
                className="send-btn"
                onClick={handleSend}
                disabled={!canSend}
                title="发送"
              >
                ⬆
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
