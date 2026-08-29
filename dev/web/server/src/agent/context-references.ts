import * as fs from 'fs'
import * as path from 'path'
import { getDataDir, envInt } from '../config.js'
import { estimateTextTokens } from './loop/loop-policy.js'

export interface ContextReference {
  raw: string
  kind: 'file' | 'folder' | 'url'
  target: string
  start: number
  end: number
  lineStart: number | null
  lineEnd: number | null
}

export interface ContextReferenceResult {
  message: string
  originalMessage: string
  references: ContextReference[]
  warnings: string[]
  injectedTokens: number
  expanded: boolean
  blocked: boolean
}

const MAX_FILE_BYTES = 100 * 1024
const MAX_TOTAL_BYTES = 200 * 1024
const SOFT_LIMIT_BYTES = 100 * 1024

// P0-1 cross-Run rebuild memo cache
// buildInitialMessages runs once per Run and re-expands every @file/@folder/@url user
// reference (context-builder.ts:336 -> expandContextReferences). File expansion is
// deterministic (content derive from the file), so validate by (resolved, mtimeMs, size)
// and reuse the cached content instead of reading the file again each Run - the main
// cross-Run rebuild waste. URLs have no mtime/size to judge, so use a TTL cache to avoid
// re-fetching within a short window; failures are never cached (a transient network error
// must not be frozen into later Runs). Folder trees are not cached (readdir is cheap, and
// nested edits may not bump the parent dir mtime, risking a stale tree). Caches are bounded.
const URL_MEMO_TTL_MS = envInt('TSS_URL_CACHE_TTL_MS', 60_000)
const MEMO_MAX = 256

interface FileMemoEntry { mtimeMs: number; size: number; content: string }
const fileMemo = new Map<string, FileMemoEntry>()
interface UrlMemoEntry { ts: number; content: string }
const urlMemo = new Map<string, UrlMemoEntry>()

function memoSet<K, V>(map: Map<K, V>, key: K, value: V, max: number): void {
  if (map.size >= max) {
    const first = map.keys().next().value
    if (first !== undefined) map.delete(first)
  }
  map.set(key, value)
}
const SENSITIVE_PATTERNS = [
  /[/\\]\.ssh[/\\]/,
  /[/\\]\.aws[/\\]/,
  /[/\\]\.config[/\\]/,
  /[/\\]\.git[/\\]/,
  /[/\\]\.env$/,
  /[/\\]\.env\./,
  /[/\\]credentials$/,
  /[/\\]id_rsa$/,
  /[/\\]id_ed25519$/,
  /[/\\]known_hosts$/,
  /[/\\]config\.json$/i,
  /[/\\]token[s]?$/i,
  /[/\\]secret[s]?$/i,
  /[/\\]key[s]?$/i,
]

const REFERENCE_PATTERN = /@(?<kind>file|folder|url):(?<value>"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|(?:[\w./\\-]+(?::\d+(?:-\d+)?)?))/g

function stripQuotes(value: string): string {
  if (value.length >= 2 && (value[0] === '"' || value[0] === "'" || value[0] === '`')) {
    return value.slice(1, -1)
  }
  return value
}

function isSensitive(absPath: string): boolean {
  const normalized = absPath.replace(/\\/g, '/')
  return SENSITIVE_PATTERNS.some(p => p.test(normalized))
}

function parseLineRange(value: string): { path: string; lineStart: number | null; lineEnd: number | null } {
  const rangeMatch = value.match(/^(.+?):(\d+)(?:-(\d+))?$/)
  if (rangeMatch) {
    return {
      path: rangeMatch[1],
      lineStart: parseInt(rangeMatch[2]),
      lineEnd: rangeMatch[3] ? parseInt(rangeMatch[3]) : parseInt(rangeMatch[2]),
    }
  }
  return { path: value, lineStart: null, lineEnd: null }
}

function truncateContent(content: string, maxBytes: number): string {
  const encoder = new TextEncoder()
  const encoded = encoder.encode(content)
  if (encoded.length <= maxBytes) return content
  const truncated = new TextDecoder('utf-8', { fatal: false }).decode(encoded.slice(0, maxBytes))
  return truncated + '\n... [truncated]'
}

function formatFileTree(dirPath: string, workspace: string, prefix = ''): string[] {
  const lines: string[] = []
  let entries: string[]
  try {
    entries = fs.readdirSync(dirPath).sort()
  } catch {
    return lines
  }
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    const fullPath = path.join(dirPath, entry)
    const isLast = i === entries.length - 1
    const connector = isLast ? '└── ' : '├── '
    const relPath = path.relative(workspace, fullPath)
    let stat: fs.Stats
    try {
      stat = fs.statSync(fullPath)
    } catch {
      lines.push(`${prefix}${connector}${entry}`)
      continue
    }
    if (stat.isDirectory()) {
      lines.push(`${prefix}${connector}${entry}/`)
      const subPrefix = prefix + (isLast ? '    ' : '│   ')
      lines.push(...formatFileTree(fullPath, workspace, subPrefix))
    } else {
      const size = stat.size
      const sizeStr = size > 1024 ? `${(size / 1024).toFixed(1)} KB` : `${size} B`
      lines.push(`${prefix}${connector}${entry} (${sizeStr})`)
    }
  }
  return lines
}

