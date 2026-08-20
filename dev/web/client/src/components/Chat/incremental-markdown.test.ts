import { describe, expect, it } from 'vitest'
import MarkdownIt from 'markdown-it'
import { IncrementalMarkdown } from './incremental-markdown'

const md = new MarkdownIt({ html: false, linkify: true, breaks: true, typographer: true })

function plainText(html: string): string {
  // markdown-it 渲染会折叠空格；用与渲染一致的归一化比较
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, '')
}

describe('IncrementalMarkdown anti-duplication (transcript regression)', () => {
  it('streaming reasoning text must not render duplicated words', () => {
    const inc = new IncrementalMarkdown(md)
    const fragments = [
      '用户想让我研究一下今天关于agent skill的新闻。',
      '这需要搜索最新的网络信息。',
      '首先我需要知道今天的日期，',
      '然后进行网络搜索。',
    ]
    const out: string[] = []
    let acc = ''
    for (const frag of fragments) {
      acc += frag
      const r = inc.update(acc)
      out.push(plainText(r.frozen.map(b => b.html).join('') + r.tailHtml))
    }
    const final = out[out.length - 1]
    const expected = plainText(fragments.join(''))
    expect(final).toBe(expected)
    // 中间帧不允许出现"词对重复"（长度不得大于最终归一化长度）
    for (const frame of out) {
      expect(frame.length).toBeLessThanOrEqual(expected.length)
    }
  })

  it('frozen block html must be stable (never re-rendered with shifted content)', () => {
    const inc = new IncrementalMarkdown(md)
    const r1 = inc.update('# 标题\n\n用户想让我研究一下今天关于agent skill的新闻。\n这需要搜索最新的网络信息。\n\n最后一段')
    const firstFrozenHtml = r1.frozen[0]?.html
    const r2 = inc.update('# 标题\n\n用户想让我研究一下今天关于agent skill的新闻。\n这需要搜索最新的网络信息。\n\n最后一段\n\n新增段落一\n\n新增段落二')
    expect(r2.frozen.some(b => b.html === firstFrozenHtml)).toBe(true)
    const plain = plainText(r2.frozen.map(b => b.html).join('') + r2.tailHtml)
    // 期望文本用“渲染后的纯文本”构造（# 标题 会被渲染成 <h1>标题</h1>，
    // 不能把 markdown 语法记号原样留在期望串里）
    const expected = plainText('标题\n\n用户想让我研究一下今天关于agent skill的新闻。\n这需要搜索最新的网络信息。\n\n最后一段\n\n新增段落一\n\n新增段落二')
    expect(plain).toBe(expected)
  })

  it('paragraph growth mid-stream: no duplicate text at any frame', () => {
    const inc = new IncrementalMarkdown(md)
    // 无换行：单一块全在 tail；追加换行+第二段后第一段冻结
    const r1 = inc.update('用户想让我研究一下今天关于agent skill的新闻。这需要搜索最新的网络信息。首先我需要知道今天的日期，然后进行网络搜索。')
    const plain1 = plainText(r1.frozen.map(b => b.html).join('') + r1.tailHtml)
    const r2 = inc.update('用户想让我研究一下今天关于agent skill的新闻。这需要搜索最新的网络信息。首先我需要知道今天的日期，然后进行网络搜索。\n\n第二段内容')
    const plain2 = plainText(r2.frozen.map(b => b.html).join('') + r2.tailHtml)
    const expected1 = plainText('用户想让我研究一下今天关于agent skill的新闻。这需要搜索最新的网络信息。首先我需要知道今天的日期，然后进行网络搜索。')
    const expected2 = expected1 + plainText('第二段内容')
    expect(plain1).toBe(expected1)
    expect(plain2).toBe(expected2)
  })
})