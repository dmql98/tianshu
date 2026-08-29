import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, statSync } from 'fs'
import { resolve, dirname, basename } from 'path'
import { randomUUID } from 'crypto'
import type { ToolModule } from '../types.js'
import { assertPathSafe } from '../utils.js'
import { z } from 'zod'
import { validate } from '../validate.js'
import { replace } from './matchers.js'

const BOM = '\uFEFF'

function hasBOM(content: string): boolean {
  return content.length > 0 && content.charCodeAt(0) === 0xFEFF
}

function stripBOM(content: string): string {
  return hasBOM(content) ? content.slice(1) : content
}

// ---------- Line-ending handling (mirrors opencode edit.ts) ----------
// Matching happens against the file bytes as-is; only the incoming
// oldString/newString are converted to the file's line ending so a model
// typing LF in a CRLF file still matches. Offsets therefore always stay
// correct — the historical CRLF-offset corruption cannot recur.

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, '\n')
}

function detectLineEnding(text: string): '\n' | '\r\n' {
  return text.includes('\r\n') ? '\r\n' : '\n'
}

function convertToLineEnding(text: string, ending: '\n' | '\r\n'): string {
  if (ending === '\n') return text
  return text.replace(/\n/g, '\r\n')
}

// ---------- Per-file lock ----------
// Multiple sessions/agents share one server process. Two concurrent
// read-modify-write cycles on the same file must not interleave, or one edit
// silently overwrites the other. Serialize edits per resolved path.
const locks = new Map<string, Promise<unknown>>()

function withFileLock<T>(filePath: string, fn: () => Promise<T> | T): Promise<T> {
  const prev = locks.get(filePath) ?? Promise.resolve()
  const run = prev.then(async () => fn())
  // Swallow the stored promise's rejection so a failed edit never deadlocks
  // later edits to the same file; callers still see the real rejection.
  locks.set(filePath, run.catch(() => {}))
  return run
}

export const tool: ToolModule = {
  name: 'edit',
  description: '对工作区文件做字符串替换编辑（容忍空白/缩进漂移，保留行尾与 BOM，拒绝歧义匹配）。',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      oldString: { type: 'string', description: '要查找的文本，尽量带足够上下文保证唯一匹配' },
      newString: { type: 'string' },
      replaceAll: { type: 'boolean' },
    },
    required: ['path', 'oldString', 'newString'],
  },
  dangerous: true,
  execute: async (args, { workspace, workspaces, allowedRoots }) => {
    const input = validate(
      z.object({
        path: z.string().min(1, 'path 不能为空'),
        oldString: z.string().min(1, 'oldString 不能为空'),
        newString: z.string(),
        replaceAll: z.enum(['true', 'false']).default('false'),
      }),
      args, 'edit',
    )

    if (input.oldString === input.newString) {
      return { output: '', error: 'No changes to apply: oldString and newString are identical.' }
    }

    const p = input.path
    assertPathSafe(p, workspaces ?? [workspace], allowedRoots)
    const fullPath = resolve(workspace, p)
    const replaceAll = input.replaceAll === 'true'

    return withFileLock(fullPath, () => {
      if (!existsSync(fullPath)) return { output: '', error: `File not found: ${p}` }
      if (statSync(fullPath).isDirectory()) return { output: '', error: `Path is a directory, not a file: ${p}` }

      const raw = readFileSync(fullPath, 'utf-8')
      const desiredBom = hasBOM(raw)
      const content = stripBOM(raw)
      const ending = detectLineEnding(content)

      // Convert the model's strings to the file's line ending so matching
      // works whether the file is LF or CRLF.
      const old = convertToLineEnding(normalizeLineEndings(input.oldString), ending)
      const replacement = convertToLineEnding(normalizeLineEndings(input.newString), ending)

      let result: ReturnType<typeof replace>
      try {
        result = replace(content, old, replacement, replaceAll)
      } catch (err: any) {
        return { output: '', error: err?.message || String(err) }
      }

      if (result.next === content) {
        return { output: '', error: 'No changes to apply: oldString and newString are identical.' }
      }

      const target = (desiredBom ? BOM : '') + result.next

      // Atomic replace: write to a temp file in the same directory, then rename.
      const parent = dirname(fullPath)
      mkdirSync(parent, { recursive: true })
      const temp = resolve(parent, `.${basename(fullPath)}.${randomUUID()}.tmp`)
      writeFileSync(temp, target, 'utf-8')
      renameSync(temp, fullPath)

      const fuzzyNote = result.method === 'exact' ? '' : ` (matched via ${result.method})`
      const allNote = result.count > 1 ? ` (${result.count} occurrences)` : ''
      return {
        output: `Applied edit at position ${result.index} in ${p}${allNote}${fuzzyNote} (${result.length} chars replaced with ${replacement.length} chars)`,
        metadata: {
          path: p,
          bytes: Buffer.byteLength(target, 'utf-8'),
          method: result.method,
          count: result.count,
        },
      }
    })
  },
}
