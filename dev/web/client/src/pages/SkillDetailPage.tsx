import { useState } from 'react'

export default function SkillDetailPage({ onBack }: { onBack: () => void }) {
  const [activeTab, setActiveTab] = useState('overview')
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({})

  const toggleFolder = (name: string) => {
    setOpenFolders(prev => ({ ...prev, [name]: !prev[name] }))
  }

  const tabs = [
    { id: 'overview', label: '概览' },
    { id: 'tools', label: '依赖工具' },
    { id: 'stats', label: '统计' },
  ]

  const attachments = [
    {
      name: 'references',
      icon: '📁',
      files: [
        { name: 'fee-policy.md', icon: '📄', size: '12 KB' },
        { name: 'api-docs.md', icon: '📄', size: '45 KB' },
        { name: 'field-mapping.csv', icon: '📊', size: '8 KB' },
      ]
    },
    {
      name: 'scripts',
      icon: '📁',
      files: [
        { name: 'analyze.py', icon: '🐍', size: '3.2 KB' },
        { name: 'extract.sh', icon: '⚙️', size: '1.1 KB' },
      ]
    },
    {
      name: 'assets',
      icon: '📁',
      files: [
        { name: 'template.docx', icon: '📋', size: '24 KB' },
        { name: 'schema.json', icon: '📄', size: '2 KB' },
      ]
    }
  ]

  return (
    <div className="app">
      <main className="main">
        <div className="detail-header">
          <button className="back-btn" onClick={onBack}>←</button>
          <div className="detail-header-info">
            <div className="detail-header-icon" style={{background:'rgba(200,150,10,0.08)'}}>📄</div>
            <div>
              <h1>文档分析</h1>
              <p>skill_doc_analysis · 进化生成</p>
            </div>
          </div>
          <div style={{flex:1}}></div>
          <button className="detail-btn" style={{borderColor:'var(--jade)',color:'var(--jade)'}}>已启用</button>
        </div>

        <div className="detail-body">
          <div className="detail-side">
            <div className="detail-side-icon" style={{background:'rgba(200,150,10,0.08)',borderColor:'rgba(200,150,10,0.2)'}}>📄</div>
            <div className="detail-side-name">文档分析</div>
            <div className="detail-side-author">by 进化引擎 · v1.2.0</div>
            <div className="detail-side-desc">分析文档内容，提取关键信息。支持 PDF、Word、TXT、Markdown 等格式，自动识别文档结构与核心内容。</div>
            <div className="detail-actions">
              <button className="detail-btn primary">测试运行</button>
              <button className="detail-btn">导出配置</button>
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

            {/* 概览 */}
            <div className="tab-page" style={{display: activeTab === 'overview' ? 'block' : 'none'}}>
              <div className="detail-section">
                <div className="detail-section-title">SKILL.md<span className="edit-link">编辑</span></div>
                <div className="md-box">---
name: doc-analysis
description: 分析文档内容，提取关键信息。支持 PDF、Word、TXT、Markdown 等格式，自动识别文档结构与核心内容。
license: MIT
metadata:
  author: 进化引擎
  version: 1.2.0
allowed-tools:
  - read
  - webfetch
---

# 文档分析

## 功能说明

分析文档内容，提取关键信息与结构化数据。

## 支持格式

- PDF 文档（文字+图片）
- Word 文档（.docx）
- 纯文本（.txt）
- Markdown（.md）
- 表格（.csv, .xlsx）

## 处理流程

1. 读取文件内容
2. 识别文档类型与结构
3. 提取标题、段落、表格等元素
4. 生成结构化摘要
5. 返回 JSON 格式的分析结果</div>
              </div>

              <div className="detail-section">
                <div className="detail-section-title">附件</div>
                <div className="tool-list">
                  {attachments.map(folder => (
                    <div key={folder.name}>
                      <div className="tool-item" style={{cursor:'pointer'}} onClick={() => toggleFolder(folder.name)}>
                        <span style={{fontSize:14}}>{folder.icon}</span>
                        <div className="tool-name">{folder.name}</div>
                        <span style={{fontSize:10,color:'var(--ink-faint)',marginLeft:'auto'}}>{folder.files.length} 个文件</span>
                        <span style={{fontSize:10,color:'var(--ink-faint)'}}>{openFolders[folder.name] ? '▼' : '▶'}</span>
                      </div>
                      {openFolders[folder.name] && folder.files.map(file => (
                        <div key={file.name} className="tool-item" style={{paddingLeft:44,background:'var(--bg-input)'}}>
                          <span style={{fontSize:12}}>{file.icon}</span>
                          <div className="tool-name">{file.name}</div>
                          <span style={{fontSize:10,color:'var(--ink-faint)',marginLeft:'auto'}}>{file.size}</span>
                          <button className="tool-swap add" title="打开">📂</button>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>

              <div className="detail-section">
                <div className="detail-section-title">来源信息</div>
                <div className="info-grid">
                  <div className="info-item"><div className="info-item-label">来源</div><div className="info-item-value">进化引擎生成</div></div>
                  <div className="info-item"><div className="info-item-label">版本</div><div className="info-item-value">v1.2.0</div></div>
                  <div className="info-item"><div className="info-item-label">创建时间</div><div className="info-item-value">2026-03-15</div></div>
                  <div className="info-item"><div className="info-item-label">最后更新</div><div className="info-item-value">2026-07-18</div></div>
                  <div className="info-item"><div className="info-item-label">Token 预估</div><div className="info-item-value">~3.2K</div></div>
                  <div className="info-item"><div className="info-item-label">触发方式</div><div className="info-item-value">自动检测</div></div>
                </div>
              </div>
            </div>

            {/* 依赖工具 */}
            <div className="tab-page" style={{display: activeTab === 'tools' ? 'block' : 'none'}}>
              <div className="detail-section">
                <div className="detail-section-title">所需工具</div>
                <div className="tool-list">
                  <div className="tool-item"><div className="tool-icon">📖</div><div className="tool-name">read</div><span style={{fontSize:11,color:'var(--ink-light)',marginLeft:'auto'}}>读取文档内容</span></div>
                </div>
              </div>
              <div className="detail-section">
                <div className="detail-section-title">可选工具</div>
                <div className="tool-list">
                  <div className="tool-item"><div className="tool-icon">🌐</div><div className="tool-name">webfetch</div><span style={{fontSize:11,color:'var(--ink-light)',marginLeft:'auto'}}>抓取在线文档</span></div>
                </div>
              </div>
            </div>

            {/* 统计 */}
            <div className="tab-page" style={{display: activeTab === 'stats' ? 'block' : 'none'}}>
              <div className="detail-section">
                <div className="detail-section-title">使用概览</div>
                <div className="stats-row">
                  <div className="stat-item"><div className="stat-value">2.4K</div><div className="stat-sub">↑ 180 本周</div><div className="stat-label">调用次数</div></div>
                  <div className="stat-item"><div className="stat-value">98%</div><div className="stat-sub">↑ 1.2%</div><div className="stat-label">成功率</div></div>
                  <div className="stat-item"><div className="stat-value">1.2s</div><div className="stat-sub">↓ 0.1s</div><div className="stat-label">平均耗时</div></div>
                  <div className="stat-item"><div className="stat-value">2</div><div className="stat-sub"></div><div className="stat-label">绑定角色</div></div>
                </div>
              </div>
              <div className="detail-section">
                <div className="detail-section-title">绑定角色</div>
                <div style={{display:'flex',gap:12,flexWrap:'wrap'}}>
                  <div style={{textAlign:'center'}}><div style={{width:48,height:48,borderRadius:12,background:'rgba(200,150,10,0.08)',border:'1px solid var(--border)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:22,marginBottom:4}}>🌟</div><div style={{fontSize:11,color:'var(--ink-mid)'}}>长庚</div></div>
                  <div style={{textAlign:'center'}}><div style={{width:48,height:48,borderRadius:12,background:'rgba(5,150,105,0.08)',border:'1px solid var(--border)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:22,marginBottom:4}}>📝</div><div style={{fontSize:11,color:'var(--ink-mid)'}}>文曲</div></div>
                </div>
              </div>
              <div className="detail-section">
                <div className="detail-section-title">调用趋势（近7天）</div>
                <div className="bar-chart">
                  <div className="bar-col"><div className="bar-fill" style={{height:'40%'}}></div><div className="bar-label">一</div></div>
                  <div className="bar-col"><div className="bar-fill" style={{height:'65%'}}></div><div className="bar-label">二</div></div>
                  <div className="bar-col"><div className="bar-fill" style={{height:'50%'}}></div><div className="bar-label">三</div></div>
                  <div className="bar-col"><div className="bar-fill" style={{height:'80%'}}></div><div className="bar-label">四</div></div>
                  <div className="bar-col"><div className="bar-fill" style={{height:'95%'}}></div><div className="bar-label">五</div></div>
                  <div className="bar-col"><div className="bar-fill" style={{height:'70%'}}></div><div className="bar-label">六</div></div>
                  <div className="bar-col"><div className="bar-fill" style={{height:'100%'}}></div><div className="bar-label">日</div></div>
                </div>
              </div>
              <div className="detail-section">
                <div className="detail-section-title">最近调用</div>
                <div className="tool-item" style={{cursor:'pointer'}}><span style={{fontSize:12}}>💬</span><div className="tool-name" style={{fontFamily:'inherit',fontSize:12}}>前端优化方案讨论</div><span style={{fontSize:10,color:'var(--ink-faint)',marginLeft:'auto'}}>10 分钟前 · 成功</span></div>
                <div className="tool-item" style={{cursor:'pointer'}}><span style={{fontSize:12}}>💬</span><div className="tool-name" style={{fontFamily:'inherit',fontSize:12}}>周报润色</div><span style={{fontSize:10,color:'var(--ink-faint)',marginLeft:'auto'}}>昨天 · 成功</span></div>
                <div className="tool-item" style={{cursor:'pointer'}}><span style={{fontSize:12}}>💬</span><div className="tool-name" style={{fontFamily:'inherit',fontSize:12}}>API 文档分析</div><span style={{fontSize:10,color:'var(--ink-faint)',marginLeft:'auto'}}>3 天前 · 成功</span></div>
              </div>
            </div>

            <div style={{marginTop:32,paddingTop:16,borderTop:'1px solid var(--border-light)'}}>
              <button className="detail-btn danger" style={{width:'100%'}}>删除技能</button>
            </div>

          </div>
        </div>
      </main>
    </div>
  )
}
