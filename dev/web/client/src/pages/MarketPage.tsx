export default function MarketPage() {
  const categories = ['全部', '文档与办公', '开发与测试', '设计与创意', '数据与分析', '搜索与研究', '自动化', '安全', '写作']

  return (
    <main className="main">
      <div className="page-header">
        <span className="page-title">星河</span>
        <div className="header-search"><input placeholder="搜索角色、技能、MCP 服务..."/></div>
      </div>

      <div className="content">
        {/* 横幅 */}
        <div className="banner gold">
          <div>
            <div className="banner-text">🌟 发现更多可能</div>
            <div className="banner-sub">探索星河中精选的角色、技能与工具，提升你的 AI 体验</div>
          </div>
          <button className="banner-btn">立即探索</button>
        </div>

        {/* 本周热门总榜 */}
        <div className="section-header">
          <div className="section-title">🔥 本周热门总榜</div>
        </div>
        <div className="hot-grid">
          <div className="hot-card"><span className="hot-rank top">1</span><div className="hot-info"><div className="hot-name">Deep Research</div><div className="hot-meta">技能 · 深度研究</div></div><span className="hot-installs">1.2K</span></div>
          <div className="hot-card"><span className="hot-rank top">2</span><div className="hot-info"><div className="hot-name">长庚</div><div className="hot-meta">角色 · 日常执事</div></div><span className="hot-installs">986</span></div>
          <div className="hot-card"><span className="hot-rank top">3</span><div className="hot-info"><div className="hot-name">Context7</div><div className="hot-meta">MCP · 库文档查询</div></div><span className="hot-installs">874</span></div>
          <div className="hot-card"><span className="hot-rank">4</span><div className="hot-info"><div className="hot-name">Code Review Pro</div><div className="hot-meta">技能 · 代码审查</div></div><span className="hot-installs">652</span></div>
          <div className="hot-card"><span className="hot-rank">5</span><div className="hot-info"><div className="hot-name">Playwright</div><div className="hot-meta">MCP · 浏览器自动化</div></div><span className="hot-installs">543</span></div>
          <div className="hot-card"><span className="hot-rank">6</span><div className="hot-info"><div className="hot-name">自动化测试</div><div className="hot-meta">技能 · 测试用例生成</div></div><span className="hot-installs">421</span></div>
          <div className="hot-card"><span className="hot-rank">7</span><div className="hot-info"><div className="hot-name">数据分析工具</div><div className="hot-meta">工具 · CSV/Excel</div></div><span className="hot-installs">342</span></div>
          <div className="hot-card"><span className="hot-rank">8</span><div className="hot-info"><div className="hot-name">天璇</div><div className="hot-meta">角色 · 代码工匠</div></div><span className="hot-installs">312</span></div>
          <div className="hot-card"><span className="hot-rank">9</span><div className="hot-info"><div className="hot-name">CodeGraph</div><div className="hot-meta">MCP · 代码图谱</div></div><span className="hot-installs">287</span></div>
          <div className="hot-card"><span className="hot-rank">10</span><div className="hot-info"><div className="hot-name">Brave Search</div><div className="hot-meta">MCP · 隐私搜索</div></div><span className="hot-installs">201</span></div>
        </div>

        {/* 单项热门 */}
        <div className="section-header">
          <div className="section-title">📊 单项热门</div>
        </div>

        <div style={{marginBottom:20}}>
          <div style={{fontSize: 'calc(12px * var(--ui-font-scale))',fontWeight:600,color:'var(--ink-light)',marginBottom:8}}>🎭 角色</div>
          <div style={{display:'flex',gap:10,overflowX:'auto',paddingBottom:4,scrollbarWidth:'none'}}>
            <div className="popular-card"><div className="popular-card-img" style={{background:'linear-gradient(135deg,rgba(200,150,10,0.1),rgba(200,150,10,0.03))'}}>🌟</div><div className="popular-card-body"><div className="popular-card-name">长庚</div><div className="popular-card-meta">暮星 · 日常执事</div><div className="popular-card-stat">💬 986</div></div></div>
            <div className="popular-card"><div className="popular-card-img" style={{background:'linear-gradient(135deg,rgba(37,99,235,0.1),rgba(37,99,235,0.03))'}}>⚙️</div><div className="popular-card-body"><div className="popular-card-name">天璇</div><div className="popular-card-meta">天玑 · 代码工匠</div><div className="popular-card-stat">💬 312</div></div></div>
            <div className="popular-card"><div className="popular-card-img" style={{background:'linear-gradient(135deg,rgba(5,150,105,0.1),rgba(5,150,105,0.03))'}}>📝</div><div className="popular-card-body"><div className="popular-card-name">文曲</div><div className="popular-card-meta">文华 · 掌墨使</div><div className="popular-card-stat">💬 256</div></div></div>
            <div className="popular-card"><div className="popular-card-img" style={{background:'linear-gradient(135deg,rgba(124,58,237,0.1),rgba(124,58,237,0.03))'}}>👑</div><div className="popular-card-body"><div className="popular-card-name">紫微</div><div className="popular-card-meta">帝星 · 万能中枢</div><div className="popular-card-stat">💬 189</div></div></div>
          </div>
        </div>

        <div style={{marginBottom:20}}>
          <div style={{fontSize: 'calc(12px * var(--ui-font-scale))',fontWeight:600,color:'var(--ink-light)',marginBottom:8}}>⚡ 技能</div>
          <div style={{display:'flex',gap:10,overflowX:'auto',paddingBottom:4,scrollbarWidth:'none'}}>
            <div className="popular-card"><div className="popular-card-img" style={{background:'linear-gradient(135deg,rgba(200,150,10,0.1),rgba(200,150,10,0.03))'}}>🔬</div><div className="popular-card-body"><div className="popular-card-name">Deep Research</div><div className="popular-card-meta">深度研究与多源整合</div><div className="popular-card-stat">⬇ 1.2K</div></div></div>
            <div className="popular-card"><div className="popular-card-img" style={{background:'linear-gradient(135deg,rgba(42,157,92,0.1),rgba(42,157,92,0.03))'}}>🔍</div><div className="popular-card-body"><div className="popular-card-name">Code Review Pro</div><div className="popular-card-meta">多维度代码审查</div><div className="popular-card-stat">⬇ 652</div></div></div>
            <div className="popular-card"><div className="popular-card-img" style={{background:'linear-gradient(135deg,rgba(37,99,235,0.1),rgba(37,99,235,0.03))'}}>🧪</div><div className="popular-card-body"><div className="popular-card-name">自动化测试</div><div className="popular-card-meta">测试用例生成</div><div className="popular-card-stat">⬇ 421</div></div></div>
            <div className="popular-card"><div className="popular-card-img" style={{background:'linear-gradient(135deg,rgba(124,58,237,0.1),rgba(124,58,237,0.03))'}}>🎨</div><div className="popular-card-body"><div className="popular-card-name">UI Design</div><div className="popular-card-meta">UI/UX 设计助手</div><div className="popular-card-stat">⬇ 234</div></div></div>
          </div>
        </div>

        <div style={{marginBottom:28}}>
          <div style={{fontSize:12,fontWeight:600,color:'var(--ink-light)',marginBottom:8}}>🔗 MCP</div>
          <div style={{display:'flex',gap:10,overflowX:'auto',paddingBottom:4,scrollbarWidth:'none'}}>
            <div className="popular-card"><div className="popular-card-img" style={{background:'linear-gradient(135deg,rgba(14,165,233,0.1),rgba(14,165,233,0.03))'}}>📖</div><div className="popular-card-body"><div className="popular-card-name">Context7</div><div className="popular-card-meta">库文档查询</div><div className="popular-card-stat">⬇ 874</div></div></div>
            <div className="popular-card"><div className="popular-card-img" style={{background:'linear-gradient(135deg,rgba(5,150,105,0.1),rgba(5,150,105,0.03))'}}>🎭</div><div className="popular-card-body"><div className="popular-card-name">Playwright</div><div className="popular-card-meta">浏览器自动化</div><div className="popular-card-stat">⬇ 543</div></div></div>
            <div className="popular-card"><div className="popular-card-img" style={{background:'linear-gradient(135deg,rgba(37,99,235,0.1),rgba(37,99,235,0.03))'}}>🔍</div><div className="popular-card-body"><div className="popular-card-name">CodeGraph</div><div className="popular-card-meta">代码知识图谱</div><div className="popular-card-stat">⬇ 287</div></div></div>
            <div className="popular-card"><div className="popular-card-img" style={{background:'linear-gradient(135deg,rgba(245,158,11,0.1),rgba(245,158,11,0.03))'}}>🌐</div><div className="popular-card-body"><div className="popular-card-name">Brave Search</div><div className="popular-card-meta">隐私搜索引擎</div><div className="popular-card-stat">⬇ 201</div></div></div>
          </div>
        </div>

        {/* 试试这些 */}
        <div className="section-header">
          <div className="section-title">💡 试试这些</div>
        </div>
        <div className="try-grid">
          <div className="try-card"><div className="try-icon" style={{background:'rgba(200,150,10,0.08)'}}>📝</div><div><div className="try-name">写技术文档</div><div className="try-desc">与文档管家协作</div></div></div>
          <div className="try-card"><div className="try-icon" style={{background:'rgba(37,99,235,0.08)'}}>🔍</div><div><div className="try-name">代码审查</div><div className="try-desc">让 Code Review Pro 帮你</div></div></div>
          <div className="try-card"><div className="try-icon" style={{background:'rgba(42,157,92,0.08)'}}>📊</div><div><div className="try-name">数据分析</div><div className="try-desc">用分析工具处理数据</div></div></div>
          <div className="try-card"><div className="try-icon" style={{background:'rgba(124,58,237,0.08)'}}>🌐</div><div><div className="try-name">网页研究</div><div className="try-desc">Deep Research 深度调研</div></div></div>
        </div>

        {/* 分类标签 */}
        <div className="category-scroll">
          {categories.map((cat, idx) => (
            <button key={idx} className={`cat-tag ${idx === 0 ? 'active' : ''}`}>{cat}</button>
          ))}
        </div>

        {/* 角色 */}
        <div className="section-header">
          <div className="section-title">🎭 角色</div>
          <span className="section-more">查看更多 →</span>
        </div>
        <div className="grid">
          <div className="card">
            <div className="card-img" style={{background:'linear-gradient(135deg,rgba(200,150,10,0.12),rgba(200,150,10,0.04))'}}>🌟</div>
            <div className="card-body">
              <div className="card-title">长庚</div>
              <div className="card-author">暮星 · 日常执事</div>
              <div className="card-desc">温润如玉的青衫书生，擅长日常事务处理与文件管理。性格温和，做事细致。</div>
              <div className="card-tags"><span className="card-tag character">角色</span><span className="card-tag verified">已验证</span><span className="card-tag lore">+Lore</span></div>
              <div className="card-footer"><span>💬 986</span><span>⭐ 4.8</span><button className="card-action installed">已安装</button></div>
            </div>
          </div>
          <div className="card">
            <div className="card-img" style={{background:'linear-gradient(135deg,rgba(37,99,235,0.12),rgba(37,99,235,0.04))'}}>⚙️</div>
            <div className="card-body">
              <div className="card-title">天璇</div>
              <div className="card-author">天玑 · 代码工匠</div>
              <div className="card-desc">理性冷静的工程师，专注于代码编写与调试。逻辑严密，效率至上。</div>
              <div className="card-tags"><span className="card-tag character">角色</span><span className="card-tag verified">已验证</span><span className="card-tag lore">+Lore</span></div>
              <div className="card-footer"><span>💬 312</span><span>⭐ 4.7</span><button className="card-action installed">已安装</button></div>
            </div>
          </div>
          <div className="card">
            <div className="card-img" style={{background:'linear-gradient(135deg,rgba(200,150,10,0.12),rgba(200,150,10,0.04))'}}>📚</div>
            <div className="card-body">
              <div className="card-title">文档管家</div>
              <div className="card-author">by 社区</div>
              <div className="card-desc">专注文档写作与整理的角色，擅长技术文档、博客、报告等长文写作。</div>
              <div className="card-tags"><span className="card-tag character">角色</span><span className="card-tag">写作</span><span className="card-tag">Plan</span></div>
              <div className="card-footer"><span>💬 256</span><span>⭐ 4.4</span><button className="card-action">安装</button></div>
            </div>
          </div>
        </div>

        {/* 技能 */}
        <div className="section-header">
          <div className="section-title">⚡ 技能</div>
          <span className="section-more">查看更多 →</span>
        </div>
        <div className="grid">
          <div className="card">
            <div className="card-img" style={{background:'linear-gradient(135deg,rgba(200,150,10,0.12),rgba(200,150,10,0.04))'}}>🔬</div>
            <div className="card-body">
              <div className="card-title">Deep Research</div>
              <div className="card-author">by 天枢团队</div>
              <div className="card-desc">深度研究技能，支持多源信息整合、交叉验证、自动生成结构化报告。</div>
              <div className="card-tags"><span className="card-tag skill">技能</span><span className="card-tag verified">已验证</span><span className="card-tag new">NEW</span></div>
              <div className="card-footer"><span>⬇ 1.2K</span><span>⭐ 4.8</span><button className="card-action installed">已安装</button></div>
            </div>
          </div>
          <div className="card">
            <div className="card-img" style={{background:'linear-gradient(135deg,rgba(42,157,92,0.12),rgba(42,157,92,0.04))'}}>🔍</div>
            <div className="card-body">
              <div className="card-title">Code Review Pro</div>
              <div className="card-author">by 天枢团队</div>
              <div className="card-desc">多维度代码审查，支持安全漏洞检测、性能分析、代码风格检查。</div>
              <div className="card-tags"><span className="card-tag skill">技能</span><span className="card-tag verified">已验证</span></div>
              <div className="card-footer"><span>⬇ 652</span><span>⭐ 4.7</span><button className="card-action">安装</button></div>
            </div>
          </div>
          <div className="card">
            <div className="card-img" style={{background:'linear-gradient(135deg,rgba(37,99,235,0.12),rgba(37,99,235,0.04))'}}>🧪</div>
            <div className="card-body">
              <div className="card-title">自动化测试</div>
              <div className="card-author">by 天枢团队</div>
              <div className="card-desc">自动生成测试用例，支持单元测试、集成测试、端到端测试。</div>
              <div className="card-tags"><span className="card-tag skill">技能</span><span className="card-tag verified">已验证</span></div>
              <div className="card-footer"><span>⬇ 421</span><span>⭐ 4.5</span><button className="card-action">安装</button></div>
            </div>
          </div>
        </div>

        {/* MCP 服务 */}
        <div className="section-header">
          <div className="section-title">🔗 MCP 服务</div>
          <span className="section-more">查看更多 →</span>
        </div>
        <div className="grid">
          <div className="card">
            <div className="card-img" style={{background:'linear-gradient(135deg,rgba(14,165,233,0.12),rgba(14,165,233,0.04))'}}>📖</div>
            <div className="card-body">
              <div className="card-title">Context7</div>
              <div className="card-author">by context7.ai</div>
              <div className="card-desc">实时查询库文档，获取最新 API 参考与使用示例。</div>
              <div className="card-tags"><span className="card-tag mcp">MCP</span><span className="card-tag verified">已验证</span></div>
              <div className="card-footer"><span>⬇ 874</span><span>⭐ 4.9</span><button className="card-action">安装</button></div>
            </div>
          </div>
          <div className="card">
            <div className="card-img" style={{background:'linear-gradient(135deg,rgba(5,150,105,0.12),rgba(5,150,105,0.04))'}}>🎭</div>
            <div className="card-body">
              <div className="card-title">Playwright</div>
              <div className="card-author">by Microsoft</div>
              <div className="card-desc">浏览器自动化，支持页面导航、截图、E2E 测试。</div>
              <div className="card-tags"><span className="card-tag mcp">MCP</span><span className="card-tag verified">已验证</span></div>
              <div className="card-footer"><span>⬇ 543</span><span>⭐ 4.8</span><button className="card-action">安装</button></div>
            </div>
          </div>
          <div className="card">
            <div className="card-img" style={{background:'linear-gradient(135deg,rgba(37,99,235,0.12),rgba(37,99,235,0.04))'}}>🔍</div>
            <div className="card-body">
              <div className="card-title">CodeGraph</div>
              <div className="card-author">by 天枢团队</div>
              <div className="card-desc">代码知识图谱，支持符号搜索、调用链追踪。</div>
              <div className="card-tags"><span className="card-tag mcp">MCP</span><span className="card-tag verified">已验证</span></div>
              <div className="card-footer"><span>⬇ 287</span><span>⭐ 4.7</span><button className="card-action">安装</button></div>
            </div>
          </div>
        </div>

        {/* 工具 */}
        <div className="section-header">
          <div className="section-title">🔧 工具</div>
          <span className="section-more">查看更多 →</span>
        </div>
        <div className="grid">
          <div className="card">
            <div className="card-img" style={{background:'linear-gradient(135deg,rgba(42,157,92,0.12),rgba(42,157,92,0.04))'}}>📊</div>
            <div className="card-body">
              <div className="card-title">数据分析工具</div>
              <div className="card-author">by 天枢团队</div>
              <div className="card-desc">CSV/Excel 数据处理与可视化，自动生成图表。</div>
              <div className="card-tags"><span className="card-tag tool">工具</span><span className="card-tag verified">已验证</span></div>
              <div className="card-footer"><span>⬇ 342</span><span>⭐ 4.5</span><button className="card-action">安装</button></div>
            </div>
          </div>
          <div className="card">
            <div className="card-img" style={{background:'linear-gradient(135deg,rgba(245,158,11,0.12),rgba(245,158,11,0.04))'}}>🌐</div>
            <div className="card-body">
              <div className="card-title">网页抓取工具</div>
              <div className="card-author">by 社区</div>
              <div className="card-desc">增强版网页抓取，支持 JS 渲染、批量抓取。</div>
              <div className="card-tags"><span className="card-tag tool">工具</span></div>
              <div className="card-footer"><span>⬇ 198</span><span>⭐ 4.3</span><button className="card-action">安装</button></div>
            </div>
          </div>
          <div className="card">
            <div className="card-img" style={{background:'linear-gradient(135deg,rgba(196,92,60,0.12),rgba(196,92,60,0.04))'}}>📁</div>
            <div className="card-body">
              <div className="card-title">文件管理工具</div>
              <div className="card-author">by 社区</div>
              <div className="card-desc">批量文件操作，支持重命名、格式转换。</div>
              <div className="card-tags"><span className="card-tag tool">工具</span></div>
              <div className="card-footer"><span>⬇ 156</span><span>⭐ 4.2</span><button className="card-action">安装</button></div>
            </div>
          </div>
        </div>

      </div>
    </main>
  )
}
