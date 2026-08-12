import { existsSync, readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'
import type { ToolModule } from '../types.js'
import { assertPathSafe, findFirstOccurrence, replaceAllOccurrences } from '../utils.js'
import { z } from 'zod'
import { validate } from '../validate.js'
import { findBestMatch, exactMatch } from './matchers.js'

export const tool: ToolModule = {
  name: 'edit',
  description: 'Apply an exact-string replacement edit to a file in the workspace. Replaces the first occurrence of oldString with newString. Falls back to a strict, indentation-preserving fuzzy match only when the exact string is absent. Set replaceAll to true to replace every occurrence.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path relative to workspace' },
      oldString: { type: 'string', description: 'The exact text to search for (include enough surrounding context for a unique match)' },
      newString: { type: 'string', description: 'The replacement text' },
      replaceAll: { type: 'boolean', description: 'Replace all occurrences instead of just the first (optional)' },
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

    const p = input.path
    assertPathSafe(p, workspaces ?? [workspace], allowedRoots)
    const fullPath = resolve(workspace, p)
    if (!existsSync(fullPath)) return { output: '', error: `File not found: ${p}` }
    const content = readFileSync(fullPath, 'utf-8')
    const oldString = input.oldString
    const newString = input.newString
    const replaceAll = input.replaceAll === 'true'

    if (replaceAll) {
      if (findFirstOccurrence(content, oldString) === -1) return { output: '', error: 'oldString not found in file (replaceAll only supports exact match)' }
      writeFileSync(fullPath, replaceAllOccurrences(content, oldString, newString), 'utf-8')
      return { output: `Replaced all occurrences of oldString in ${p}` }
    }

    // Exact match only by default. Fuzzy fallbacks are strict (single-line
    // whitespace normalization; multi-line context with indentation preserved
    // and uniqueness required) and never match a non-unique region.
    const exact = exactMatch(content, oldString)
    const found = exact ? { result: exact, method: 'exact' as const } : findBestMatch(content, oldString)

    if (!found) {
      return { output: '', error: `oldString not found in file. Edit failed — no exact or strict-fuzzy match exists. Re-read the file and provide the exact text to replace.` }
    }

    // Guard against ambiguous fuzzy matches.
    if (found.method !== 'exact' && found.result.length === 0) {
      return { output: '', error: `oldString matched ambiguously (${found.detail || 'multiple regions'}). Re-read the file and include more surrounding context for a unique exact match.` }
    }

    const isFuzzy = found.method !== 'exact'
    const newContent = content.slice(0, found.result.index) + newString + content.slice(found.result.index + found.result.length)
    writeFileSync(fullPath, newContent, 'utf-8')
    const fuzzyNote = isFuzzy ? ` (matched via ${found.method}${found.detail ? `: ${found.detail}` : ''})` : ''
    return { output: `Applied edit at position ${found.result.index} in ${p}${fuzzyNote} (${oldString.length} chars replaced with ${newString.length} chars)` }
  },
}
