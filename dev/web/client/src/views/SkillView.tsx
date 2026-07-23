export default function SkillView() {
  return (
    <div className="main">
      <div className="page-header">
        <span className="page-title">技能管理</span>
        <div className="header-actions">
          <button className="btn primary">+ 新建技能</button>
        </div>
      </div>
      <div className="content">
        <div className="empty-state">
          <div className="empty-title">技能管理</div>
          <div className="empty-hint">功能开发中...</div>
        </div>
      </div>
    </div>
  )
}
