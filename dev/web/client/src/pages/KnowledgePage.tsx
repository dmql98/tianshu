import { useI18n } from '@/i18n'

export default function KnowledgePage() {
  const t = useI18n()
  return (
    <main className="main">
      <div className="page-header">
        <div className="page-header-left">
          <span className="page-title">{t('知识库')}</span>
          <span className="page-desc">{t('管理和检索您的文档资源')}</span>
        </div>
        <div className="header-actions">
          <div className="header-search"><input placeholder={t('搜索文档...')}/></div>
          <button className="btn">📁 {t('新建文件夹')}</button>
          <button className="btn primary">↑ {t('上传文档')}</button>
        </div>
      </div>

      <div className="knowledge-content">
        {/* 左栏：文件夹树 */}
        <div className="tree-panel">
          <div className="tree-header">
            <span className="tree-title">{t('文件夹')}</span>
            <button className="tree-add" title={t('新建文件夹')}>+</button>
          </div>
          <div className="tree-body">
            <div className="tree-item active"><span className="icon">📂</span>{t('知识库')}</div>
            <div className="tree-empty">{t('暂无文件夹')}</div>
          </div>
        </div>

        {/* 中栏：文档列表 */}
        <div className="doc-panel">
          <div className="doc-header">
            <span className="doc-title">{t('文档列表')}</span>
            <span className="doc-count">{t('0 个文件')}</span>
          </div>
          <div className="doc-breadcrumb"><span>🏠 {t('知识库')}</span></div>
          <div className="doc-body">
            <div className="doc-empty-icon">📂</div>
            <div className="doc-empty-title">{t('暂无文档')}</div>
            <div className="doc-empty-desc">{t('拖拽文件到此处或点击上传')}</div>
            <button className="doc-empty-btn">{t('选择文件')}</button>
          </div>
        </div>

        {/* 右栏：预览 */}
        <div className="preview-panel">
          <div className="preview-header">{t('文档预览')}</div>
          <div className="preview-body">
            <div className="preview-empty-icon">👁️</div>
            <div className="preview-empty-text">{t('选择文档查看详情')}</div>
          </div>
        </div>
      </div>
    </main>
  )
}
