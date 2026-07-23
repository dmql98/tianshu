import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import type { LLMMessage } from '../llm/client.js'

const CACHE_DIR = process.env.SYSTEM_CACHE_DIR
  ? resolve(process.env.SYSTEM_CACHE_DIR)
  : resolve(process.cwd(), '.cache/system-prompt')
mkdirSync(CACHE_DIR, { recursive: true })

const MAX_MEMORY = 50
const memCache = new Map<string, { prompt: string; hash: string; size: number; hitCount: number; createdAt: number }>()

function shortHash(v: string): string {
  return createHash('sha256').update(v).digest('hex').slice(0, 16)
}

export function normalizeTools(tools: unknown[]): Array<{ function: { name: string; description: string; parameters: any } }> {
  return [...tools]
    .map(t => t as { function: { name: string; description: string; parameters: any } })
    .sort((a, b) => {
      const na = a.function.name
      const nb = b.function.name
      if (na !== nb) return na.localeCompare(nb)
      return (a.function.description || '').localeCompare(b.function.description || '')
    })
}

export function stableKey(
  id: string,
  tools: unknown[],
  skills: string[] | undefined,
  soul: string,
  user: string,
): string {
  const t = normalizeTools(tools)
  const tStr = t.map(x => x.function.name).join(',')
  const sStr = (skills ?? []).sort().join(',')
  const raw = [
    id,
    't:', tStr,
    's:', sStr,
    'so:', shortHash(soul || ''),
    'u:', shortHash(user || ''),
  ].join('|')
  return shortHash(raw)
}

function cachePath(key: string): string {
  return resolve(CACHE_DIR, `${key}.json`)
}

export function getCached(key: string): string | null {
  const mem = memCache.get(key)
  if (mem) {
    mem.hitCount++
    return mem.prompt
  }
  const fp = cachePath(key)
  if (existsSync(fp)) {
    try {
      const data = JSON.parse(readFileSync(fp, 'utf-8'))
      memCache.set(key, {
        prompt: data.prompt,
        hash: shortHash(data.prompt),
        size: data.prompt.length,
        hitCount: 0,
        createdAt: data.createdAt ?? Date.now(),
      })
      return data.prompt
    } catch { }
  }
  return null
}

export function setCached(key: string, prompt: string): void {
  const hash = shortHash(prompt)
  // Check if cached content already matches — skip write if identical
  const existing = memCache.get(key)
  if (existing && existing.hash === hash) return

  if (memCache.size >= MAX_MEMORY) {
    let oldest = Infinity
    let oldestKey: string | undefined
    for (const [k, v] of memCache) {
      if (v.createdAt < oldest) { oldest = v.createdAt; oldestKey = k }
    }
    if (oldestKey) memCache.delete(oldestKey)
  }
  memCache.set(key, {
    prompt,
    hash,
    size: prompt.length,
    hitCount: 0,
    createdAt: Date.now(),
  })
  writeFileSync(cachePath(key), JSON.stringify({ prompt, hash, createdAt: Date.now() }), 'utf-8')
}



export function cacheStats() {
  return {
    memorySize: memCache.size,
    keys: [...memCache.keys()],
    cacheDir: CACHE_DIR,
  }
}

// ── Fingerprint diff diagnostics (#3) ──

export interface FingerprintComponents {
  tools: string
  skills: string
  soulHash: string
  userHash: string
}

const prevComponents = new Map<string, FingerprintComponents>()

export function extractComponents(
  id: string,
  tools: unknown[],
  skills: string[] | undefined,
  soul: string,
  user: string,
): FingerprintComponents {
  const t = normalizeTools(tools)
  return {
    tools: t.map(x => x.function.name).join(','),
    skills: (skills ?? []).sort().join(','),
    soulHash: shortHash(soul || ''),
    userHash: shortHash(user || ''),
  }
}

export function diagnoseMiss(id: string, cur: FingerprintComponents): string[] {
  const prev = prevComponents.get(id)
  prevComponents.set(id, cur)
  if (!prev) return ['first_seen (cold start)']
  const changes: string[] = []
  if (prev.tools !== cur.tools) changes.push('tools')
  if (prev.skills !== cur.skills) changes.push('skills')
  if (prev.soulHash !== cur.soulHash) changes.push('soul')
  if (prev.userHash !== cur.userHash) changes.push('user')
  return changes
}

// ── Prefix-shape diagnostics (Reasonix cache_shape.go port) ──

export interface PrefixShape {
  systemHash: string
  toolsHash: string
  historyHash: string
}

function flatContent(content: LLMMessage['content']): string {
  if (!content) return ''
  if (typeof content === 'string') return content
  return content.map(p => ('text' in p ? p.text || '' : '[media]')).join('\n')
}

export function capturePrefixShape(
  messages: LLMMessage[],
  tools?: unknown[],
): PrefixShape {
  const sysText = messages
    .filter(m => m.role === 'system')
    .map(m => flatContent(m.content))
    .join('\n')
  const toolsText = JSON.stringify(tools ?? [])
  const historyText = messages
    .filter(m => m.role !== 'system')
    .map(m => `${m.role}:${flatContent(m.content).slice(0, 200)}`)
    .join('|')
  return {
    systemHash: shortHash(sysText),
    toolsHash: shortHash(toolsText),
    historyHash: shortHash(historyText),
  }
}

export function compareShapes(prev: PrefixShape, cur: PrefixShape): string[] {
  const changes: string[] = []
  if (prev.systemHash !== cur.systemHash) changes.push('system prompt changed')
  if (prev.toolsHash !== cur.toolsHash) changes.push('tools schema changed')
  if (prev.historyHash !== cur.historyHash) changes.push('history changed')
  return changes
}

export function pruneOldCache(maxAgeMs: number = 7 * 24 * 60 * 60 * 1000): void {
  try {
    const now = Date.now()
    for (const f of readdirSync(CACHE_DIR)) {
      if (!f.endsWith('.json')) continue
      const fp = resolve(CACHE_DIR, f)
      try {
        const stat = readFileSync(fp, 'utf-8')
        const data = JSON.parse(stat)
        if (now - (data.createdAt ?? 0) > maxAgeMs) {
          rmSync(fp)
        }
      } catch { rmSync(fp) }
    }
  } catch { }
}
