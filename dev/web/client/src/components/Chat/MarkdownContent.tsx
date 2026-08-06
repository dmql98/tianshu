import { useMemo } from 'react'
import MarkdownIt from 'markdown-it'

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
}

export default function MarkdownContent({ content }: Props) {
  const html = useMemo(() => md.render(content || ''), [content])
  return <div className="md-content" dangerouslySetInnerHTML={{ __html: html }} />
}