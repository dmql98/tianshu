import type { ToolModule } from '../types.js'
import { Parser } from 'htmlparser2'
import TurndownService from 'turndown'
import { JSDOM } from 'jsdom'
import { Readability } from '@mozilla/readability'
import { z } from 'zod'
import { validate } from '../validate.js'

const turndown = new TurndownService({
  headingStyle: 'atx',
  hr: '---',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  emDelimiter: '*',
})
turndown.remove(['script', 'style', 'meta', 'link'])

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024
const DEFAULT_TIMEOUT_SECONDS = 30
const MAX_TIMEOUT_SECONDS = 120

function extractTextFromHTML(html: string): string {
  let text = ''
  let skipDepth = 0
  const parser = new Parser({
    onopentag(name) {
      if (skipDepth > 0 || ['script', 'style', 'noscript', 'iframe', 'object', 'embed'].includes(name)) {
        skipDepth++
      }
    },
    ontext(input) {
      if (skipDepth === 0) text += input
    },
    onclosetag() {
      if (skipDepth > 0) skipDepth--
    },
  })
  parser.write(html)
  parser.end()
  return text.trim()
}

function extractReadableHTML(html: string, url: string): string | null {
  try {
    const dom = new JSDOM(html, { url })
    const article = new Readability(dom.window.document).parse()
    return article?.content ?? null
  } catch {
    return null
  }
}

function isTextualMime(mime: string): boolean {
  return !mime ||
    mime.startsWith('text/') ||
    mime === 'application/json' ||
    mime.endsWith('+json') ||
    mime === 'application/xml' ||
    mime.endsWith('+xml') ||
    mime === 'application/javascript' ||
    mime === 'application/x-javascript'
}

function isImageMime(mime: string): boolean {
  return mime.startsWith('image/') && mime !== 'image/svg+xml'
}

export const tool: ToolModule = {
  name: 'webfetch',
  description: `Fetch content from an HTTP or HTTPS URL and return it as text, markdown, or HTML. Markdown is the default.
Use this when you need to retrieve content from a specific URL.`,
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'The HTTP or HTTPS URL to fetch content from' },
      format: {
        type: 'string',
        enum: ['text', 'markdown', 'html'],
        description: 'The format to return the content in (text, markdown, or html). Defaults to markdown.',
      },
      readable: {
        type: 'boolean',
        description: 'When true, extract the main article content (Reader Mode) before converting. Only applies to HTML pages. Defaults to false.',
      },
      timeout: {
        type: 'number',
        description: `Optional timeout in seconds (maximum: ${MAX_TIMEOUT_SECONDS})`,
      },
    },
    required: ['url'],
  },
  execute: async (args, ctx) => {
    const input = validate(
      z.object({
        url: z.string().min(1, 'URL 不能为空'),
        format: z.enum(['text', 'markdown', 'html']).default('markdown'),
        readable: z.enum(['true', 'false']).default('false').transform(v => v === 'true'),
        timeout: z.string().optional(),
      }),
      args, 'webfetch',
    )

    const url = input.url
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return { output: '', error: 'URL must start with http:// or https://' }
    }

    const format = input.format
    const readable = input.readable
    const timeout = Math.min(
      (input.timeout ? Number(input.timeout) : DEFAULT_TIMEOUT_SECONDS) * 1000,
      MAX_TIMEOUT_SECONDS * 1000,
    )

    try {
      let acceptHeader = '*/*'
      switch (format) {
        case 'markdown':
          acceptHeader = 'text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1'
          break
        case 'text':
          acceptHeader = 'text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1'
          break
        case 'html':
          acceptHeader = 'text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, text/markdown;q=0.7, */*;q=0.1'
          break
      }

      const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
        Accept: acceptHeader,
        'Accept-Language': 'en-US,en;q=0.9',
      }

      let res = await fetch(url, { signal: AbortSignal.timeout(timeout), headers, redirect: 'follow' })

      if (res.status === 403 && res.headers.get('cf-mitigated') === 'challenge') {
        res = await fetch(url, {
          signal: AbortSignal.timeout(timeout),
          headers: { ...headers, 'User-Agent': 'opencode' },
          redirect: 'follow',
        })
      }

      if (!res.ok) return { output: '', error: `HTTP ${res.status}: ${res.statusText}` }

      const contentLength = res.headers.get('content-length')
      if (contentLength && parseInt(contentLength) > MAX_RESPONSE_BYTES) {
        return { output: '', error: `Response too large (exceeds 5MB limit)` }
      }

      const buffer = await res.arrayBuffer()
      if (buffer.byteLength > MAX_RESPONSE_BYTES) {
        return { output: '', error: `Response too large (exceeds 5MB limit)` }
      }

      const contentType = res.headers.get('content-type') || ''
      const mime = contentType.split(';')[0]?.trim().toLowerCase() || ''

      if (isImageMime(mime)) {
        const buf = Buffer.from(buffer)
        const ext = (mime.split('/')[1] || 'png').replace('+xml', '')
        const name = (url.split('/').pop()?.split(/[?#]/)[0] || `image.${ext}`) || `image.${ext}`
        return {
          output: `已获取图片（${mime}，${(buf.length / 1024).toFixed(1)} KB）：${url}`,
          attachments: [{ name, mime, data: buf.toString('base64') }],
        }
      }
      if (!isTextualMime(mime)) {
        return { output: '', error: `Unsupported content type: ${mime}` }
      }

      let content = new TextDecoder().decode(buffer)

      if (readable && contentType.includes('text/html')) {
        const readableHtml = extractReadableHTML(content, url)
        if (readableHtml) content = readableHtml
      }

      switch (format) {
        case 'markdown':
          if (contentType.includes('text/html')) {
            return { output: turndown.turndown(content) }
          }
          return { output: content }
        case 'text':
          if (contentType.includes('text/html')) {
            return { output: extractTextFromHTML(content) }
          }
          return { output: content }
        case 'html':
          return { output: content }
        default:
          return { output: content }
      }
    } catch (e: any) {
      if (e.name === 'TimeoutError' || e.name === 'AbortError') {
        return { output: '', error: 'Request timed out' }
      }
      return { output: '', error: `Fetch failed for ${url}: ${e.message || e}` }
    }
  },
}
