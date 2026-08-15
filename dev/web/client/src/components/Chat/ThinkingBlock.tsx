import { useState } from 'react'
import MarkdownContent from './MarkdownContent'
import { useI18n } from '@/i18n'

interface Props {
  content: string
  duration?: number
  defaultExpanded?: boolean
}

export default function ThinkingBlock({ content, duration, defaultExpanded = false }: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const t = useI18n()

  return (
    <div className="thinking-block" onClick={() => setExpanded(!expanded)}>
      <div className="th-header">
        ◈ {t('思考中')} {duration ? `· ${(duration / 1000).toFixed(1)}s` : ''}
      </div>
      {expanded && <MarkdownContent content={content} />}
    </div>
  )
}
