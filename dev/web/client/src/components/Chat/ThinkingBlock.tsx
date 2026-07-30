import { useState } from 'react'

interface Props {
  content: string
  duration?: number
  defaultExpanded?: boolean
}

export default function ThinkingBlock({ content, duration, defaultExpanded = false }: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  return (
    <div className="thinking-block" onClick={() => setExpanded(!expanded)}>
      <div className="th-header">
        ◈ 思考中 {duration ? `· ${(duration / 1000).toFixed(1)}s` : ''}
      </div>
      {expanded && <div>{content}</div>}
    </div>
  )
}
