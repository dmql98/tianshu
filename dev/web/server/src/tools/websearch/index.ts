import type { ToolModule } from '../types.js'
import { z } from 'zod'
import { validate } from '../validate.js'
import { Parser } from 'htmlparser2'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36'
const MAX_RESULTS = 8
const TIMEOUT = 10000

function formatResults(query: string, items: { title: string; snippet: string; url: string }[]): string {
  if (items.length === 0) return ''
  return `Web search results for "${query}":\n\n${items.map(r => `- ${r.title}\n  ${r.snippet}\n  ${r.url}`).join('\n\n')}`
}

/** Bing search — works in most environments where DDG is blocked */
async function searchBing(query: string): Promise<{ title: string; snippet: string; url: string }[] | null> {
  try {
    const res = await fetch(`https://www.bing.com/search?q=${encodeURIComponent(query)}`, {
      signal: AbortSignal.timeout(TIMEOUT),
      headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
    })
    if (!res.ok) return null
    const html = await res.text()

    const results: { title: string; snippet: string; url: string }[] = []
    // Bing results: <li class="b_algo"> ... <h2><a href="url">title</a></h2> ... <p>snippet</p>
    const algoBlocks = html.match(/<li[^>]*class="[^"]*b_algo[^"]*"[^>]*>[\s\S]*?<\/li>/gi) || []
    for (const block of algoBlocks) {
      const linkMatch = block.match(/<h2[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i)
      const snippetMatch = block.match(/<(?:p|div)[^>]*class="[^"]*(?:b_caption|b_lineclamp2)[^"]*"[^>]*>([\s\S]*?)<\/(?:p|div)>/i)
      if (linkMatch) {
        results.push({
          title: linkMatch[2].replace(/<[^>]+>/g, '').trim(),
          url: linkMatch[1],
          snippet: snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, '').trim().replace(/\s+/g, ' ') : '',
        })
      }
      if (results.length >= MAX_RESULTS) break
    }
    return results.length > 0 ? results : null
  } catch {
    return null
  }
}

/** DuckDuckGo HD (the main HTML version) — richer results */
async function searchDDGHtml(query: string): Promise<{ title: string; snippet: string; url: string }[] | null> {
  try {
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      signal: AbortSignal.timeout(TIMEOUT),
      headers: { 'User-Agent': UA },
    })
    if (!res.ok) return null
    const html = await res.text()

    const results: { title: string; snippet: string; url: string }[] = []
    const resultBlocks = html.match(/<div[^>]*class="[^"]*result[^"]*"[^>]*>[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/gi) || []
    for (const block of resultBlocks) {
      const linkMatch = block.match(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i)
      const snippetMatch = block.match(/<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i)
      if (linkMatch) {
        results.push({
          title: linkMatch[2].replace(/<[^>]+>/g, '').trim(),
          url: linkMatch[1],
          snippet: snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, '').trim() : '',
        })
      }
      if (results.length >= MAX_RESULTS) break
    }
    return results.length > 0 ? results : null
  } catch {
    return null
  }
}

/** DuckDuckGo Lite */
async function searchDDGLite(query: string): Promise<{ title: string; snippet: string; url: string }[] | null> {
  try {
    const res = await fetch(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`, {
      signal: AbortSignal.timeout(TIMEOUT),
      headers: { 'User-Agent': UA },
    })
    if (!res.ok) return null
    const html = await res.text()
    const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || []
    const results: { title: string; snippet: string; url: string }[] = []
    for (const row of rows) {
      const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi)
      if (!cells || cells.length < 2) continue
      const linkA = cells[0].match(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i)
      if (linkA) {
        const title = linkA[2].replace(/<[^>]+>/g, '').trim()
        const snippet = cells[1]?.replace(/<[^>]+>/g, '').trim() || ''
        const url = linkA[1]
        if (title) results.push({ title, snippet, url })
      }
      if (results.length >= MAX_RESULTS) break
    }
    return results.length > 0 ? results : null
  } catch {
    return null
  }
}

export const tool: ToolModule = {
  name: 'websearch',
  description: 'Search the web for recent information. Returns a list of search results with titles, snippets, and URLs.',
  parameters: {
    type: 'object',
    properties: { query: { type: 'string', description: 'The search query' } },
    required: ['query'],
  },
  execute: async (args) => {
    const input = validate(
      z.object({ query: z.string().min(1, 'query 不能为空') }),
      args, 'websearch',
    )
    const query = input.query

    // Backend 1: Custom API (if configured)
    const searchApiUrl = process.env.SEARCH_API_URL
    if (searchApiUrl) {
      try {
        const res = await fetch(`${searchApiUrl}?q=${encodeURIComponent(query)}`, {
          signal: AbortSignal.timeout(TIMEOUT),
        })
        if (res.ok) {
          const json = await res.json()
          const items = (json.results || json.items || []).slice(0, MAX_RESULTS).map((r: any) => ({
            title: r.title || '',
            snippet: r.snippet || '',
            url: r.url || r.link || '',
          }))
          if (items.length > 0) return { output: formatResults(query, items) }
        }
      } catch (e: any) {
        console.warn(`[websearch] Custom API failed: ${e.message}`)
      }
    }

    // Backend 2: Bing (works where DDG/Google are blocked)
    const bingResults = await searchBing(query)
    if (bingResults) return { output: formatResults(query, bingResults) }

    // Backend 3: DuckDuckGo HTML (richer results)
    const htmlResults = await searchDDGHtml(query)
    if (htmlResults) return { output: formatResults(query, htmlResults) }

    // Backend 4: DuckDuckGo Lite (last resort)
    const liteResults = await searchDDGLite(query)
    if (liteResults) return { output: formatResults(query, liteResults) }

    return { output: '', error: `No search results found for "${query}"` }
  },
}
