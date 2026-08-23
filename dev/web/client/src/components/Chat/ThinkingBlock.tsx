import { memo, useState } from 'react'
import MarkdownContent from './MarkdownContent'
import { useI18n } from '@/i18n'

interface Props {
  content: string
  duration?: number
  defaultExpanded?: boolean
  /** 流式模式：思考内容逐 token 到达，增量渲染只更新尾部块。 */
  streaming?: boolean
}

export default memo(function ThinkingBlock({ content, duration, defaultExpanded = false, streaming = false }: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const t = useI18n()

  return (
    <div className="thinking-block">
      <button
        type="button"
        className="th-header"
        onClick={() => setExpanded(v => !v)}
        aria-expanded={expanded}
      >
        ◈ {t('思考中')} {duration ? `· ${(duration / 1000).toFixed(1)}s` : ''}
        <span className="th-caret">{expanded ? '▾' : '▸'}</span>
      </button>
      {expanded && <MarkdownContent content={content} streaming={streaming} />}
    </div>
  )
})
