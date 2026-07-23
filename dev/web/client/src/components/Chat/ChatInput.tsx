import { useState, useRef, useEffect } from 'react'
import { useChatStore } from '@/stores/chatStore'

export default function ChatInput() {
  const [input, setInput] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { sendMessage, isStreaming, abortRun } = useChatStore()

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + 'px'
    }
  }, [input])

  const handleSend = () => {
    if (!input.trim() || isStreaming) return
    sendMessage(input.trim())
    setInput('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="input-area">
      <div className="input-main">
        <div className="input-star-avatar" title="当前星官">
          <div style={{ 
            width: '100%', 
            height: '100%', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            fontSize: '48px',
            background: 'linear-gradient(135deg, var(--gold-light), var(--gold))'
          }}>
            🌟
          </div>
        </div>
        <div className="input-box">
          <textarea
            ref={textareaRef}
            className="chat-textarea"
            rows={1}
            placeholder="与天枢对话... (@提及, /plan /ask /bypass)"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <div className="input-bottom">
            <button className="tool-btn" title="附件">+ 附件</button>
            <button className="tool-btn" title="权限">🔓 完全访问</button>
          </div>
          <div className="input-actions">
            <button className="model-select" title="切换模型">kimi-k2.5 ⌄</button>
            {isStreaming ? (
              <button className="send-btn stop" onClick={abortRun} title="停止">
                ⏹
              </button>
            ) : (
              <button
                className="send-btn"
                onClick={handleSend}
                disabled={!input.trim()}
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