function expandFileReference(target: string, workspace: string, allowedRoot: string): { content: string; warning?: string } | null {
  const resolved = path.resolve(workspace, target)
  if (!resolved.startsWith(allowedRoot)) {
    return null
  }
  if (!fs.existsSync(resolved)) {
    return null
  }
  if (isSensitive(resolved)) {
    return {
      content: `[Skipped sensitive path: ${target}]`,
      warning: `Skipped sensitive file: ${target}`,
    }
  }
  let stat: fs.Stats
  try {
    stat = fs.statSync(resolved)
  } catch {
    return null
  }
  if (stat.isDirectory()) {
    return {
      content: `📁 @folder:${target}/\n${formatFileTree(resolved, workspace).join('\n')}`,
    }
  }
  if (stat.size > MAX_FILE_BYTES) {
    return {
      content: `[File too large: ${target} (${(stat.size / 1024).toFixed(1)} KB, max ${MAX_FILE_BYTES / 1024} KB)]`,
      warning: `Skipped oversized file: ${target}`,
    }
  }
  const mem = fileMemo.get(resolved)
  if (mem && mem.mtimeMs === stat.mtimeMs && mem.size === stat.size) {
    return { content: mem.content }
  }
  let content: string
  try {
    content = fs.readFileSync(resolved, 'utf-8')
    memoSet(fileMemo, resolved, { mtimeMs: stat.mtimeMs, size: stat.size, content }, MEMO_MAX)
  } catch {
    return {
      content: `[Binary file: ${target}]`,
      warning: `Binary file: ${target}`,
    }
  }
  return { content }
}

function expandFolderReference(target: string, workspace: string, allowedRoot: string): { content: string; warning?: string } | null {
  const resolved = path.resolve(workspace, target)
  if (!resolved.startsWith(allowedRoot)) {
    return null
  }
  if (!fs.existsSync(resolved)) {
    return null
  }
  let stat: fs.Stats
  try {
    stat = fs.statSync(resolved)
  } catch {
    return null
  }
  if (!stat.isDirectory()) {
    return { content: `[Not a directory: ${target}]` }
  }
  return {
    content: `📁 @folder:${target}/\n${formatFileTree(resolved, workspace).join('\n')}`,
  }
}

async function expandUrlReference(target: string): Promise<{ content: string; warning?: string } | null> {
  const now = Date.now()
  const cached = urlMemo.get(target)
  if (cached && now - cached.ts < URL_MEMO_TTL_MS) return { content: cached.content }
  try {
    const res = await fetch(target, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) {
      return { content: `[HTTP ${res.status}: ${target}]`, warning: `URL fetch returned ${res.status}` }
    }
    const content = await res.text()
    memoSet(urlMemo, target, { ts: now, content }, MEMO_MAX)
    return { content }
  } catch (err: any) {
    return {
      content: `[Failed to fetch: ${target}]`,
      warning: `Failed to fetch URL ${target}: ${err.message}`,
    }
  }
}

