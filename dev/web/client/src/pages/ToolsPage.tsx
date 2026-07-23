export default function ToolsPage() {
  const builtinTools = [
    { name: 'read', desc: '读取文件内容，支持文本文件与代码文件。', usage: '8.2K', perm: 'read', permLabel: '只读', rate: '99.8%', spark: [50,80,65,95,75,100,85] },
    { name: 'write', desc: '写入文件内容，创建或覆盖现有文件。', usage: '3.1K', perm: 'write', permLabel: '写入', rate: '99.2%', spark: [60,85,70,90,55,95,80] },
    { name: 'edit', desc: '编辑文件内容，精确替换指定文本。', usage: '2.8K', perm: 'write', permLabel: '写入', rate: '98.7%', spark: [45,70,55,85,65,90,75] },
    { name: 'bash', desc: '执行命令行操作，支持超时与审批拦截。', usage: '4.5K', perm: 'admin', permLabel: '管理员', rate: '97.8%', spark: [55,80,60,95,70,85,100] },
    { name: 'grep', desc: '搜索文件内容，支持正则表达式匹配。', usage: '6.3K', perm: 'read', permLabel: '只读', rate: '100%', spark: [70,90,80,100,85,95,90] },
    { name: 'glob', desc: '文件模式匹配，快速查找符合条件的文件。', usage: '5.7K', perm: 'read', permLabel: '只读', rate: '100%', spark: [65,85,75,95,80,90,100] },
    { name: 'webfetch', desc: '抓取网页内容，转为 Markdown 或纯文本。', usage: '1.9K', perm: 'read', permLabel: '只读', rate: '99.5%', spark: [40,60,50,75,55,85,70] },
    { name: 'websearch', desc: '搜索互联网，获取实时信息与资料。', usage: '1.4K', perm: 'read', permLabel: '只读', rate: '99.1%', spark: [35,55,45,70,50,80,60] },
  ]

  const mcpTools = [
    { name: 'context7_query', desc: '查询库文档（Context7 MCP 服务）。', source: 'context7' },
    { name: 'codegraph_search', desc: '代码知识图谱符号搜索。', source: 'codegraph' },
    { name: 'codegraph_explore', desc: '代码库结构化探索与调用链分析。', source: 'codegraph' },
  ]

  const renderToolCard = (tool: any, idx: number, isBuiltin: boolean = true) => (
    <div key={idx} className="tool-card">
      <div className="tool-header">
        <span className="tool-name">{tool.name}</span>
        <span className={`tool-source ${isBuiltin ? 'builtin' : 'mcp'}`}>
          {isBuiltin ? '内置' : 'MCP'}
        </span>
      </div>
      <div className="tool-desc">{tool.desc}</div>
      <div className="tool-meta">
        <span>{isBuiltin ? `使用 ${tool.usage} 次` : tool.source}</span>
        {isBuiltin && <span className="tool-rate">成功率 {tool.rate}</span>}
      </div>
    </div>
  )

  return (
    <main className="main">
      <div className="page-header">
        <span className="page-title">工具管理</span>
        <span style={{fontSize:12,color:'var(--ink-light)'}}>8 个内置 · 3 个 MCP</span>
      </div>
      <div className="content">
        <div className="group-title">内置工具</div>
        <div className="tool-grid">
          {builtinTools.map((tool, idx) => renderToolCard(tool, idx, true))}
        </div>

        <div className="group-title">MCP 工具</div>
        <div className="tool-grid">
          {mcpTools.map((tool, idx) => renderToolCard(tool, idx, false))}
        </div>
      </div>
    </main>
  )
}
