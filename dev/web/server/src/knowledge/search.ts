/**
 * 知识库搜索（KNOWLEDGE_P1_PLAN §2.6 / 06 §2.6 移植）。
 *
 * score_md 评分：路径/标题完整匹配 +8/+5，正文 +5；逐 term 命中 +4/+3/+min(tf,5)。
 * bestSnippet 提取第一个命中行（≤200 字符），返回行号。
 * handle = "kdoc_" + base64url(kb_id + \x1f + rel_path)。
 */
import { knowledgeStore, type KnowledgeBase, type KnowledgeFileEntry } from './store.js'

export interface KnowledgeSearchHit {
  handle: string
  kbId: string
  kbName: string
  relPath: string
  heading: string
  snippet: string
  score: number
  startLine: number
  endLine: number
}

export function encodeHandle(kbId: string, relPath: string): string {
  const raw = `${kbId}\x1f${relPath}`
  return 'kdoc_' + Buffer.from(raw, 'utf-8').toString('base64url')
}

export function decodeHandle(handle: string): { kbId: string; relPath: string } | null {
  if (!handle.startsWith('kdoc_')) return null
  try {
    const raw = Buffer.from(handle.slice(5), 'base64url').toString('utf-8')
    const sep = raw.indexOf('\x1f')
    if (sep < 0) return null
    return { kbId: raw.slice(0, sep), relPath: raw.slice(sep + 1) }
  } catch {
    return null
  }
}

export function queryTerms(queryLc: string): string[] {
  return queryLc.split(/\s+/).filter(t => t.length >= 2)
}

/** 提取文件第一个 markdown 标题（# / ## / ### …）作为 heading。 */
export function extractHeading(content: string): string {
  const m = content.match(/^\s*(#{1,6})\s+(.+)$/m)
  if (m) return m[2].trim()
  const firstLine = content.split('\n').find(l => l.trim().length > 0)
  return firstLine ? firstLine.trim().slice(0, 120) : ''
}

function bestSnippet(content: string, queryLc: string, terms: string[]): { text: string; startLine: number; endLine: number } {
  const lines = content.split('\n')
  const hitLineIdx = lines.findIndex(line => {
    const l = line.toLowerCase()
    return l.includes(queryLc) || terms.some(t => l.includes(t))
  })
  const idx = hitLineIdx >= 0 ? hitLineIdx : 0
  const line = lines[idx]?.trim() ?? ''
  const truncated = line.length > 200 ? line.slice(0, 200) + '…' : line
  return { text: truncated, startLine: idx + 1, endLine: idx + 1 }
}

export function scoreMd(
  relPath: string,
  heading: string,
  content: string,
  queryLc: string,
  terms: string[],
): [number, string, number, number] | null {
  const pathLc = relPath.toLowerCase()
  const headingLc = heading.toLowerCase()
  const contentLc = content.toLowerCase()
  let score = 0

  if (pathLc.includes(queryLc) || headingLc.includes(queryLc)) score += 8
  if (contentLc.includes(queryLc)) score += 5

  for (const t of terms) {
    if (pathLc.includes(t)) score += 4
    if (headingLc.includes(t)) score += 3
    const tf = contentLc.split(t).length - 1
    score += Math.min(tf, 5)
  }

  if (score === 0) return null

  const { text: snippet, startLine, endLine } = bestSnippet(content, queryLc, terms)
  return [score, snippet, startLine, endLine]
}

export interface SearchOptions {
  /** 限定搜索的知识库 ID 列表；缺省搜索全部。 */
  kbIds?: string[]
  /** 返回条数上限（默认 10，最大 50）。 */
  limit?: number
}

export function searchKnowledge(query: string, opts: SearchOptions = {}): KnowledgeSearchHit[] {
  const queryLc = query.toLowerCase()
  const terms = queryTerms(queryLc)
  const wanted = new Set(opts.kbIds ?? [])

  let bases = knowledgeStore.list()
  if (wanted.size > 0) bases = bases.filter(b => wanted.has(b.id))

  const hits: KnowledgeSearchHit[] = []
  for (const kb of bases) {
    const scan = knowledgeStore.listFiles(kb.id)
    if (!scan) continue
    for (const file of scan.files) {
      const doc = knowledgeStore.readFile(kb.id, file.relPath)
      if (!doc) continue
      const heading = extractHeading(doc.content)
      const scored = scoreMd(file.relPath, heading, doc.content, queryLc, terms)
      if (!scored) continue
      const [score, snippet, startLine, endLine] = scored
      hits.push({
        handle: encodeHandle(kb.id, file.relPath),
        kbId: kb.id,
        kbName: kb.name,
        relPath: file.relPath,
        heading,
        snippet,
        score,
        startLine,
        endLine,
      })
    }
  }
  hits.sort((a, b) => b.score - a.score || a.relPath.localeCompare(b.relPath))
  return hits.slice(0, opts.limit ?? 10)
}
