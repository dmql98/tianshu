import { memo } from 'react'
import Icon from '@/features/icons/Icon'
import MarkdownContent from '@/components/Chat/MarkdownContent'
import { useI18n } from '@/i18n'
import type { KnowledgeFileEntry } from '@/api/knowledge'

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

function formatTime(ms: number): string {
  try {
    return new Date(ms).toLocaleString()
  } catch {
    return ''
  }
}

/**
 * 文档预览（F1）：未选中 → 占位；选中 → Markdown 渲染全文 + 文件元信息。
 * 复用聊天用的 MarkdownContent（markdown-it，XSS-safe），零新增依赖。
 */
function KnowledgePreview({ file, content }: { file: KnowledgeFileEntry | null; content: string }) {
  const t = useI18n()
  if (!file) {
    return (
      <div className="preview-body">
        <div className="preview-empty-icon"><Icon name="preview" size={20} ariaHidden /></div>
        <div className="preview-empty-text">{t('选择文档查看详情')}</div>
      </div>
    )
  }
  return (
    <div className="preview-body">
      <div className="preview-title">{file.name}</div>
      <div className="preview-sub">
        <span className="tag">{file.ext.replace('.', '')}</span>
        <span>{formatBytes(file.size)}</span>
        <span>{t('更新于 {time}', { time: formatTime(file.mtimeMs) })}</span>
      </div>
      <div className="md">
        <MarkdownContent content={content} />
      </div>
    </div>
  )
}

export default memo(KnowledgePreview)
