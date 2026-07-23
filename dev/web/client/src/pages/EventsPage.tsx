export default function EventsPage() {
  return (
    <main className="main">
      <div className="page-header">
        <span className="page-title">事件中心</span>
        <span style={{fontSize:12,color:'var(--ink-light)'}}>6 个事件 · 1 个正在执行</span>
      </div>
      <div className="content">
        <div className="event-lanes">
          <div className="lane pending">
            <div className="lane-header">⏳ 待处理 (2)</div>
            <div className="lane-body">
              <div className="event-card">
                <div className="event-card-title">代码审查 - main</div>
                <div className="event-card-agent">👑 紫微</div>
                <div className="event-card-meta"><span>触发于 15:28 · 重试 0</span><span className="event-badge" style={{background:'rgba(200,150,10,0.1)',color:'var(--gold)'}}>等待执行</span></div>
                <div className="event-cron">cron: 0 */4 * * *</div>
              </div>
              <div className="event-card">
                <div className="event-card-title">知识库增量索引</div>
                <div className="event-card-agent">🌟 长庚</div>
                <div className="event-card-meta"><span>触发于 16:00 · 重试 0</span><span className="event-badge" style={{background:'rgba(200,150,10,0.1)',color:'var(--gold)'}}>等待执行</span></div>
                <div className="event-cron">cron: 0 2 * * *</div>
              </div>
            </div>
          </div>

          <div className="lane running">
            <div className="lane-header">▶ 执行中 (1)</div>
            <div className="lane-body">
              <div className="event-card">
                <div className="event-card-title">UI 优化自动测试</div>
                <div className="event-card-agent">⚙️ 天璇</div>
                <div className="event-card-meta"><span>触发于 15:16 · 已运行 12 分钟</span><span className="event-badge" style={{background:'rgba(37,99,235,0.1)',color:'var(--blue)'}}>执行中</span></div>
                <div className="event-cron">手动触发</div>
              </div>
            </div>
          </div>

          <div className="lane done">
            <div className="lane-header">✓ 已完成 (2)</div>
            <div className="lane-body">
              <div className="event-card">
                <div className="event-card-title">每日代码备份</div>
                <div className="event-card-agent">🌟 长庚</div>
                <div className="event-card-meta"><span>06:00 · 耗时 3 分钟</span><span className="event-badge" style={{background:'rgba(42,157,92,0.1)',color:'var(--jade)'}}>成功</span></div>
                <div className="event-cron">cron: 0 6 * * *</div>
              </div>
              <div className="event-card">
                <div className="event-card-title">离线复盘 · 技能聚类</div>
                <div className="event-card-agent">👑 紫微</div>
                <div className="event-card-meta"><span>02:00 · 生成 1 个技能</span><span className="event-badge" style={{background:'rgba(42,157,92,0.1)',color:'var(--jade)'}}>成功</span></div>
                <div className="event-cron">cron: 0 2 * * * · 进化引擎</div>
              </div>
            </div>
          </div>

          <div className="lane failed">
            <div className="lane-header">✗ 失败 (1)</div>
            <div className="lane-body">
              <div className="event-card">
                <div className="event-card-title">数据迁移</div>
                <div className="event-card-agent">👑 紫微</div>
                <div className="event-card-meta"><span>昨天 · 重试 2</span><span className="event-badge" style={{background:'rgba(196,92,60,0.1)',color:'var(--cinnabar)'}}>失败</span></div>
                <div className="event-cron" style={{color:'var(--cinnabar)'}}>Provider "openai" not found</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
