import { useMemo } from 'react'
import { useChatStore } from '@/stores/chatStore'
import { useUIStore } from '@/stores/uiStore'
import { useI18n } from '@/i18n'

interface FileEntry {
  name: string
  path?: string
  source: 'attachment' | 'tool-read' | 'tool-write' | 'tool-output'
  icon: string
}

function extractPath(toolInput?: string): string | undefined {
  if (!toolInput) return undefined
  try {
    const parsed = JSON.parse(toolInput)
    return parsed.file_path || parsed.path || parsed.filePath || undefined
  } catch {
    return undefined
  }
}

function dirOf(filePath: string): string {
  const sep = filePath.includes('\\') ? '\\' : '/'
  const parts = filePath.split(sep)
  parts.pop()
  return parts.join(sep) || sep
}

async function openDirectory(path: string) {
  try {
    await fetch('/api/workspace/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    })
  } catch {
    // Fallback: copy to clipboard
    navigator.clipboard.writeText(path).catch(() => {})
  }
}

export default function FilePanel() {
  const { sessions, activeSessionId } = useChatStore()
  const { toggleFilePanel } = useUIStore()
  const t = useI18n()
  const session = sessions.find(s => s.id === activeSessionId)
  const messages = session?.messages || []

  const files = useMemo(() => {
    const entries: FileEntry[] = []
    const seen = new Set<string>()

    for (const m of messages) {
      // User attachments
      if (m.attachments) {
        for (const att of m.attachments) {
          const key = `att:${att.name}`
          if (!seen.has(key)) {
            seen.add(key)
            entries.push({
              name: att.name,
              source: 'attachment',
              icon: att.mime?.startsWith('image/') ? '🖼️' : '📎',
            })
          }
        }
      }

      // Tool calls
      if (m.role === 'tool') {
        const toolName = m.tool_name || ''
        const filePath = extractPath(m.tool_input)

        // read / glob tools → file read
        if ((toolName === 'read' || toolName === 'glob') && filePath) {
          const key = `read:${filePath}`
          if (!seen.has(key)) {
            seen.add(key)
            entries.push({ name: filePath.split(/[/\\]/).pop() || filePath, path: filePath, source: 'tool-read', icon: '📖' })
          }
        }

        // write / edit tools → file written
        if ((toolName === 'write' || toolName === 'edit') && filePath) {
          const key = `write:${filePath}`
          if (!seen.has(key)) {
            seen.add(key)
            entries.push({ name: filePath.split(/[/\\]/).pop() || filePath, path: filePath, source: 'tool-write', icon: '✏️' })
          }
        }
      }
    }
    return entries
  }, [messages])

  const attachments = files.filter(f => f.source === 'attachment')
  const toolFiles = files.filter(f => f.source === 'tool-read' || f.source === 'tool-write')

  return (
    <aside className="file-panel">
      <div className="fp-header">
        <span className="fp-title">{t('文件')}</span>
        <span className="fp-close" onClick={toggleFilePanel}>✕</span>
      </div>
      <div className="fp-body">
        {/* Attachments */}
        <div className="fp-section">
          <div className="fp-section-title">{t('附件')}</div>
          {attachments.length === 0 ? (
            <div style={{ fontSize: 'calc(11px * var(--ui-font-scale))', color: 'var(--ink-faint)', padding: '4px 0' }}>{t('无附件')}</div>
          ) : attachments.map((f, i) => (
            <div key={i} className="fp-file-item">
              <span className="fp-file-icon">{f.icon}</span>
              <span className="fp-file-name">{f.name}</span>
            </div>
          ))}
        </div>

        {/* Tool files */}
        <div className="fp-section">
          <div className="fp-section-title">{t('工具文件')}</div>
          {toolFiles.length === 0 ? (
            <div style={{ fontSize: 'calc(11px * var(--ui-font-scale))', color: 'var(--ink-faint)', padding: '4px 0' }}>{t('无文件操作')}</div>
          ) : toolFiles.map((f, i) => (
            <div key={i} className="fp-file-item">
              <span className="fp-file-icon">{f.icon}</span>
              <span className="fp-file-name" title={f.path}>{f.name}</span>
              {f.path && (
                <button
                  onClick={() => openDirectory(dirOf(f.path!))}
                  title={t('打开所在目录')}
                  style={{
                    marginLeft: 'auto', background: 'none', border: 'none',
                    color: 'var(--ink-faint)', cursor: 'pointer', fontSize: 'calc(12px * var(--ui-font-scale))',
                    padding: '0 2px', flexShrink: 0,
                  }}
                  onMouseEnter={e => (e.currentTarget.style.color = 'var(--gold)')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'var(--ink-faint)')}
                >📂</button>
              )}
            </div>
          ))}
        </div>
      </div>
    </aside>
  )
}
