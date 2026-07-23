import { useState, useEffect } from 'react'
import CharacterDetailPage from './pages/CharacterDetailPage'
import SkillsPage from './pages/SkillsPage'
import SkillDetailPage from './pages/SkillDetailPage'
import ToolsPage from './pages/ToolsPage'
import McpPage from './pages/McpPage'
import KnowledgePage from './pages/KnowledgePage'
import MarketPage from './pages/MarketPage'
import EventsPage from './pages/EventsPage'
import SettingsPage from './pages/SettingsPage'
import HomePage from './pages/HomePage'

type Page = 'home' | 'chat' | 'characters' | 'character-detail' | 'skills' | 'skill-detail' | 'tools' | 'events' | 'market' | 'mcp' | 'knowledge' | 'settings'

const PAGE_MAP: Record<string, Page> = {
  '/': 'home',
  '/home': 'home',
  '/chat': 'chat',
  '/characters': 'characters',
  '/skills': 'skills',
  '/tools': 'tools',
  '/events': 'events',
  '/market': 'market',
  '/mcp': 'mcp',
  '/knowledge': 'knowledge',
  '/settings': 'settings',
}

const REVERSE_MAP: Record<Page, string> = {
  home: '/home',
  chat: '/chat',
  characters: '/characters',
  'character-detail': '/character-detail',
  skills: '/skills',
  'skill-detail': '/skill-detail',
  tools: '/tools',
  events: '/events',
  market: '/market',
  mcp: '/mcp',
  knowledge: '/knowledge',
  settings: '/settings',
}

function getPageFromPath(path: string): Page {
  return PAGE_MAP[path] || 'chat'
}

