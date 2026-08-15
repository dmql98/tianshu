import { useState, useEffect } from 'react'
import { fetchTools, type ToolMeta } from '@/api/tools'
import { useI18n } from '@/i18n'

const sourceLabels: Record<string, string> = {
  builtin: '内置',
  mcp: 'MCP',
  external: '外部',
}

export default function ToolView() {
  const t = useI18n()
  const [tools, setTools] = useState<ToolMeta[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchTools()
      .then(data => setTools(data.tools))
      .finally(() => setLoading(false))
  }, [])

  const builtinTools = tools.filter(t => t.source !== 'mcp')
  const mcpTools = tools.filter(t => t.source === 'mcp')

  function renderCard(tool: ToolMeta) {
    const src = tool.source || 'builtin'
    return (
      <div key={tool.name} className="tool-card">
        <div className="tool-card-header" style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
          <span className="tool-name">{tool.name}</span>
          <span className={`tool-source ${src}`}>{sourceLabels[src] || src}</span>
        </div>
        <div className="tool-desc">{tool.description}</div>
      </div>
    )
  }

  return (
    <div className="main">
      <div className="page-header">
        <span className="page-title">{t('工具管理')}</span>
        {!loading && (
          <span style={{ fontSize: 'calc(12px * var(--ui-font-scale))', color: 'var(--ink-light)' }}>
            {t('{count} 个内置', { count: builtinTools.length })}{mcpTools.length > 0 ? ` · ${t('{count} 个 MCP', { count: mcpTools.length })}` : ''}
          </span>
        )}
      </div>
      <div className="content">
        {loading ? (
          <div className="empty-state">{t('加载中...')}</div>
        ) : (
          <>
            <div className="group-title">{t('内置工具')}</div>
            <div className="tool-grid">
              {builtinTools.map(renderCard)}
            </div>
            {mcpTools.length > 0 && (
              <>
                <div className="group-title">{t('MCP 工具')}</div>
                <div className="tool-grid">
                  {mcpTools.map(renderCard)}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
