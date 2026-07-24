import { useState, useEffect } from 'react'
import { fetchTools, type ToolMeta } from '@/api/tools'

const sourceLabels: Record<string, string> = {
  builtin: '内置',
  mcp: 'MCP',
  external: '外部',
}

export default function ToolView() {
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
        <span className="page-title">工具管理</span>
        {!loading && (
          <span style={{ fontSize: 12, color: 'var(--ink-light)' }}>
            {builtinTools.length} 个内置{mcpTools.length > 0 ? ` · ${mcpTools.length} 个 MCP` : ''}
          </span>
        )}
      </div>
      <div className="content">
        {loading ? (
          <div className="empty-state">加载中...</div>
        ) : (
          <>
            <div className="group-title">内置工具</div>
            <div className="tool-grid">
              {builtinTools.map(renderCard)}
            </div>
            {mcpTools.length > 0 && (
              <>
                <div className="group-title">MCP 工具</div>
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
