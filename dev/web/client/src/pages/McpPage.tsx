export default function McpPage() {
  const mcpServices = [
    {
      name: 'context7',
      status: 'connected',
      statusText: '已连接 (2)',
      cmd: 'npx -y @upstash/context7-mcp',
      tools: ['context7_resolve', 'context7_query'],
      uptime: '运行 3 天 12 小时',
      lastCall: '最后调用 2 分钟前',
      buttons: ['测试', '编辑', '禁用'],
    },
    {
      name: 'codegraph',
      status: 'connected',
      statusText: '已连接 (7)',
      cmd: 'codegraph mcp',
      tools: ['codegraph_search', 'codegraph_callers', 'codegraph_callees', 'codegraph_explore', 'codegraph_trace', 'codegraph_impact', 'codegraph_status'],
      uptime: '运行 3 天 12 小时',
      lastCall: '最后调用 5 分钟前',
      buttons: ['测试', '编辑', '禁用'],
    },
    {
      name: 'filesystem',
      status: 'failed',
      statusText: '连接失败',
      cmd: 'npx -y @modelcontextprotocol/server-filesystem C:\\workspace',
      error: 'Error: spawn npx ENOENT',
      buttons: ['重试', '编辑', '删除'],
    },
    {
      name: 'playwright',
      status: 'disabled',
      statusText: '已禁用',
      cmd: 'npx -y @playwright/mcp@latest',
      buttons: ['启用', '编辑', '删除'],
      disabled: true,
    },
  ]

  return (
    <main className="main">
      <div className="page-header">
        <span className="page-title">MCP 服务</span>
        <div className="header-actions">
          <button className="btn">导入 JSON</button>
          <button className="btn primary">+ 添加服务</button>
        </div>
      </div>
      <div className="content">
        <div className="mcp-list">
          {mcpServices.map((service, idx) => (
            <div key={idx} className="mcp-card" style={service.disabled ? {opacity:0.6} : undefined}>
              <div className="mcp-header">
                <span className="mcp-name">{service.name}</span>
                <span className={`mcp-status ${service.status}`}>{service.statusText}</span>
                {service.buttons.map((btn, i) => (
                  <button key={i} className="btn sm">{btn}</button>
                ))}
              </div>
              <div className="mcp-cmd">{service.cmd}</div>
              {service.tools && (
                <div className="mcp-tools">
                  {service.tools.map((tool, i) => (
                    <span key={i} className="mcp-tool-tag">{tool}</span>
                  ))}
                </div>
              )}
              {service.error && (
                <div style={{fontSize:11,color:'var(--cinnabar)',marginBottom:8}}>{service.error}</div>
              )}
              {service.uptime && (
                <div className="mcp-foot">
                  <span className="mcp-uptime">{service.uptime}</span>
                  <span className="mcp-last">{service.lastCall}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}
