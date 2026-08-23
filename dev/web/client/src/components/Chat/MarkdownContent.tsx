import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import MarkdownIt from 'markdown-it'
import type { Token } from 'markdown-it'
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

// ── File-path autolink ───────────────────────────────────────────────────────
// Detect tokens that look like a file path inside plain text and wrap them in
// <a class="ts-file-link">. Paths must contain at least one separator and end in
// a file extension, so ordinary prose (e.g. "v1.2", "foo.txt" with no slash) is
// left alone. Windows drive roots (C:\) and leading / are treated as absolute.
const PATH_CHAR = '[^\\s()\\[\\]`*<>|"\'（）\\r\\n]'
const PATH_RE = new RegExp(
  '(?:[A-Za-z]:[\\\\/]|[\\\\/])?' +
    '(?:' + PATH_CHAR + '+[\\\\/])+' +
    PATH_CHAR + '+\\.[A-Za-z0-9]{1,12}\\b',
  'g',
)

const isAbsolutePath = (p: string) => /^[A-Za-z]:[\\/]/.test(p) || /^[\\/]/.test(p) || p.startsWith('\\\\')

// markdown-it core rule: runs after inline parse (and after linkify), so already
// linkified URLs are link_open/close tokens and get skipped via the inLink guard.
md.core.ruler.push('file_ref', (state) => {
  const tokens = state.tokens
  for (let i = 0; i < tokens.length; i++) {
    const block = tokens[i]
    if (block.type !== 'inline' || !block.children) continue
    const out: Token[] = []
    let inLink = 0
    for (const child of block.children) {
      if (child.type === 'link_open') inLink++
      else if (child.type === 'link_close') inLink = Math.max(0, inLink - 1)
      if (child.type !== 'text' || inLink > 0) {
        out.push(child)
        continue
      }
      const text = child.content
      PATH_RE.lastIndex = 0
      let m: RegExpExecArray | null
      let last = 0
      let matchedAny = false
      const segs: Token[] = []
      while ((m = PATH_RE.exec(text)) !== null) {
        const path = m[0]
        const start = m.index
        if (start > last) {
          const pre = new state.Token('text', '', 0)
          pre.content = text.slice(last, start)
          segs.push(pre)
        }
        const open = new state.Token('ts_file_link_open', 'a', 1)
        open.attrs = [
          ['class', 'ts-file-link'],
          ['href', '#'],
          ['data-path', path],
          ['data-abs', isAbsolutePath(path) ? '1' : '0'],
          ['title', path],
        ]
        const inner = new state.Token('text', '', 0)
        inner.content = path
        const close = new state.Token('ts_file_link_close', 'a', -1)
        segs.push(open, inner, close)
        last = start + path.length
        matchedAny = true
        if (path.length === 0) PATH_RE.lastIndex++ // safety against zero-width loops
      }
      if (!matchedAny) {
        out.push(child)
        continue
      }
      if (last < text.length) {
        const post = new state.Token('text', '', 0)
        post.content = text.slice(last)
        segs.push(post)
      }
      out.push(...segs)
    }
    block.children = out
  }
})

// ── Path resolution / open helpers ───────────────────────────────────────────
function dirOf(p: string): string {
  const sep = p.includes('\\') ? '\\' : '/'
  const parts = p.split(sep)
  parts.pop()
  return parts.join(sep) || sep
}

function resolvePath(rawPath: string, workspace?: string): string {
  if (isAbsolutePath(rawPath)) return rawPath
  if (!workspace) return rawPath
  const ws = workspace.replace(/\\/g, '/').replace(/\/$/, '')
  const rel = rawPath.replace(/\\/g, '/').replace(/^\//, '')
  return `${ws}/${rel}`
}

async function openTarget(absPath: string): Promise<void> {
  const api = window.tianshuDesktop
  if (api?.openPath) {
    try {
      const ok = await api.openPath(absPath)
      if (ok) return
    } catch {
      // fall through to the server route
    }
  }
  try {
    await fetch('/api/workspace/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: absPath }),
    })
  } catch {
    // filesystem open is best-effort; ignore network/OS failures
  }
}