export async function preprocessContextReferences(
  message: string,
  workspace: string | undefined,
): Promise<ContextReferenceResult> {
  const originalMessage = message
  const warnings: string[] = []
  const references: ContextReference[] = []
  const allowedRoot = workspace ? path.resolve(workspace) : getDataDir()

  if (!message) {
    return { message: '', originalMessage, references, warnings, injectedTokens: 0, expanded: false, blocked: false }
  }

  const matches = Array.from(message.matchAll(REFERENCE_PATTERN))
  if (matches.length === 0) {
    return { message, originalMessage, references, warnings, injectedTokens: 0, expanded: false, blocked: false }
  }

  const expandedBlocks: { start: number; end: number; block: string }[] = []
  let totalBytes = 0

  for (const match of matches) {
    const raw = match[0]
    const kind = match.groups?.kind as ContextReference['kind']
    const rawValue = match.groups?.value || ''
    const value = stripQuotes(rawValue)
    const start = match.index!
    const end = start + raw.length
    let lineStart: number | null = null
    let lineEnd: number | null = null
    let resolvedTarget = value

    if (kind === 'file') {
      const parsed = parseLineRange(value)
      resolvedTarget = parsed.path
      lineStart = parsed.lineStart
      lineEnd = parsed.lineEnd
    }

    references.push({ raw, kind, target: resolvedTarget, start, end, lineStart, lineEnd })

    if (!workspace && kind !== 'url') {
      warnings.push(`Cannot resolve @${kind}: reference — no workspace set`)
      continue
    }

    let result: { content: string; warning?: string } | null = null

    if (kind === 'file') {
      result = expandFileReference(resolvedTarget, allowedRoot, allowedRoot)
    } else if (kind === 'folder') {
      result = expandFolderReference(resolvedTarget, allowedRoot, allowedRoot)
    } else if (kind === 'url') {
      result = await expandUrlReference(resolvedTarget)
    }

    if (!result) {
      warnings.push(`@${kind}:${value} could not be resolved`)
      continue
    }

    if (result.warning) {
      warnings.push(result.warning)
    }

    const label = lineStart ? `@${kind}:${resolvedTarget}:${lineStart}${lineEnd && lineEnd !== lineStart ? `-${lineEnd}` : ''}` : `@${kind}:${resolvedTarget}`
    const tokens = estimateTextTokens(result.content)
    let block = `[${label} (${tokens} tokens)]\n`

    if (kind === 'url') {
      block += result.content
    } else if (kind === 'folder' || (kind === 'file' && fs.existsSync(path.resolve(allowedRoot, resolvedTarget)) && fs.statSync(path.resolve(allowedRoot, resolvedTarget)).isDirectory())) {
      block += result.content
    } else if (lineStart && lineEnd) {
      const lines = result.content.split('\n')
      const sliced = lines.slice(lineStart - 1, lineEnd)
      const lang = path.extname(resolvedTarget).slice(1) || ''
      block += '```' + lang + '\n' + sliced.join('\n') + '\n```'
    } else {
      const lang = path.extname(resolvedTarget).slice(1) || ''
      block += '```' + lang + '\n' + result.content + '\n```'
    }

    const blockBytes = new TextEncoder().encode(block).length
    if (totalBytes + blockBytes > MAX_TOTAL_BYTES) {
      warnings.push(`Attachment budget exceeded, skipped: ${label}`)
      continue
    }

    if (blockBytes > SOFT_LIMIT_BYTES) {
      const truncated = truncateContent(block, SOFT_LIMIT_BYTES)
      expandedBlocks.push({ start, end, block: truncated })
      totalBytes += new TextEncoder().encode(truncated).length
      warnings.push(`${label} was truncated (${blockBytes} bytes > ${SOFT_LIMIT_BYTES} B soft limit)`)
    } else {
      expandedBlocks.push({ start, end, block })
      totalBytes += blockBytes
    }
  }

  if (expandedBlocks.length === 0) {
    return { message, originalMessage, references, warnings, injectedTokens: 0, expanded: false, blocked: false }
  }

  const segments: string[] = []
  let lastEnd = 0
  for (const block of expandedBlocks) {
    segments.push(message.slice(lastEnd, block.start))
    segments.push(block.block)
    lastEnd = block.end
  }
  segments.push(message.slice(lastEnd))

  const resultMessage = segments.join('')
  const injectedTokens = estimateTextTokens(resultMessage) - estimateTextTokens(message)

  return {
    message: resultMessage,
    originalMessage,
    references,
    warnings,
    injectedTokens,
    expanded: true,
    blocked: false,
  }
}
