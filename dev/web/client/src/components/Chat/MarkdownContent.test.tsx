/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import type { ReactElement } from 'react'
import MarkdownContent from './MarkdownContent'

// react-dom 的 act() 需要显式环境标记（React 18）。
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

interface Rendered {
  host: HTMLDivElement
  root: ReturnType<typeof createRoot>
  rerender: (content: string, streaming: boolean) => void
  unmount: () => void
}

function mount(element: ReactElement): Rendered {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => { root.render(element) })
  return {
    host,
    root,
    rerender: (content, streaming) => {
      act(() => { root.render(<MarkdownContent content={content} streaming={streaming} />) })
    },
    unmount: () => {
      act(() => { root.unmount() })
      host.remove()
    },
  }
}

const frozenEls = (host: HTMLDivElement) => Array.from(host.querySelectorAll('.md-frozen'))
const tailEl = (host: HTMLDivElement) => host.querySelector('.md-tail')

describe('MarkdownContent streaming render', () => {
  it('renders frozen blocks plus one tail container while streaming', () => {
    // 4 个顶层块（标题/段落/列表/段落）→ 冻结前 2 块，尾部 2 块。
    const src = '# t\n\npara one\n\n- a\n- b\n\nlast\n'
    const r = mount(<MarkdownContent content={src} streaming />)
    try {
      expect(frozenEls(r.host).length).toBe(2)
      expect(frozenEls(r.host)[0].innerHTML).toContain('<h1>t</h1>')
      expect(tailEl(r.host)).not.toBeNull()
      expect(tailEl(r.host)!.innerHTML).toContain('<li>a</li>')
      expect(tailEl(r.host)!.innerHTML).toContain('last')
    } finally {
      r.unmount()
    }
  })

  it('freezes more blocks as the stream grows; stable keys keep element identity', () => {
    const r = mount(<MarkdownContent content={'# t\n\npara one\n\n- a\n- b\n\nlast\n'} streaming />)
    try {
      const firstFrozen = frozenEls(r.host)[0]
      expect(firstFrozen).toBeDefined()

      // 追加更多块：标题/段落/列表/last 进入冻结区，尾部只剩新块。
      r.rerender('# t\n\npara one\n\n- a\n- b\n\nlast\n\nmore\n\neven more\n', true)
      const now = frozenEls(r.host)
      expect(now.length).toBe(4)
      // React 按稳定 key 复用同一 DOM 元素（不重挂）。
      expect(now[0]).toBe(firstFrozen)
      expect(tailEl(r.host)!.innerHTML).toContain('more')
      expect(tailEl(r.host)!.innerHTML).toContain('even more')
    } finally {
      r.unmount()
    }
  })

  it('falls back to a single full render when not streaming (settled)', () => {
    const src = '# t\n\npara one\n\n- a\n- b\n\nlast\n'
    const r = mount(<MarkdownContent content={src} />)
    try {
      expect(frozenEls(r.host).length).toBe(0)
      expect(tailEl(r.host)).toBeNull()
      const root = r.host.querySelector('.md-content') as HTMLElement
      expect(root).not.toBeNull()
      expect(root.innerHTML).toContain('<h1>t</h1>')
      expect(root.innerHTML).toContain('<li>a</li>')
      expect(root.innerHTML).toContain('last')
    } finally {
      r.unmount()
    }
  })

  it('switching from streaming to settled renders the complete document', () => {
    const src = '# t\n\npara one\n\nlast\n'
    const r = mount(<MarkdownContent content={src} streaming />)
    try {
      expect(frozenEls(r.host).length).toBeGreaterThan(0)
      r.rerender(src, false)
      expect(frozenEls(r.host).length).toBe(0)
      expect(tailEl(r.host)).toBeNull()
      expect(r.host.querySelector('.md-content')!.innerHTML).toContain('<h1>t</h1>')
    } finally {
      r.unmount()
    }
  })

  it('non-append edits (generation bump) rebuild the tail with a new key', () => {
    const r = mount(<MarkdownContent content={'# t\n\npara one\n\nlast\n'} streaming />)
    try {
      const tailBefore = tailEl(r.host)!
      // 替换中间段落（非追加）→ 组件内部 generation 递增，tail key 变化。
      r.rerender('# t\n\nREPLACED\n\nlast\n', true)
      const tailAfter = tailEl(r.host)!
      expect(tailAfter).not.toBe(tailBefore)
      expect(tailAfter.innerHTML).toContain('REPLACED')
    } finally {
      r.unmount()
    }
  })

  describe('file-path autolink', () => {
    const html = (content: string) => {
      const r = mount(<MarkdownContent content={content} />)
      const out = (r.host.querySelector('.md-content') as HTMLElement).innerHTML
      r.unmount()
      return out
    }

    it('links a relative path mentioned in prose (Chinese dir + extension)', () => {
      const out = html('已落到文件 知识体系构建/04-0期-地基与进化解耦-可执行步骤.md（8.8KB）。')
      expect(out).toContain('ts-file-link')
      expect(out).toContain('data-path="知识体系构建/04-0期-地基与进化解耦-可执行步骤.md"')
      expect(out).toContain('data-abs="0"')
    })

    it('links an absolute Windows path and marks it absolute', () => {
      const out = html('路径 C:\\Users\\name\\file.ts 在此')
      expect(out).toContain('ts-file-link')
      expect(out).toContain('data-path="C:\\Users\\name\\file.ts"')
      expect(out).toContain('data-abs="1"')
    })

    it('does not link ordinary dotted prose without a separator', () => {
      const out = html('版本 v1.2 已发布，见 foo.txt 说明')
      expect(out).not.toContain('ts-file-link')
    })

    it('does not link paths inside inline code', () => {
      const out = html('运行 `a/b/config.json` 后重试')
      expect(out).not.toContain('ts-file-link')
    })
  })
})
