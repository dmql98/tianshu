export default function HomePage() {
  const recentRoles = [
    { icon: '🌟', name: '长庚', title: '日常执事', color: 'rgba(200,150,10,0.08)' },
    { icon: '⚙️', name: '天璇', title: '代码工匠', color: 'rgba(37,99,235,0.08)' },
    { icon: '📝', name: '文曲', title: '掌墨使', color: 'rgba(5,150,105,0.08)' },
  ]

  const recentProjects = [
    { icon: '📁', name: 'TianShu 开发', sessions: 12, lastActive: '10 分钟前' },
    { icon: '📁', name: 'LeAgent 研究', sessions: 5, lastActive: '昨天' },
    { icon: '📁', name: '日常杂务', sessions: 8, lastActive: '2 天前' },
  ]

  return (
    <main className="main">
      <div className="home-content">
        {/* 口号 */}
        <div className="home-slogan">
          <h1>让我们干些什么吧</h1>
          <p>天枢，你的 AI Agent 系统</p>
        </div>

        {/* 输入框区域 */}
        <div className="home-input-area">
          <div className="home-star-avatar">
            <div className="home-star-icon">🌟</div>
            <div className="home-star-name">长庚</div>
          </div>
          <div className="home-input-box">
            <textarea 
              className="home-textarea" 
              placeholder="输入你的想法，让天枢来帮你实现..."
              rows={3}
            />
            <div className="home-input-actions">
              <div className="home-input-tools">
                <button className="home-tool-btn">📎</button>
                <button className="home-tool-btn">⚡</button>
                <button className="home-tool-btn">📚</button>
              </div>
              <div className="home-input-right">
                <select className="home-model-select">
                  <option>kimi-k2.5</option>
                  <option>deepseek-v4-pro</option>
                  <option>glm-5.2</option>
                </select>
                <button className="home-send-btn">⬆</button>
              </div>
            </div>
          </div>
        </div>

        {/* 快捷操作 */}
        <div className="home-quick-actions">
          <button className="home-quick-btn">🔍 搜索资料</button>
          <button className="home-quick-btn">📝 写文档</button>
          <button className="home-quick-btn">💻 写代码</button>
          <button className="home-quick-btn">🎨 设计</button>
          <button className="home-quick-btn">更多 →</button>
        </div>

        {/* 最近角色 */}
        <div className="home-section">
          <div className="home-section-header">
            <span className="home-section-title">🎭 最近角色</span>
            <span className="home-section-more">查看全部 →</span>
          </div>
          <div className="home-role-grid">
            {recentRoles.map((role, idx) => (
              <div key={idx} className="home-role-card">
                <div className="home-role-avatar" style={{background:role.color}}>
                  {role.icon}
                </div>
                <div className="home-role-info">
                  <div className="home-role-name">{role.name}</div>
                  <div className="home-role-title">{role.title}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 最近项目 */}
        <div className="home-section">
          <div className="home-section-header">
            <span className="home-section-title">📁 最近项目</span>
            <span className="home-section-more">查看全部 →</span>
          </div>
          <div className="home-project-grid">
            {recentProjects.map((project, idx) => (
              <div key={idx} className="home-project-card">
                <div className="home-project-icon">{project.icon}</div>
                <div className="home-project-info">
                  <div className="home-project-name">{project.name}</div>
                  <div className="home-project-meta">
                    <span>{project.sessions} 个会话</span>
                    <span>·</span>
                    <span>{project.lastActive}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  )
}
