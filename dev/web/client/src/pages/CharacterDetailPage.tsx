import { useState } from 'react'

export default function CharacterDetailPage({ onBack }: { onBack: () => void }) {
  const [activeTab, setActiveTab] = useState('basic')
  const [strategy, setStrategy] = useState('Ask')
  const [maxStepsEnabled, setMaxStepsEnabled] = useState(false)
  const [maxSteps, setMaxSteps] = useState(10)

  const tabs = [
    { id: 'basic', label: '基础' },
    { id: 'memory', label: '记忆' },
    { id: 'tools', label: '工具' },
    { id: 'skills', label: '技能' },
    { id: 'knowledge', label: '知识' },
    { id: 'stats', label: '统计' },
  ]

  return (
    <div className="app">
      <main className="main">
        <div className="detail-header">
          <button className="back-btn" onClick={onBack}>←</button>
          <div className="detail-header-info">
            <h1>长庚</h1>
            <p>changgeng · 日常执事</p>
          </div>
          <div style={{flex:1}}></div>
          <button className="detail-btn" style={{borderColor:'var(--jade)',color:'var(--jade)'}}>已启用</button>
        </div>

        <div className="detail-body">
          <div className="detail-art">
            <div className="detail-art-img"><img src="star-art.jpg" alt="长庚"/></div>
            <div className="detail-actions">
              <button className="detail-btn primary" onClick={onBack}>开始对话</button>
              <button className="detail-btn">上传头像</button>
              <button className="detail-btn danger">删除角色</button>
            </div>
          </div>

          <div className="detail-content">
            <div className="detail-tabs">
              {tabs.map(tab => (
                <button
                  key={tab.id}
                  className={`detail-tab ${activeTab === tab.id ? 'active' : ''}`}
                  onClick={() => setActiveTab(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* 基础 */}
            <div className="tab-page" style={{display: activeTab === 'basic' ? 'block' : 'none'}}>
              <div className="detail-section">
                <div className="detail-section-title">基本信息</div>
                <div className="info-grid" style={{gridTemplateColumns:'1fr 1fr 1fr'}}>
                  <div className="info-item" style={{gridColumn:'1/-1'}}><div className="info-item-label">角色简介</div><div className="info-item-value" style={{fontWeight:400,lineHeight:1.5}}>温润如玉的青衫书生，擅长日常事务处理与文件管理。</div></div>
                  <div className="info-item"><div className="info-item-label">角色 ID</div><div className="info-item-value" style={{fontFamily:'monospace'}}>changgeng</div></div>
                  <div className="info-item"><div className="info-item-label">角色类型</div><div className="info-item-value">主 / 子 Agent</div></div>
                </div>
                <div className="tool-list" style={{marginTop:10}}>
                  <div className="tool-item">
                    <div className="tool-name">默认策略</div>
                    <div style={{display:'flex',gap:4}}>
                      {['Plan','Ask','Bypass'].map(s => (
                        <span key={s} className={`strategy-btn ${strategy === s ? 'active' : ''}`} onClick={() => setStrategy(s)}>{s}</span>
                      ))}
                    </div>
                  </div>
                  <div className="tool-item">
                    <div className="tool-name">限制最大步数</div>
                    <div style={{display:'flex',alignItems:'center',gap:10}}>
                      <div className={`toggle ${maxStepsEnabled ? 'on' : ''}`} onClick={() => setMaxStepsEnabled(!maxStepsEnabled)}></div>
                      <span style={{fontSize:12,color:'var(--ink-light)'}}>{maxStepsEnabled ? `${maxSteps} 步` : '不限制'}</span>
                    </div>
                  </div>
                  {maxStepsEnabled && (
                    <div className="tool-item">
                      <div className="tool-name">步数上限</div>
                      <div style={{display:'flex',alignItems:'center',gap:10,flex:1}}>
                        <input type="range" min="1" max="50" value={maxSteps} onChange={e => setMaxSteps(Number(e.target.value))} style={{flex:1,accentColor:'var(--gold)'}}/>
                        <span style={{fontSize:12,color:'var(--ink-deep)',fontWeight:500,minWidth:24,textAlign:'right'}}>{maxSteps}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="detail-section">
                <div className="detail-section-title">分组</div>
                <div className="tag-list">
                  <span className="tag on">默认</span>
                  <span className="tag">开发</span>
                  <span className="tag">写作</span>
                  <span className="tag">中枢</span>
                </div>
              </div>

              <div className="detail-section">
                <div className="detail-columns">
                  <div className="detail-col">
                    <div className="detail-section-title">Soul（人格）<span className="edit-link">编辑</span></div>
                    <div className="md-box">你是长庚，天枢系统中的日常执事。温润如玉的青衫书生，性格温和，做事细致，擅长整理与归纳。

长庚星又称金星，古人认为其光芒柔和，象征着谦逊与勤勉。你以温和而专业的态度处理各类事务性工作。</div>
                  </div>
                  <div className="detail-col">
                    <div className="detail-section-title">User（用户画像）<span className="edit-link">编辑</span></div>
                    <div className="md-box">用户是一位开发者，偏好中文交流，习惯简洁直接的表达方式。正在进行 AI Agent 系统的前端设计工作。</div>
                  </div>
                </div>
              </div>

              <div className="detail-section">
                <div className="detail-section-title" style={{marginBottom:6}}>自定义提示词（prompt.md）<span className="edit-link">编辑</span></div>
                <div className="tool-list">
                  <div className="tool-item"><div className="tool-name">启用自定义提示词</div><div className="toggle" onClick={e => e.currentTarget.classList.toggle('on')}></div></div>
                </div>
                <div className="md-box" style={{color:'var(--ink-faint)',fontStyle:'italic',marginTop:8}}>（未设置，将使用默认系统提示词）</div>
              </div>
            </div>

            {/* 记忆 */}
            <div className="tab-page" style={{display: activeTab === 'memory' ? 'block' : 'none'}}>
              <div className="detail-section">
                <div className="detail-section-title">记忆设置</div>
                <div className="tool-list">
                  <div className="tool-item"><div className="tool-name">启用记忆</div><div className="toggle on" onClick={e => e.currentTarget.classList.toggle('on')}></div></div>
                  <div className="tool-item"><div className="tool-name">自我进化（自动沉淀记忆）</div><div className="toggle on" onClick={e => e.currentTarget.classList.toggle('on')}></div></div>
                  <div className="tool-item"><div className="tool-name">记忆字符上限</div><span style={{fontSize:12,color:'var(--ink-mid)'}}>2200</span></div>
                </div>
              </div>
              <div className="detail-section">
                <div className="detail-section-title">Memory（记忆内容）<span className="edit-link">编辑</span></div>
                <div className="md-box">- 用户偏好浅色主题界面，宣纸色系
- 用户的项目路径：C:\Users\dmql\Documents\TianShu
- 用户习惯用中文命名文件和变量
- 用户正在设计天枢系统的前端 demo</div>
              </div>
            </div>

            {/* 工具 */}
            <div className="tab-page" style={{display: activeTab === 'tools' ? 'block' : 'none'}}>
              <div style={{display:'flex',gap:12}}>
                <div style={{flex:1,minWidth:0}}>
                  <div className="detail-section-title">已绑定工具 (5)</div>
                  <div style={{border:'1px solid var(--border)',borderRadius:10,padding:8,background:'rgba(42,157,92,0.02)'}}>
                    <div style={{display:'flex',flexDirection:'column',gap:6}}>
                      {[
                        {name:'read',icon:'📖',desc:'读取文件内容，支持文本与代码',usage:'8.2K',rate:'99.8%'},
                        {name:'write',icon:'✏️',desc:'写入文件内容，创建或覆盖',usage:'3.1K',rate:'99.2%'},
                        {name:'bash',icon:'⚙️',desc:'执行命令行操作，支持审批拦截',usage:'4.5K',rate:'97.8%'},
                        {name:'webfetch',icon:'🌐',desc:'抓取网页内容，转为 Markdown',usage:'1.9K',rate:'99.5%'},
                        {name:'websearch',icon:'🔍',desc:'搜索互联网获取实时信息',usage:'1.4K',rate:'99.1%'},
                      ].map(tool => (
                        <div key={tool.name} className="tool-item" style={{border:'none',background:'transparent',flexDirection:'column',alignItems:'stretch',gap:6}}>
                          <div style={{display:'flex',alignItems:'center',gap:8}}>
                            <div className="tool-icon">{tool.icon}</div>
                            <div className="tool-name">{tool.name}</div>
                            <span className="tool-source builtin">内置</span>
                            <button className="tool-swap remove" title="解绑" style={{marginLeft:'auto'}}>✕</button>
                          </div>
                          <div style={{fontSize:11,color:'var(--ink-light)',paddingLeft:38}}>{tool.desc}</div>
                          <div style={{display:'flex',gap:8,paddingLeft:38,fontSize:10,color:'var(--ink-faint)'}}>
                            <span>使用 {tool.usage} 次</span>
                            <span>成功率 {tool.rate}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div style={{flex:1,minWidth:0}}>
                  <div className="detail-section-title">可添加工具</div>
                  <div style={{border:'1px dashed var(--border)',borderRadius:10,padding:8,background:'var(--bg-input)'}}>
                    <div style={{display:'flex',flexDirection:'column',gap:6}}>
                      {[
                        {name:'edit',icon:'🔧',desc:'精确替换文件中的指定文本',usage:'2.8K',rate:'98.7%',source:'builtin'},
                        {name:'grep',icon:'🔍',desc:'搜索文件内容，支持正则匹配',usage:'6.3K',rate:'100%',source:'builtin'},
                        {name:'glob',icon:'📂',desc:'文件模式匹配，快速查找文件',usage:'5.7K',rate:'100%',source:'builtin'},
                        {name:'context7_resolve',icon:'🌐',desc:'解析库文档 URL 获取内容',source:'mcp'},
                        {name:'context7_query',icon:'🌐',desc:'查询库文档获取 API 参考',source:'mcp'},
                        {name:'codegraph_search',icon:'🔍',desc:'代码知识图谱符号搜索',source:'mcp'},
                      ].map(tool => (
                        <div key={tool.name} className="tool-item" style={{border:'none',background:'transparent',flexDirection:'column',alignItems:'stretch',gap:6}}>
                          <div style={{display:'flex',alignItems:'center',gap:8}}>
                            <div className="tool-icon">{tool.icon}</div>
                            <div className="tool-name">{tool.name}</div>
                            <span className={`tool-source ${tool.source}`}>{tool.source === 'builtin' ? '内置' : 'MCP'}</span>
                            <button className="tool-swap add" title="绑定" style={{marginLeft:'auto'}}>+</button>
                          </div>
                          <div style={{fontSize:11,color:'var(--ink-light)',paddingLeft:38}}>{tool.desc}</div>
                          {tool.usage && (
                            <div style={{display:'flex',gap:8,paddingLeft:38,fontSize:10,color:'var(--ink-faint)'}}>
                              <span>使用 {tool.usage} 次</span>
                              <span>成功率 {tool.rate}</span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 技能 */}
            <div className="tab-page" style={{display: activeTab === 'skills' ? 'block' : 'none'}}>
              <div style={{display:'flex',gap:12}}>
                <div style={{flex:1,minWidth:0}}>
                  <div className="detail-section-title">已绑定技能 (2)</div>
                  <div style={{border:'1px solid var(--border)',borderRadius:10,padding:8,background:'rgba(42,157,92,0.02)'}}>
                    <div style={{display:'flex',flexDirection:'column',gap:6}}>
                      {[
                        {name:'文档分析',icon:'📄',desc:'分析 PDF/Word/TXT/MD，提取关键信息与结构化数据',usage:'1.2K',rate:'98%',source:'进化'},
                        {name:'网页抓取',icon:'🌐',desc:'抓取网页内容，自动提取正文与结构化数据',usage:'956',rate:'96%',source:'进化'},
                      ].map(skill => (
                        <div key={skill.name} className="skill-item">
                          <div style={{display:'flex',alignItems:'center',gap:8}}>
                            <div className="tool-icon">{skill.icon}</div>
                            <div className="skill-name">{skill.name}</div>
                            <span className="tool-source" style={{background:'rgba(124,58,237,0.1)',color:'#7c3aed'}}>{skill.source}</span>
                            <button className="skill-swap remove" title="解绑" style={{marginLeft:'auto'}}>✕</button>
                          </div>
                          <div className="skill-desc">{skill.desc}</div>
                          <div style={{display:'flex',gap:8,marginTop:4,fontSize:10,color:'var(--ink-faint)'}}>
                            <span>使用 {skill.usage} 次</span>
                            <span>成功率 {skill.rate}</span>
                            <span>由运行轨迹自动生成</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div style={{flex:1,minWidth:0}}>
                  <div className="detail-section-title">可绑定技能</div>
                  <div style={{border:'1px dashed var(--border)',borderRadius:10,padding:8,background:'var(--bg-input)'}}>
                    <div style={{display:'flex',flexDirection:'column',gap:6}}>
                      {[
                        {name:'代码审查',icon:'🔍',desc:'多维度审查代码质量与安全漏洞',usage:'3.1K',bind:'天璇',source:'进化'},
                        {name:'UI 设计',icon:'🎨',desc:'UI/UX 设计建议与优化方案',usage:'956',bind:'文曲',source:'自建'},
                        {name:'自动化测试',icon:'🧪',desc:'自动生成测试用例并执行',usage:'0',bind:'未绑定',source:'市场'},
                      ].map(skill => (
                        <div key={skill.name} className="skill-item">
                          <div style={{display:'flex',alignItems:'center',gap:8}}>
                            <div className="tool-icon">{skill.icon}</div>
                            <div className="skill-name">{skill.name}</div>
                            <span className="tool-source" style={{background:skill.source==='进化'?'rgba(124,58,237,0.1)':skill.source==='自建'?'rgba(37,99,235,0.1)':'rgba(200,150,10,0.1)',color:skill.source==='进化'?'#7c3aed':skill.source==='自建'?'var(--blue)':'var(--gold)'}}>{skill.source}</span>
                            <button className="skill-swap add" title="绑定" style={{marginLeft:'auto'}}>+</button>
                          </div>
                          <div className="skill-desc">{skill.desc}</div>
                          <div style={{display:'flex',gap:8,marginTop:4,fontSize:10,color:'var(--ink-faint)'}}>
                            <span>使用 {skill.usage} 次</span>
                            <span>绑定: {skill.bind}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 知识 */}
            <div className="tab-page" style={{display: activeTab === 'knowledge' ? 'block' : 'none'}}>
              <div style={{display:'flex',gap:12}}>
                <div style={{flex:1,minWidth:0}}>
                  <div className="detail-section-title">已绑定知识库 (1)</div>
                  <div style={{border:'1px solid var(--border)',borderRadius:10,padding:8,background:'rgba(42,157,92,0.02)'}}>
                    <div style={{display:'flex',flexDirection:'column',gap:6}}>
                      {[
                        {name:'产品文档',icon:'📚',desc:'天枢系统的产品需求、设计规范、API 文档',docs:'128 篇',chunks:'142 个分块',updated:'3 天前'},
                      ].map(kb => (
                        <div key={kb.name} className="tool-item" style={{border:'none',background:'transparent',flexDirection:'column',alignItems:'stretch',gap:6}}>
                          <div style={{display:'flex',alignItems:'center',gap:8}}>
                            <span style={{fontSize:14}}>{kb.icon}</span>
                            <div className="tool-name">{kb.name}</div>
                            <span style={{fontSize:10,color:'var(--jade)',background:'rgba(42,157,92,0.1)',padding:'1px 5px',borderRadius:3}}>已索引</span>
                            <button className="tool-swap remove" title="解绑" style={{marginLeft:'auto'}}>✕</button>
                          </div>
                          <div style={{fontSize:11,color:'var(--ink-light)',paddingLeft:26}}>{kb.desc}</div>
                          <div style={{display:'flex',gap:8,paddingLeft:26,fontSize:10,color:'var(--ink-faint)'}}>
                            <span>{kb.docs}</span>
                            <span>{kb.chunks}</span>
                            <span>最后更新 {kb.updated}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div style={{flex:1,minWidth:0}}>
                  <div className="detail-section-title">可绑定知识库</div>
                  <div style={{border:'1px dashed var(--border)',borderRadius:10,padding:8,background:'var(--bg-input)'}}>
                    <div style={{display:'flex',flexDirection:'column',gap:6}}>
                      {[
                        {name:'API 参考',icon:'📚',desc:'REST/WebSocket 接口文档',docs:'64 篇'},
                        {name:'团队规范',icon:'📚',desc:'编码规范、Git 工作流、Code Review 标准',docs:'32 篇'},
                      ].map(kb => (
                        <div key={kb.name} className="tool-item" style={{border:'none',background:'transparent',flexDirection:'column',alignItems:'stretch',gap:6}}>
                          <div style={{display:'flex',alignItems:'center',gap:8}}>
                            <span style={{fontSize:14}}>{kb.icon}</span>
                            <div className="tool-name">{kb.name}</div>
                            <span style={{fontSize:10,color:'var(--ink-faint)',background:'var(--bg-hover)',padding:'1px 5px',borderRadius:3}}>未索引</span>
                            <button className="tool-swap add" title="绑定" style={{marginLeft:'auto'}}>+</button>
                          </div>
                          <div style={{fontSize:11,color:'var(--ink-light)',paddingLeft:26}}>{kb.desc}</div>
                          <div style={{display:'flex',gap:8,paddingLeft:26,fontSize:10,color:'var(--ink-faint)'}}>
                            <span>{kb.docs}</span>
                            <span>未绑定</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 统计 */}
            <div className="tab-page" style={{display: activeTab === 'stats' ? 'block' : 'none'}}>
              <div className="detail-section">
                <div className="detail-section-title">使用概览</div>
                <div className="stats-row">
                  <div className="stat-item"><div className="stat-value">128</div><div className="stat-sub">↑ 12 本周</div><div className="stat-label">会话</div></div>
                  <div className="stat-item"><div className="stat-value">4.2K</div><div className="stat-sub">↑ 380 本周</div><div className="stat-label">调用</div></div>
                  <div className="stat-item"><div className="stat-value">98%</div><div className="stat-sub">↑ 1.2%</div><div className="stat-label">成功率</div></div>
                  <div className="stat-item"><div className="stat-value">67%</div><div className="stat-sub">↑ 5%</div><div className="stat-label">缓存命中</div></div>
                </div>
              </div>

              <div className="detail-section">
                <div className="detail-section-title">调用趋势（近7天）</div>
                <div className="bar-chart">
                  <div className="bar-col"><div className="bar-fill" style={{height:'45%'}}></div><div className="bar-label">一</div></div>
                  <div className="bar-col"><div className="bar-fill" style={{height:'62%'}}></div><div className="bar-label">二</div></div>
                  <div className="bar-col"><div className="bar-fill" style={{height:'38%'}}></div><div className="bar-label">三</div></div>
                  <div className="bar-col"><div className="bar-fill" style={{height:'75%'}}></div><div className="bar-label">四</div></div>
                  <div className="bar-col"><div className="bar-fill" style={{height:'88%'}}></div><div className="bar-label">五</div></div>
                  <div className="bar-col"><div className="bar-fill" style={{height:'56%'}}></div><div className="bar-label">六</div></div>
                  <div className="bar-col"><div className="bar-fill" style={{height:'100%'}}></div><div className="bar-label">日</div></div>
                </div>
              </div>

              <div className="detail-section">
                <div className="detail-section-title">工具调用分布</div>
                <div className="dist-row"><span className="dist-name">read</span><div className="dist-bar"><div className="dist-fill" style={{width:'85%',background:'var(--jade)'}}></div></div><span className="dist-pct">34%</span></div>
                <div className="dist-row"><span className="dist-name">bash</span><div className="dist-bar"><div className="dist-fill" style={{width:'55%',background:'var(--cinnabar)'}}></div></div><span className="dist-pct">22%</span></div>
                <div className="dist-row"><span className="dist-name">write</span><div className="dist-bar"><div className="dist-fill" style={{width:'45%',background:'var(--gold)'}}></div></div><span className="dist-pct">18%</span></div>
                <div className="dist-row"><span className="dist-name">webfetch</span><div className="dist-bar"><div className="dist-fill" style={{width:'35%',background:'var(--blue)'}}></div></div><span className="dist-pct">14%</span></div>
                <div className="dist-row"><span className="dist-name">websearch</span><div className="dist-bar"><div className="dist-fill" style={{width:'30%',background:'#7c3aed'}}></div></div><span className="dist-pct">12%</span></div>
              </div>

              <div className="detail-section">
                <div className="detail-section-title">最近会话</div>
                <div className="recent-item" onClick={onBack}>
                  <span style={{fontSize:14}}>💬</span>
                  <span className="recent-title">前端优化方案讨论</span>
                  <span className="recent-msgs">24 条</span>
                  <span className="recent-time">10 分钟前</span>
                </div>
                <div className="recent-item" onClick={onBack}>
                  <span style={{fontSize:14}}>💬</span>
                  <span className="recent-title">CSV 数据折线图脚本</span>
                  <span className="recent-msgs">8 条</span>
                  <span className="recent-time">2 小时前</span>
                </div>
                <div className="recent-item" onClick={onBack}>
                  <span style={{fontSize:14}}>💬</span>
                  <span className="recent-title">周报润色</span>
                  <span className="recent-msgs">12 条</span>
                  <span className="recent-time">昨天</span>
                </div>
              </div>
            </div>

          </div>
        </div>
      </main>
    </div>
  )
}
