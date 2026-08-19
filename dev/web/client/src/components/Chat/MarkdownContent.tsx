import { memo, useMemo, useRef } from 'react'
import MarkdownIt from 'markdown-it'
import { IncrementalMarkdown } from './incremental-markdown'

// Only allow safe URL schemes (block javascript: / data: / vbscript: XSS vectors).
const SAFE_LINK = /^(?:https?:|mailto:|#|\/)/i

const md = new MarkdownIt({
  html: false, // escape any raw HTML in source → XSS-safe by default
  linkify: true,
  breaks: true, // match legacy per-line <br/> bubble rendering
  typographer: true,
})

md.validateLink = (url: string) => SAFE_LINK.test(url.trim().replace(/^<|>$/g, ''))

// Wrap <table> in a scrollable container so wide tables don't overflow the bubble.
const wrapBlock = (rule: string, before: string, after: string) => {
  const inner = md.renderer.rules[rule] || ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))
  md.renderer.rules[rule] = (tokens, idx, options, env, self) =>
    before + inner(tokens, idx, options, env, self) + after
}
wrapBlock('table_open', '<div class="md-table">', '')
wrapBlock('table_close', '', '</div>')

interface Props {
  content: string
  /** 流式模式：增量渲染，只更新尾部块；终态（默认）全量渲染保证质量。 */
  streaming?: boolean
}

/**
 * 流式 Markdown 渲染（对齐 DSH 增量渲染思路）：
 * - streaming=false：md.render 全量渲染（历史消息/终态，一次到位）
 * - streaming=true：IncrementalMarkdown 分块缓存，冻结块 HTML 不变，
 *   React 只更新尾部 1~2 个块的容器；DOM 操作从 O(全文) 降到 O(尾部)
 */
export default memo(function MarkdownContent({ content, streaming = false }: Props) {
  const incRef = useRef<IncrementalMarkdown | null>(null)
  const view = useMemo(() => {
    if (!streaming) {
      incRef.current = null
      return { kind: 'settled', html: md.render(content || '') } as const
    }
    if (!incRef.current) incRef.current = new IncrementalMarkdown(md)
    const r = incRef.current.update(content || '')
    return { kind: 'stream', ...r } as const
  }, [content, streaming])

  if (view.kind === 'settled') {
    return <div className="md-content" dangerouslySetInnerHTML={{ __html: view.html }} />
  }

  return (
    <div className="md-content">
      {view.frozen.map(block => (
        <div key={block.key} className="md-frozen" dangerouslySetInnerHTML={{ __html: block.html }} />
      ))}
      <div key={`tail-${view.generation}`} className="md-tail" dangerouslySetInnerHTML={{ __html: view.tailHtml }} />
    </div>
  )
})
