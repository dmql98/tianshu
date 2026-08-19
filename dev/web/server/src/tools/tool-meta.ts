import { readFileSync, existsSync, readdirSync } from 'fs'
import { resolve } from 'path'

export interface ToolMeta {
  name: string
  description: string
  source?: string
  dangerous?: boolean
  constraintFields: Array<Record<string, any>>
}

/**
 * Read and parse a single tool.json as strict UTF-8. Returns null when the file
 * is missing, not valid UTF-8, or fails to JSON.parse — callers treat that as a
 * broken tool rather than silently disabling constraints.
 *
 * B1 fix: tool.json files were stored as GBK, which made UTF-8 + JSON.parse throw
 * and silently null out every tool's constraintFields. All builtin tool.json are
 * now UTF-8; this reader is deliberately strict so a non-UTF-8 file is surfaced
 * (logged) instead of quietly dropping constraints.
 */
export function readToolMeta(name: string): ToolMeta | null {
  const p = resolve(import.meta.dirname, name, 'tool.json')
  if (!existsSync(p)) return null
  let text: string
  try {
    text = readFileSync(p, 'utf-8')
  } catch {
    return null
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  try {
    const meta = JSON.parse(text)
    return {
      name: meta.name || name,
      description: meta.description || '',
      source: meta.source || 'builtin',
      dangerous: !!meta.dangerous,
      constraintFields: Array.isArray(meta.constraintFields) ? meta.constraintFields : [],
    }
  } catch {
    return null
  }
}

/**
 * Startup / CI validation: ensure every builtin tool directory has a readable,
 * valid UTF-8 tool.json. Logs a warning for broken files (they used to fail
 * silently, disabling constraint enforcement).
 */
export function validateToolMetas(): void {
  try {
    const dirs = readdirSync(import.meta.dirname, { withFileTypes: true })
    for (const e of dirs) {
      if (!e.isDirectory()) continue
      if (!existsSync(resolve(import.meta.dirname, e.name, 'tool.json'))) continue
      const meta = readToolMeta(e.name)
      if (!meta) {
        console.warn(`[tools] tool.json for "${e.name}" is not valid UTF-8 JSON — constraints disabled`)
      }
    }
  } catch {
    /* validation is best-effort at startup */
  }
}
