export default function CharactersPage() {
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
          <div className="star-card">
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

          <div className="star-card">
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
}
