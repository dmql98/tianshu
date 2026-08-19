import MarkdownIt from 'markdown-it'
import type { MarkdownIt as MarkdownItType, Token } from 'markdown-it'

/**
 * 增量 Markdown 渲染器（对齐 DSH IncrementalMarkdownParser 的思路，
 * 但基于 markdown-it 的 token 流实现——markdown-it 无 position 信息，
 * 用顶层块行号作为稳定 key）。
 *
 * 思路：流式追加文本时，只有最后 1~2 个顶层块可能改变形态（段落变标题、
 * 列表续行、fence 吞行），之前的块一旦被后续块隔开就是终态。因此：
 *  - 每帧对全文做一次 parse（markdown-it 解析本身是毫秒级纯 CPU 操作，
 *    不是卡顿主因；卡顿主因是整篇 HTML 重生成 + 整棵 DOM 替换）
 *  - 只缓存"已定型"块的渲染 HTML，React 侧每个块一个稳定 key 的容器，
 *    每帧只更新尾部 1~2 个块的 innerHTML，DOM 操作从 O(全文) 降到 O(尾部)
 *  - 非追加输入（编辑/替换）自动 generation++ 丢弃全部缓存
 *
 * 已知偏差（与 DSH 相同）：markdown-it 的 reference 链接在 parse 阶段全文
 * 解析，所以这里实际上比 DSH 更稳（引用定义跨块也能解析）；真正保留的偏差
 * 是"块内展开状态"（如折叠代码块的展开态）在冻结后不再刷新——冻结块不再
 * 重渲，这是增量渲染的固有取舍，终态（streaming=false）走全量 render 自愈。
 */

export interface FrozenBlock {
  /** 块起始行号（源文本绝对行号），追加文本不改变前面块的行号 → key 稳定 */
  readonly key: number
  readonly html: string
}

export interface IncrementalResult {
  readonly frozen: readonly FrozenBlock[]
  readonly tailHtml: string
  /** 尾部容器 key 的组成部分；generation 变化时强制 React 重建尾部容器 */
  readonly generation: number
}

/** 保留不稳定尾块数：追加文本最多重塑最后 1 块，留 1 块余量。 */
const UNSTABLE_TAIL_BLOCKS = 2

interface TopBlock {
  readonly tokens: Token[]
  readonly map: [number, number] | null
}

/** 按顶层块边界切分 markdown-it token 流（level 0 且非 _close 为边界）。 */
function splitTopLevelBlocks(tokens: Token[]): TopBlock[] {
  const blocks: TopBlock[] = []
  let start = -1
  for (let i = 0; i <= tokens.length; i++) {
    const t = tokens[i]
    const isBoundary = i === tokens.length || (t.level === 0 && !t.type.endsWith('_close'))
    if (isBoundary && start !== -1) {
      blocks.push({ tokens: tokens.slice(start, i), map: tokens[start].map })
      start = -1
    }
    if (isBoundary && start === -1 && i < tokens.length) start = i
  }
  return blocks
}

export class IncrementalMarkdown {
  private readonly md: MarkdownItType
  private prevText: string | null = null
  private generation = 0
  private frozen: FrozenBlock[] = []
  private cached: IncrementalResult | null = null

  constructor(md: MarkdownItType) {
    this.md = md
  }

  update(text: string): IncrementalResult {
    if (this.cached !== null && text === this.prevText) return this.cached
    // 非追加输入（编辑/替换/切换）：丢弃全部冻结缓存，重新开始。
    if (this.prevText !== null && !text.startsWith(this.prevText)) {
      this.generation++
      this.frozen = []
    }
    this.prevText = text

    const tokens = this.md.parse(text, {})
    const blocks = splitTopLevelBlocks(tokens)
    const firstUnstable = Math.max(0, blocks.length - UNSTABLE_TAIL_BLOCKS)

    // 冻结前 firstUnstable 个块：命中缓存直接复用，否则渲染并缓存。
    const frozen: FrozenBlock[] = []
    for (let i = 0; i < firstUnstable; i++) {
      const block = blocks[i]
      const key = block.map?.[0] ?? i
      const existing = this.frozen.find(f => f.key === key)
      if (existing) {
        frozen.push(existing)
      } else {
        const html = this.md.renderer.render(block.tokens, this.md.options, {})
        const fb = { key, html }
        frozen.push(fb)
        this.frozen.push(fb)
      }
    }

    const tailTokens = blocks.slice(firstUnstable).flatMap(b => b.tokens)
    const tailHtml = this.md.renderer.render(tailTokens, this.md.options, {})

    this.cached = { frozen, tailHtml, generation: this.generation }
    return this.cached
  }
}
