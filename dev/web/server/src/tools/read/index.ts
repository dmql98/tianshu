import { existsSync, readFileSync, statSync, readdirSync } from 'fs'
import { resolve, basename, extname } from 'path'
import type { ToolModule } from '../types.js'
import { assertPathSafe } from '../utils.js'
import { z } from 'zod'
import { validate } from '../validate.js'

const MAX_FILE_SIZE = 1024 * 1024
const PAGE_SIZE = 2000
const MAX_PAGE_BYTES = 51200

function fuzzySuggest(target: string, fullPath: string): string[] {
  const dir = resolve(fullPath, '..')
  let entries: string[]
  try { entries = readdirSync(dir) } catch { return [] }
  const targetLower = basename(target).toLowerCase()
  const scored = entries
    .map(e => ({ name: e, score: similarity(targetLower, basename(e).toLowerCase()) }))
    .filter(e => e.score > 0.3)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(e => `    ${e.name}`)
  return scored.length ? [`文件未找到: ${target}`, '你是不是想找:', ...scored] : []
}

function similarity(a: string, b: string): number {
  if (a === b) return 1
  if (a.includes(b) || b.includes(a)) return 0.8
  const common = [...a].filter(c => b.includes(c)).length
  return common / Math.max(a.length, b.length)
}

export const tool: ToolModule = {
  name: 'read',
  description: 'Read file contents from the workspace. Supports offset/limit for large files.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path relative to workspace' },
      offset: { type: 'number', description: 'Starting line number (1-based). Defaults to 1.' },
      limit: { type: 'number', description: 'Max lines to return. Defaults to 2000.' },
    },
    required: ['path'],
  },
  execute: async (args, { workspace, workspaces, allowedRoots }) => {
    const input = validate(
      z.object({
        path: z.string().min(1, 'path 不能为空'),
        offset: z.string().optional(),
        limit: z.string().optional(),
      }),
      args, 'read',
    )

    assertPathSafe(input.path, workspaces ?? [workspace], allowedRoots)
    const fullPath = resolve(workspace, input.path)
    if (!existsSync(fullPath)) {
      const suggestions = fuzzySuggest(input.path, fullPath)
      return { output: suggestions.length ? suggestions.join('\n') : `File not found: ${input.path}` }
    }

    const stat = statSync(fullPath)
    if (stat.size > MAX_FILE_SIZE) return { output: '', error: `File too large (>1MB). Use grep or specify offset/limit.` }

    const content = readFileSync(fullPath, 'utf-8')
    const lines = content.split('\n')
    const totalLines = lines.length

    const offset = input.offset ? Math.max(1, parseInt(input.offset)) : 1
    const limit = input.limit ? Math.max(1, parseInt(input.limit)) : PAGE_SIZE

    const end = Math.min(offset + limit - 1, totalLines)
    const sliced = lines.slice(offset - 1, end)

    // Byte-windowed rendering (MAX_PAGE_BYTES, §7.5.2): a single enormous line
    // (minified JS, base64, compressed logs) must not flood the context. Cap the
    // total page at the byte budget and trim any over-long line code-point-safely.
    let out = ''
    let byteTruncated = false
    for (let i = 0; i < sliced.length; i++) {
      const line = `${offset + i}: ${sliced[i]}`
      const sep = out.length > 0 ? '\n' : ''
      if (Buffer.byteLength(out + sep + line, 'utf-8') > MAX_PAGE_BYTES) {
        byteTruncated = true
        const budget = MAX_PAGE_BYTES - Buffer.byteLength(out + sep, 'utf-8')
        if (budget > 0) {
          let acc = 0
          for (const ch of Array.from(line)) {
            const cb = Buffer.byteLength(ch, 'utf-8')
            if (acc + cb > budget) break
            out += ch
            acc += cb
          }
        }
        break
      }
      out += sep + line
    }

    const lineTruncated = end < totalLines
    const shownEnd = offset + sliced.length - 1
    const output = `${fullPath} (${totalLines} lines, showing ${offset}-${shownEnd})` +
      (out ? `\n${out}` : '') +
      (byteTruncated ? `\n\n... (page capped at ~${Math.round(MAX_PAGE_BYTES / 1024)}KB; lines ${offset}-${shownEnd} shown partially. Narrow the range or use grep.)` : '') +
      (lineTruncated ? `\n\n... (${totalLines - end} more lines. Use offset=${end + 1} to continue)` : '')

    return { output }
  },
}
