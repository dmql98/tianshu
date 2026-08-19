import { describe, expect, it } from 'vitest'
import MarkdownIt from 'markdown-it'
import { IncrementalMarkdown } from './incremental-markdown'

const md = new MarkdownIt({ html: false, linkify: true, breaks: true, typographer: true })

function frozenKeys(r: { frozen: readonly { key: number }[] }): number[] {
  return r.frozen.map(b => b.key)
}

describe('IncrementalMarkdown', () => {
  it('freezes stable prefix blocks and only keeps the tail unstable', () => {
    const inc = new IncrementalMarkdown(md)
    // 4 个顶层块：标题 / 段落 / 列表 / 段落
    const src = '# t\n\npara one\n\n- a\n- b\n\nlast\n'
    const r1 = inc.update(src)
    // 4 块 - 保留 2 块尾部 → 冻结前 2 块
    expect(frozenKeys(r1)).toEqual([0, 2])
    expect(r1.tailHtml).toContain('<li>a</li>')
    expect(r1.tailHtml).toContain('last')
  })

  it('monotonically freezes as the stream grows (append-only)', () => {
    const inc = new IncrementalMarkdown(md)
    const r1 = inc.update('# t\n\npara one\n\n- a\n- b\n\nlast\n')
    expect(frozenKeys(r1)).toEqual([0, 2])
    // 追加更多块：旧的尾部应进入冻结区（块起始行号 4=列表、7=last、9=more）
    const r2 = inc.update('# t\n\npara one\n\n- a\n- b\n\nlast\n\nmore\n\neven more\n')
    expect(frozenKeys(r2)).toEqual([0, 2, 4, 7])
    // 冻结块的 HTML 不变（缓存复用）
    expect(r2.frozen[0].html).toBe(r1.frozen[0].html)
    expect(r2.frozen[1].html).toBe(r1.frozen[1].html)
    expect(r2.tailHtml).toContain('more')
    expect(r2.tailHtml).toContain('even more')
  })

  it('resets cache with a new generation on non-append input (edits)', () => {
    const inc = new IncrementalMarkdown(md)
    inc.update('# t\n\npara one\n\n- a\n- b\n\nlast\n')
    const r2 = inc.update('# t\n\nREPLACED\n\n- a\n- b\n\nlast\n')
    expect(r2.generation).toBe(1)
    expect(frozenKeys(r2)).toEqual([0, 2])
    // 编辑后整篇重渲：被替换段落是第 2 个块，HTML 包含新文本
    expect(r2.frozen[0].html).toContain('<h1>t</h1>')
    expect(r2.frozen[1].html).toContain('REPLACED')
  })

  it('returns the cached result for identical input (idempotent)', () => {
    const inc = new IncrementalMarkdown(md)
    const src = '# t\n\npara\n'
    const r1 = inc.update(src)
    const r2 = inc.update(src)
    expect(r2).toBe(r1)
  })

  it('keeps a growing fence block unstable until it closes', () => {
    const inc = new IncrementalMarkdown(md)
    // 未闭合 fence：标题 + fence 共 2 块，全部保留在尾部 → 不冻结
    const r1 = inc.update('# t\n\n```js\nlet a = 1\n')
    expect(frozenKeys(r1)).toEqual([])
    // 闭合后出现新块：heading/fence/after 共 3 块，冻结前 1 块（heading）
    const r2 = inc.update('# t\n\n```js\nlet a = 1\n```\n\nafter\n')
    expect(frozenKeys(r2)).toEqual([0])
    expect(r2.tailHtml).toContain('let a = 1')
    expect(r2.tailHtml).toContain('after')
  })
})