interface Props {
  content: string
  /** 流式模式：增量渲染，只更新尾部块；终态（默认）全量渲染保证质量。 */
  streaming?: boolean
  /** 当前会话的项目根目录，用于把相对路径解析为绝对路径。 */
  workspace?: string
}

interface FileMenuState {
  x: number
  y: number
  absPath: string
  dirPath: string
}

/**
 * 流式 Markdown 渲染（对齐 DSH 增量渲染思路）：
 * - streaming=false：md.render 全量渲染（历史消息/终态，一次到位）
 * - streaming=true：IncrementalMarkdown 分块缓存，冻结块 HTML 不变，
 *   React 只更新尾部 1~2 个块的容器；DOM 操作从 O(全文) 降到 O(尾部)
 */
export default memo(function MarkdownContent({ content, streaming = false, workspace }: Props) {
  const incRef = useRef<IncrementalMarkdown | null>(null)
  const [menu, setMenu] = useState<FileMenuState | null>(null)

  const view = useMemo(() => {
    if (!streaming) {
      incRef.current = null
      return { kind: 'settled', html: md.render(content || '') } as const
    }
    if (!incRef.current) incRef.current = new IncrementalMarkdown(md)
    const r = incRef.current.update(content || '')
    return { kind: 'stream', ...r } as const
  }, [content, streaming])

  const handleClick = useCallback((e: MouseEvent<HTMLDivElement>) => {
    const a = (e.target as HTMLElement).closest('a.ts-file-link') as HTMLAnchorElement | null
    if (!a) return
    e.preventDefault()
    const rawPath = a.getAttribute('data-path') || ''
    if (!rawPath) return
    const absPath = resolvePath(rawPath, workspace)
    const dirPath = dirOf(absPath)
    if (e.ctrlKey || e.metaKey) {
      void openTarget(absPath)
      return
    }
    setMenu({ x: e.clientX, y: e.clientY, absPath, dirPath })
  }, [workspace])

  // Close the popover on any outside interaction.
  useEffect(() => {
    if (!menu) return
    const onDown = (ev: globalThis.MouseEvent) => {
      if ((ev.target as HTMLElement).closest('.ts-file-menu')) return
      setMenu(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menu])

  const closeMenu = () => setMenu(null)

  if (view.kind === 'settled') {
    return (
      <>
        <div className="md-content" dangerouslySetInnerHTML={{ __html: view.html }} onClick={handleClick} />
        {menu && (
          <div className="ts-file-menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
            <button type="button" onClick={() => { void openTarget(menu.absPath); closeMenu() }}>{'\u6253\u5f00\u6587\u4ef6'}</button>
            <button type="button" onClick={() => { void openTarget(menu.dirPath); closeMenu() }}>{'\u6253\u5f00\u6587\u4ef6\u6240\u5728\u76ee\u5f55'}</button>
          </div>
        )}
      </>
    )
  }

  return (
    <>
      <div className="md-content" onClick={handleClick}>
        {view.frozen.map((block) => (
          <div key={block.key} className="md-frozen" dangerouslySetInnerHTML={{ __html: block.html }} />
        ))}
        <div key={`tail-${view.generation}`} className="md-tail" dangerouslySetInnerHTML={{ __html: view.tailHtml }} />
      </div>
      {menu && (
        <div className="ts-file-menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          <button type="button" onClick={() => { void openTarget(menu.absPath); closeMenu() }}>{'\u6253\u5f00\u6587\u4ef6'}</button>
          <button type="button" onClick={() => { void openTarget(menu.dirPath); closeMenu() }}>{'\u6253\u5f00\u6587\u4ef6\u6240\u5728\u76ee\u5f55'}</button>
        </div>
      )}
    </>
  )
})
