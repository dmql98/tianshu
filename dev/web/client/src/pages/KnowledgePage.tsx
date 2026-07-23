export default function KnowledgePage() {
  return (
    <main className="main">
      <div className="page-header">
        <div className="page-header-left">
          <span className="page-title">知识库</span>
          <span className="page-desc">管理和检索您的文档资源</span>
        </div>
        <div className="header-actions">
          <div className="header-search"><input placeholder="搜索文档..."/></div>
          <button className="btn">📁 新建文件夹</button>
          <button className="btn primary">↑ 上传文档</button>
        </div>
      </div>

      <div className="knowledge-content">
        {/* 左栏：文件夹树 */}
        <div className="tree-panel">
          <div className="tree-header">
            <span className="tree-title">文件夹</span>
            <button className="tree-add" title="新建文件夹">+</button>
          </div>
          <div className="tree-body">
            <div className="tree-item active"><span className="icon">📂</span>知识库</div>
            <div className="tree-empty">暂无文件夹</div>
          </div>
        </div>

        {/* 中栏：文档列表 */}
        <div className="doc-panel">
          <div className="doc-header">
            <span className="doc-title">文档列表</span>
            <span className="doc-count">0 个文件</span>
          </div>
          <div className="doc-breadcrumb"><span>🏠 知识库</span></div>
          <div className="doc-body">
            <div className="doc-empty-icon">📂</div>
            <div className="doc-empty-title">暂无文档</div>
            <div className="doc-empty-desc">拖拽文件到此处或点击上传</div>
            <button className="doc-empty-btn">选择文件</button>
          </div>
        </div>

        {/* 右栏：预览 */}
        <div className="preview-panel">
          <div className="preview-header">文档预览</div>
          <div className="preview-body">
            <div className="preview-empty-icon">👁️</div>
            <div className="preview-empty-text">选择文档查看详情</div>
          </div>
        </div>
      </div>
    </main>
  )
}