export default function App() {
  const [currentPage, setCurrentPage] = useState<Page>(() => getPageFromPath(window.location.pathname))

  useEffect(() => {
    const handlePopState = () => {
      setCurrentPage(getPageFromPath(window.location.pathname))
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  const navigate = (page: Page) => {
    const path = REVERSE_MAP[page]
    window.history.pushState({}, '', path)
    setCurrentPage(page)
  }

  const navItems: { id: Page; icon: string; label: string; badge?: number }[] = [
    { id: 'chat', icon: '💬', label: '会话' },
    { id: 'characters', icon: '🎭', label: '角色' },
    { id: 'skills', icon: '⚡', label: '技能' },
    { id: 'tools', icon: '🔧', label: '工具' },
    { id: 'mcp', icon: '🔗', label: 'MCP' },
    { id: 'knowledge', icon: '📚', label: '知识' },
    { id: 'market', icon: '🏪', label: '市场' },
  ]

  const [showRightPanel, setShowRightPanel] = useState(true)
  const [showFilePanel, setShowFilePanel] = useState(false)

  const renderContent = () => {
    switch (currentPage) {
      case 'home':
        return <HomePage />

      case 'chat':
        return (
          <>
            <aside className="ctx-panel">
              <div className="ctx-header"><span className="ctx-title">会话</span></div>
              <div className="ctx-search"><input placeholder="搜索会话..."/></div>
              <div className="add-btn">+ 新建项目</div>
              <div className="ctx-body">
                <div className="project-item">
                  <div className="project-header active">
                    <span className="project-icon">📁</span><span className="project-name">Yi-Lin 开发</span><span className="project-arrow open">▶</span>
                  </div>
                  <div className="project-children">
                    <div className="session-item active"><div className="session-dot chat"></div><div className="session-info"><div className="session-title">前端优化方案</div><div className="session-meta"><span>刚刚</span><span className="session-badge">天璇</span></div></div></div>
                    <div className="session-item"><div className="session-dot chat"></div><div className="session-info"><div className="session-title">UI 设计讨论</div><div className="session-meta"><span>2小时前</span></div></div></div>
                    <div className="session-item subsession-item"><div className="session-dot chat"></div><div className="session-info"><div className="session-title">代码审查</div><div className="session-meta"><span>子会话 · 1小时前</span></div></div></div>
                    <div className="session-item subsession-item"><div className="session-dot chat"></div><div className="session-info"><div className="session-title">Bug 修复</div><div className="session-meta"><span>子会话 · 30分钟前</span></div></div></div>
                    <div className="session-item"><div className="session-dot event"></div><div className="session-info"><div className="session-title">自动测试执行</div><div className="session-meta"><span>15:28</span><span className="session-badge">事件</span></div></div></div>
                  </div>
                </div>
                <div className="project-item">
                  <div className="project-header"><span className="project-icon">📁</span><span className="project-name">LeAgent 研究</span><span className="project-arrow">▶</span></div>
                </div>
                <div className="project-item">
                  <div className="project-header"><span className="project-icon">📁</span><span className="project-name">日常杂务</span><span className="project-arrow">▶</span></div>
                </div>
                <div className="ctx-divider"></div>
                <div className="event-group">
                  <div className="event-group-title">事件</div>
                  <div className="session-item"><div className="session-dot event"></div><div className="session-info"><div className="session-title">代码审查 - main</div><div className="session-meta"><span>等待执行</span></div></div></div>
                  <div className="session-item"><div className="session-dot" style={{background:'var(--star-tianxuan)'}}></div><div className="session-info"><div className="session-title">UI 优化自动测试</div><div className="session-meta"><span>执行中 · 12分钟</span></div></div></div>
                </div>
              </div>
            </aside>
            <main className="main">
              <div className="route-bar" style={{display:'none'}}><span className="route-text"></span><div className="meteor"></div></div>
              <div style={{flex:1,display:'flex',flexDirection:'column',minWidth:0,overflow:'hidden'}}>
                <div className="input-top-bar">
                  <button className="menu-btn" title="展开/收起侧栏">☰</button>
                  <span className="session-name">前端优化方案</span>
                  <button className="top-btn" title="编辑会话名">⋯</button>
                  <div style={{flex:1}}></div>
                  <button className={`top-btn ${showRightPanel ? 'active' : ''}`} onClick={() => setShowRightPanel(!showRightPanel)} title="星官详情">👤</button>
                  <button className={`top-btn ${showFilePanel ? 'active' : ''}`} onClick={() => setShowFilePanel(!showFilePanel)} title="文件">📁</button>
                </div>
                <div className="chat-scroll">
                  <div className="msg-group star">
                    <div className="msg-sender"><span className="star-icon">🌟</span><span className="star-name" style={{color:'var(--star-changgeng)'}}>长庚</span><span className="star-title">· 日常执事</span></div>
                    <div className="msg-bubble">暮色入牖，阿曜今日辛劳。今日有待办三件，一封邮件需回复。要先处理哪个？</div>
                    <div className="msg-time">14:30</div>
                  </div>
                  <div className="msg-group user">
                    <div className="msg-bubble">帮我写个脚本，把CSV里第三列的数据取出来绘制折线图</div>
                    <div className="msg-time">14:32</div>
                  </div>
                  <div className="msg-group star">
                    <div className="msg-sender"><span className="star-icon">⚙️</span><span className="star-name" style={{color:'var(--star-tianxuan)'}}>天璇</span><span className="star-title">· 代码工匠</span></div>
                    <div className="thinking-block"><div className="th-header">◈ 思考中 · 2.3s</div>用户在处理 CSV 数据分析任务，需要读取文件、提取第三列、调用绘图库。</div>
                    <div className="msg-bubble">好的，让我先看看数据结构。</div>
                    <div className="msg-time">14:33</div>
                  </div>
                  <div className="msg-group star">
                    <div className="msg-sender"><span className="star-icon">⚙️</span><span className="star-name" style={{color:'var(--star-tianxuan)'}}>天璇</span></div>
                    <div><span className="tool-tag success"><span>📄</span> read · ✓ 成功 <span className="expand-icon">▶</span></span>
                    <div style={{fontSize:11,color:'var(--ink-light)',marginTop:2}}>C:\Data\sales.csv (1,204 rows)</div></div>
                    <div className="msg-time">14:33</div>
                  </div>
                  <div className="msg-group star">
                    <div className="msg-sender"><span className="star-icon">⚙️</span><span className="star-name" style={{color:'var(--star-tianxuan)'}}>天璇</span></div>
                    <div className="msg-bubble">结构清楚了。第三列是销售额，我用 matplotlib 画图。</div>
                    <div className="msg-time">14:33</div>
                  </div>
                  <div className="msg-group star">
                    <div className="msg-sender"><span className="star-icon">⚙️</span><span className="star-name" style={{color:'var(--star-tianxuan)'}}>天璇</span></div>
                    <div><span className="tool-tag success"><span>✏️</span> write · ✓ 成功 <span className="expand-icon">▶</span></span>
                    <div style={{fontSize:11,color:'var(--ink-light)',marginTop:2}}>plot.py (486 bytes)</div></div>
                    <div className="msg-time">14:34</div>
                  </div>
                </div>
                <div className="input-area">
                  <div className="input-main">
                    <div className="input-star-avatar" title="当前星官">
                      <img src="frames/frame_0001.jpg" style={{width:'100%',height:'100%',objectFit:'cover'}}/>
                    </div>
                    <div className="input-box">
                      <textarea className="chat-textarea" rows={1} placeholder="与长庚对话... (@提及, /plan /ask /bypass)"></textarea>
                      <div className="input-bottom">
                        <button className="tool-btn" title="附件">+ 附件</button>
                        <button className="tool-btn" title="权限">🔓 完全访问</button>
                      </div>
                      <div className="input-actions">
                        <button className="model-select" title="切换模型">kimi-k2.5 ⌄</button>
                        <button className="send-btn" title="发送">⬆</button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </main>
            {showRightPanel && <aside className="right-panel">
              <div className="rp-header"><span className="rp-title">星官详情</span><span className="rp-close" onClick={() => setShowRightPanel(false)}>✕</span></div>
              <div className="rp-body">
                <div className="rp-art-card">
                  <div className="rp-art" style={{background:'linear-gradient(135deg,rgba(200,150,10,0.08),rgba(200,150,10,0.03))'}}><img src="star-art.jpg" style={{width:'100%',height:'100%',objectFit:'cover'}}/></div>
                  <div className="rp-art-info"><div className="rp-art-name">长庚</div><div className="rp-art-title">日常执事</div><div className="rp-art-desc">温润如玉的青衫书生</div></div>
                </div>
                <div className="rp-section">
                  <div className="rp-section-title">运行配置</div>
                  <div className="rp-row"><span className="label">模型服务</span><span className="value">OpenCode Go</span></div>
                  <div className="rp-row"><span className="label">模型</span><span className="value">kimi-k2.5</span></div>
                  <div className="rp-row"><span className="label">策略</span><span className="value">Ask</span></div>
                  <div className="rp-row"><span className="label">角色类型</span><span className="value">主/子 Agent</span></div>
                  <div className="rp-row"><span className="label">最大步数</span><span className="value">10</span></div>
                </div>
                <div className="rp-section">
                  <div className="rp-section-title">项目区</div>
                  <div className="rp-ws-item"><span className="rp-ws-path">C:\Users\dmql\Documents\TianShu</span></div>
                </div>
                <div className="rp-section">
                  <div className="rp-section-title" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>授权工作区 <button style={{background:'none',border:'none',color:'var(--gold)',cursor:'pointer',fontSize:14,lineHeight:1}} title="添加路径">+</button></div>
                  <div className="rp-ws-item"><span className="rp-ws-path">C:\Users\dmql\Documents\TianShu</span><button className="rp-ws-del" title="删除">✕</button></div>
                </div>
                <div className="rp-section">
                  <div className="rp-section-title">运行状态</div>
                  <div className="rp-row"><span className="label">上下文</span><span className="value">12.4K / 128K</span></div>
                  <div className="rp-meter"><div className="fill" style={{width:'10%'}}></div></div>
                  <div className="rp-row" style={{marginTop:6}}><span className="label">缓存命中</span><span className="value" style={{color:'var(--jade)'}}>62%</span></div>
                  <div className="rp-row"><span className="label">当前策略</span><span className="value">Ask</span></div>
                </div>
                <div className="rp-section">
                  <div className="rp-section-title" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>绑定知识库 <button style={{background:'none',border:'none',color:'var(--gold)',cursor:'pointer',fontSize:14,lineHeight:1}} title="绑定知识库">+</button></div>
                  <div className="fp-file-item"><span className="fp-file-icon">📚</span><span className="fp-file-name">产品文档</span></div>
                </div>
                <div className="rp-section">
                  <div className="rp-section-title">能力</div>
                  <div className="rp-row"><span className="label">技能</span><span className="value">2 个</span></div>
                  <div className="rp-row"><span className="label">工具</span><span className="value">5 个就绪</span></div>
                </div>
                <div className="rp-section">
                  <div className="rp-section-title">会话统计</div>
                  <div className="rp-stats">
                    <div className="rp-stat"><div className="rp-stat-value">5</div><div className="rp-stat-label">消息</div></div>
                    <div className="rp-stat"><div className="rp-stat-value">3.8K</div><div className="rp-stat-label">Tokens</div></div>
                    <div className="rp-stat"><div className="rp-stat-value">2</div><div className="rp-stat-label">工具调用</div></div>
                    <div className="rp-stat"><div className="rp-stat-value">0</div><div className="rp-stat-label">事件</div></div>
                  </div>
                </div>
              </div>
            </aside>}
            {showFilePanel && <aside className="file-panel">
              <div className="fp-header">
                <span className="fp-title">文件</span>
                <span className="fp-close" onClick={() => setShowFilePanel(false)}>✕</span>
              </div>
              <div className="fp-body">
                <div className="fp-section">
                  <div className="fp-section-title">附件</div>
                  <div className="fp-file-item"><span className="fp-file-icon">📎</span><span className="fp-file-name">sales.csv</span></div>
                </div>
                <div className="fp-section">
                  <div className="fp-section-title">输出文件</div>
                  <div className="fp-file-item"><span className="fp-file-icon">📄</span><span className="fp-file-name">plot.py</span></div>
                  <div className="fp-file-item"><span className="fp-file-icon">🖼️</span><span className="fp-file-name">output.png</span></div>
                </div>
              </div>
            </aside>}
          </>
        )

      case 'characters':
        return (
          <main className="main">
            <div className="page-header">
              <span className="page-title">角色管理</span>
              <div className="header-actions">
                <input className="search-input" placeholder="搜索角色..."/>
                <button className="btn primary">+ 新建角色</button>
              </div>
            </div>
            <div className="content">
              <div className="group-title">中枢</div>
              <div className="star-grid">
                <div className="star-card" onClick={() => navigate('character-detail')}>
                  <div className="star-art" style={{background:'linear-gradient(135deg,rgba(124,58,237,0.08),rgba(124,58,237,0.03))',fontSize:56}}>👑</div>
                  <div className="star-info">
                    <div className="star-name">紫微</div>
                    <div className="star-title">万能中枢</div>
                    <div className="star-desc">沉稳威严的帝王，负责统筹协调与任务分配。</div>
                    <div className="star-tags">
                      <span className="star-tag jade">已启用</span>
                      <span className="star-tag blue">主 Agent</span>
                      <span className="star-tag">Bypass</span>
                      <span className="star-tag">kimi-k2.7-code</span>
                    </div>
                    <div className="star-stats">
                      <div className="star-stat"><div className="star-stat-value">42</div><div className="star-stat-label">会话</div></div>
                      <div className="star-stat"><div className="star-stat-value">1.2K</div><div className="star-stat-label">调用</div></div>
                      <div className="star-stat"><div className="star-stat-value">100%</div><div className="star-stat-label">成功率</div></div>
                    </div>
                    <div className="star-foot">
                      <span className="star-active">活跃于 10 分钟前</span>
                      <div className="star-spark"><i style={{height:'40%'}}></i><i style={{height:'70%'}}></i><i style={{height:'55%'}}></i><i style={{height:'90%'}}></i><i style={{height:'65%'}}></i><i style={{height:'100%'}}></i><i style={{height:'80%'}}></i></div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="group-title">默认</div>
              <div className="star-grid">
                <div className="star-card">
                  <div className="star-art" style={{background:'linear-gradient(135deg,rgba(200,150,10,0.08),rgba(200,150,10,0.03))'}}><img src="star-art.jpg" style={{width:'100%',height:'100%',objectFit:'cover'}}/></div>
                  <div className="star-info">
                    <div className="star-name">长庚</div>
                    <div className="star-title">日常执事</div>
                    <div className="star-desc">温润如玉的青衫书生，擅长日常事务处理与文件管理。</div>
                    <div className="star-tags">
                      <span className="star-tag jade">已启用</span>
                      <span className="star-tag blue">主/子</span>
                      <span className="star-tag">Ask</span>
                      <span className="star-tag">kimi-k2.5</span>
                    </div>
                    <div className="star-stats">
                      <div className="star-stat"><div className="star-stat-value">128</div><div className="star-stat-label">会话</div></div>
                      <div className="star-stat"><div className="star-stat-value">4.2K</div><div className="star-stat-label">调用</div></div>
                      <div className="star-stat"><div className="star-stat-value">98%</div><div className="star-stat-label">成功率</div></div>
                    </div>
                    <div className="star-foot">
                      <span className="star-active">活跃中</span>
                      <div className="star-spark"><i style={{height:'60%'}}></i><i style={{height:'80%'}}></i><i style={{height:'45%'}}></i><i style={{height:'95%'}}></i><i style={{height:'70%'}}></i><i style={{height:'85%'}}></i><i style={{height:'100%'}}></i></div>
                    </div>
                  </div>
                </div>
                <div className="star-card" onClick={() => navigate('character-detail')}>
                  <div className="star-art" style={{background:'linear-gradient(135deg,rgba(200,150,10,0.08),rgba(200,150,10,0.03))'}}><img src="star-art.jpg" style={{width:'100%',height:'100%',objectFit:'cover'}}/></div>
                  <div className="star-info">
                    <div className="star-name">长庚</div>
                    <div className="star-title">日常执事</div>
                    <div className="star-desc">温润如玉的青衫书生，擅长日常事务处理与文件管理。</div>
                    <div className="star-tags">
                      <span className="star-tag jade">已启用</span>
                      <span className="star-tag blue">主/子</span>
                      <span className="star-tag">Ask</span>
                      <span className="star-tag">kimi-k2.5</span>
                    </div>
                    <div className="star-stats">
                      <div className="star-stat"><div className="star-stat-value">128</div><div className="star-stat-label">会话</div></div>
                      <div className="star-stat"><div className="star-stat-value">4.2K</div><div className="star-stat-label">调用</div></div>
                      <div className="star-stat"><div className="star-stat-value">98%</div><div className="star-stat-label">成功率</div></div>
                    </div>
                    <div className="star-foot">
                      <span className="star-active">活跃中</span>
                      <div className="star-spark"><i style={{height:'60%'}}></i><i style={{height:'80%'}}></i><i style={{height:'45%'}}></i><i style={{height:'95%'}}></i><i style={{height:'70%'}}></i><i style={{height:'85%'}}></i><i style={{height:'100%'}}></i></div>
                    </div>
                  </div>
                </div>
                <div className="star-card" onClick={() => navigate('character-detail')}>
                  <div className="star-art" style={{background:'linear-gradient(135deg,rgba(37,99,235,0.08),rgba(37,99,235,0.03))',fontSize:56}}>⚙️</div>
                  <div className="star-info">
                    <div className="star-name">天璇</div>
                    <div className="star-title">代码工匠</div>
                    <div className="star-desc">理性冷静的工程师，专注于代码编写与调试。</div>
                    <div className="star-tags">
                      <span className="star-tag jade">已启用</span>
                      <span className="star-tag blue">主/子</span>
                      <span className="star-tag">Ask</span>
                      <span className="star-tag">deepseek-v4-pro</span>
                    </div>
                    <div className="star-stats">
                      <div className="star-stat"><div className="star-stat-value">96</div><div className="star-stat-label">会话</div></div>
                      <div className="star-stat"><div className="star-stat-value">3.8K</div><div className="star-stat-label">调用</div></div>
                      <div className="star-stat"><div className="star-stat-value">97%</div><div className="star-stat-label">成功率</div></div>
                    </div>
                    <div className="star-foot">
                      <span className="star-active">活跃于 2 小时前</span>
                      <div className="star-spark"><i style={{height:'50%'}}></i><i style={{height:'75%'}}></i><i style={{height:'60%'}}></i><i style={{height:'85%'}}></i><i style={{height:'100%'}}></i><i style={{height:'55%'}}></i><i style={{height:'70%'}}></i></div>
                    </div>
                  </div>
                </div>
                <div className="star-card" onClick={() => navigate('character-detail')}>
                  <div className="star-art" style={{background:'linear-gradient(135deg,rgba(5,150,105,0.08),rgba(5,150,105,0.03))',fontSize:56}}>📝</div>
                  <div className="star-info">
                    <div className="star-name">文曲</div>
                    <div className="star-title">掌墨使</div>
                    <div className="star-desc">温雅博学的藏书家，擅长文档写作与知识整理。</div>
                    <div className="star-tags">
                      <span className="star-tag jade">已启用</span>
                      <span className="star-tag blue">主 Agent</span>
                      <span className="star-tag">Plan</span>
                      <span className="star-tag">glm-5.2</span>
                    </div>
                    <div className="star-stats">
                      <div className="star-stat"><div className="star-stat-value">87</div><div className="star-stat-label">会话</div></div>
                      <div className="star-stat"><div className="star-stat-value">3.1K</div><div className="star-stat-label">调用</div></div>
                      <div className="star-stat"><div className="star-stat-value">99%</div><div className="star-stat-label">成功率</div></div>
                    </div>
                    <div className="star-foot">
                      <span className="star-active">活跃于昨天</span>
                      <div className="star-spark"><i style={{height:'30%'}}></i><i style={{height:'55%'}}></i><i style={{height:'80%'}}></i><i style={{height:'45%'}}></i><i style={{height:'65%'}}></i><i style={{height:'90%'}}></i><i style={{height:'50%'}}></i></div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="group-title">开发</div>
              <div className="star-grid">
                <div className="star-card">
                  <div className="star-art" style={{background:'linear-gradient(135deg,rgba(37,99,235,0.08),rgba(37,99,235,0.03))',fontSize:56}}>⚙️</div>
                  <div className="star-info">
                    <div className="star-name">天璇</div>
                    <div className="star-title">代码工匠</div>
                    <div className="star-desc">理性冷静的工程师，专注于代码编写与调试。</div>
                    <div className="star-tags">
                      <span className="star-tag jade">已启用</span>
                      <span className="star-tag blue">主/子</span>
                      <span className="star-tag">Ask</span>
                      <span className="star-tag">deepseek-v4-pro</span>
                    </div>
                    <div className="star-stats">
                      <div className="star-stat"><div className="star-stat-value">96</div><div className="star-stat-label">会话</div></div>
                      <div className="star-stat"><div className="star-stat-value">3.8K</div><div className="star-stat-label">调用</div></div>
                      <div className="star-stat"><div className="star-stat-value">97%</div><div className="star-stat-label">成功率</div></div>
                    </div>
                    <div className="star-foot">
                      <span className="star-active">活跃于 2 小时前</span>
                      <div className="star-spark"><i style={{height:'50%'}}></i><i style={{height:'75%'}}></i><i style={{height:'60%'}}></i><i style={{height:'85%'}}></i><i style={{height:'100%'}}></i><i style={{height:'55%'}}></i><i style={{height:'70%'}}></i></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </main>
        )

      case 'skills':
        return <SkillsPage onSkillClick={() => navigate('skill-detail')} />

      case 'skill-detail':
        return <SkillDetailPage onBack={() => navigate('skills')} />

      case 'tools':
        return <ToolsPage />

      case 'events':
        return <EventsPage />

      case 'market':
        return <MarketPage />

      case 'mcp':
        return <McpPage />

      case 'knowledge':
        return <KnowledgePage />

      case 'settings':
        return <SettingsPage />

      case 'character-detail':
        return <CharacterDetailPage onBack={() => navigate('characters')} />

      default:
        return null
    }
  }

  return (
    <div className="app">
      <nav className="nav-rail">
        <div className="nav-logo" title="天枢" onClick={() => navigate('home')}>天</div>
        {navItems.map(item => (
          <button
            key={item.id}
            className={`nav-item ${currentPage === item.id ? 'active' : ''}`}
            onClick={() => navigate(item.id)}
            title={item.label}
          >
            {item.icon}
            <span className="nav-label">{item.label}</span>
          </button>
        ))}
        <div className="nav-divider"></div>
        <button
          className={`nav-item ${currentPage === 'events' ? 'active' : ''}`}
          onClick={() => navigate('events')}
          title="事件"
        >
          ⚡
          <span className="nav-label">事件</span>
          <span className="nav-badge">2</span>
        </button>
        <div className="nav-spacer"></div>
        <button
          className={`nav-item ${currentPage === 'settings' ? 'active' : ''}`}
          onClick={() => navigate('settings')}
          title="设置"
        >
          ⚙️
          <span className="nav-label">设置</span>
        </button>
      </nav>
      {renderContent()}
    </div>
  )
}
