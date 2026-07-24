import { useState, useEffect } from 'react'
import {
  fetchTools,
  createMCPServer,
  updateMCPServer,
  deleteMCPServer,
  testMCPConnection,
  type MCPServer,
  type MCPTestResult,
  type MCPConnectionStatus,
} from '@/api/tools'

export default function McpView() {
  const [servers, setServers] = useState<MCPServer[]>([])
  const [statuses, setStatuses] = useState<Record<string, MCPConnectionStatus>>({})
  const [loading, setLoading] = useState(true)

  const [showImport, setShowImport] = useState(false)
  const [importJson, setImportJson] = useState('')
  const [importError, setImportError] = useState('')

  const [editing, setEditing] = useState<{
    id?: string
    name: string
    command: string
    args: string
    env: string
    cwd: string
    timeout: number
  } | null>(null)

  const [testingMap, setTestingMap] = useState<Record<string, boolean>>({})
  const [testResults, setTestResults] = useState<Record<string, MCPTestResult>>({})

  async function load() {
    try {
      const data = await fetchTools()
      setServers(data.mcpServers)
      setStatuses(data.mcpStatuses || {})
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  function statusOf(s: MCPServer): MCPConnectionStatus | null {
    return s.status ?? statuses[s.name] ?? null
  }

  function statusLabel(s: MCPServer): string {
    const st = statusOf(s)
    if (!st) return ''
    if (st.status === 'connected') return `已连接 (${st.toolsCount})`
    if (st.status === 'disabled') return '已禁用'
    if (st.status === 'failed') return `失败: ${st.error}`
    if (st.status === 'connecting') return '连接中...'
    return ''
  }

  async function handleTest(id: string) {
    setTestingMap(prev => ({ ...prev, [id]: true }))
    setTestResults(prev => { const n = { ...prev }; delete n[id]; return n })
    try {
      const result = await testMCPConnection(id)
      setTestResults(prev => ({ ...prev, [id]: result }))
    } finally {
      setTestingMap(prev => ({ ...prev, [id]: false }))
      load()
    }
  }

  function openNew() {
    setEditing({ name: '', command: '', args: '', env: '', cwd: '', timeout: 60 })
  }

  function openEdit(s: MCPServer) {
    setEditing({
      id: s.id,
      name: s.name,
      command: s.command,
      args: (s.args || []).join(' '),
      env: Object.entries(s.env || {}).map(([k, v]) => `${k}=${v}`).join('\n'),
      cwd: s.cwd || '',
      timeout: s.timeout || 60,
    })
  }

  async function handleSave() {
    if (!editing) return
    const args = editing.args ? editing.args.split(/\s+/).filter(Boolean) : []
    const env: Record<string, string> = {}
    for (const line of editing.env.split('\n')) {
      const eq = line.indexOf('=')
      if (eq > 0) env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
    }
    const data: Record<string, unknown> = { name: editing.name, command: editing.command, args, env }
    if (editing.cwd) data.cwd = editing.cwd
    if (editing.timeout) data.timeout = editing.timeout
    if (editing.id) {
      await updateMCPServer(editing.id, data)
    } else {
      await createMCPServer(data)
    }
    setEditing(null)
    load()
  }

  async function handleDelete(id: string) {
    if (!confirm('确定删除此 MCP 服务器？')) return
    await deleteMCPServer(id)
    setServers(prev => prev.filter(s => s.id !== id))
  }

  async function handleImport() {
    setImportError('')
    try {
      const data = JSON.parse(importJson)
      if (!data.command) { setImportError('缺少 command 字段'); return }
      await createMCPServer({
        name: data.name || data.command,
        command: data.command,
        args: data.args || [],
        env: data.env || {},
        cwd: data.cwd,
        timeout: data.timeout,
      })
      setShowImport(false)
      setImportJson('')
      load()
    } catch {
      setImportError('无效的 JSON 格式')
    }
  }

  return (
    <div className="main">
      <div className="page-header">
        <span className="page-title">MCP 服务</span>
        <div className="header-actions">
          <button className="btn" onClick={() => setShowImport(true)}>导入 JSON</button>
          <button className="btn primary" onClick={openNew}>+ 添加服务</button>
        </div>
      </div>
      <div className="content">
        <div className="mcp-list">
          {loading ? (
            <div className="empty-state">加载中...</div>
          ) : servers.length === 0 ? (
            <div className="empty-state">
              <div className="empty-title">暂无 MCP 服务器</div>
              <div className="empty-hint">点击「添加服务」或「导入 JSON」来添加一个</div>
            </div>
          ) : (
            servers.map(s => {
              const st = statusOf(s)
              return (
                <div key={s.id} className="mcp-card">
                  <div className="mcp-header">
                    <span className="mcp-name">{s.name}</span>
                    {st && (
                      <span className={`mcp-status ${st.status}`}>{statusLabel(s)}</span>
                    )}
                    <button className="btn sm" disabled={testingMap[s.id]} onClick={() => handleTest(s.id)}>
                      {testingMap[s.id] ? '测试中...' : '测试'}
                    </button>
                    <button className="btn sm" onClick={() => openEdit(s)}>编辑</button>
                    <button className="btn sm danger" onClick={() => handleDelete(s.id)}>删除</button>
                  </div>
                  <div className="mcp-cmd">
                    {s.command} {s.args?.join(' ')}
                  </div>
                  {s.env && Object.keys(s.env).length > 0 && (
                    <div className="mcp-tools">
                      {Object.entries(s.env).map(([k, v]) => (
                        <span key={k} className="mcp-tool-tag">{k}={v}</span>
                      ))}
                    </div>
                  )}
                  {testResults[s.id] && (
                    <>
                      <div style={{
                        fontSize: 11,
                        padding: '4px 8px',
                        borderRadius: 4,
                        marginTop: 6,
                        background: testResults[s.id].ok ? 'rgba(42,157,92,0.08)' : 'rgba(196,92,60,0.08)',
                        color: testResults[s.id].ok ? 'var(--jade)' : 'var(--cinnabar)',
                      }}>
                        {testResults[s.id].ok
                          ? `连接成功（${testResults[s.id].toolCount} 个工具）`
                          : `测试失败: ${testResults[s.id].error}`}
                      </div>
                      {testResults[s.id].tools && testResults[s.id].tools!.length > 0 && (
                        <div className="mcp-tools">
                          {testResults[s.id].tools!.map(t => (
                            <span key={t.name} className="mcp-tool-tag" title={t.description}>{t.name}</span>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Import modal */}
      {showImport && (
        <div className="approval-overlay" onClick={() => setShowImport(false)}>
          <div className="approval-dialog" onClick={e => e.stopPropagation()} style={{ width: 480 }}>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>导入 MCP 配置</div>
            <p style={{ fontSize: 12, color: 'var(--ink-light)', margin: '-4px 0 12px' }}>
              粘贴 MCP 服务器 JSON 配置：
            </p>
            <textarea
              value={importJson}
              onChange={e => setImportJson(e.target.value)}
              placeholder={'{\n  "name": "Filesystem",\n  "command": "npx",\n  "args": ["-y", "server-package", "/tmp"],\n  "env": {"API_KEY": "xxx"}\n}'}
              rows={8}
              style={{
                width: '100%',
                padding: 8,
                border: '1px solid var(--border)',
                borderRadius: 6,
                fontSize: 13,
                fontFamily: 'inherit',
                background: 'var(--bg-input)',
                color: 'var(--ink-deep)',
                resize: 'vertical',
                boxSizing: 'border-box',
              }}
            />
            {importError && (
              <p style={{ fontSize: 12, color: 'var(--cinnabar)', margin: '6px 0 0' }}>{importError}</p>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setShowImport(false)}>取消</button>
              <button className="btn primary" onClick={handleImport}>导入</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit / New modal */}
      {editing && (
        <div className="approval-overlay" onClick={() => setEditing(null)}>
          <div className="approval-dialog" onClick={e => e.stopPropagation()} style={{ width: 480 }}>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>
              {editing.id ? '编辑 MCP 服务器' : '新建 MCP 服务器'}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={labelStyle}>名称</label>
                <input
                  value={editing.name}
                  onChange={e => setEditing({ ...editing, name: e.target.value })}
                  placeholder="例如：Filesystem"
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>命令</label>
                <input
                  value={editing.command}
                  onChange={e => setEditing({ ...editing, command: e.target.value })}
                  placeholder="例如：npx"
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>参数</label>
                <input
                  value={editing.args}
                  onChange={e => setEditing({ ...editing, args: e.target.value })}
                  placeholder="例如：-y @modelcontextprotocol/server-filesystem /tmp"
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>环境变量（每行一个 KEY=VALUE）</label>
                <textarea
                  value={editing.env}
                  onChange={e => setEditing({ ...editing, env: e.target.value })}
                  placeholder="API_KEY=xxx\nBASE_URL=http://..."
                  rows={3}
                  style={{ ...inputStyle, resize: 'vertical' }}
                />
              </div>
              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>工作目录 (cwd)</label>
                  <input
                    value={editing.cwd}
                    onChange={e => setEditing({ ...editing, cwd: e.target.value })}
                    placeholder="可选，留空用项目根目录"
                    style={inputStyle}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>超时 (秒)</label>
                  <input
                    type="number"
                    value={editing.timeout}
                    onChange={e => setEditing({ ...editing, timeout: Number(e.target.value) })}
                    placeholder="默认 60"
                    style={inputStyle}
                  />
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setEditing(null)}>取消</button>
              <button className="btn primary" onClick={handleSave}>保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  color: 'var(--ink-light)',
  marginBottom: 4,
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid var(--border)',
  borderRadius: 6,
  fontSize: 13,
  fontFamily: 'inherit',
  background: 'var(--bg-input)',
  color: 'var(--ink-deep)',
  outline: 'none',
  boxSizing: 'border-box',
}
