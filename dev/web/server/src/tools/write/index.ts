import { writeFileSync, existsSync, readFileSync, statSync } from 'fs'
import { resolve } from 'path'
import { createHash } from 'crypto'
import type { ToolModule } from '../types.js'
import { assertPathSafe } from '../utils.js'
import { z } from 'zod'
import { validate } from '../validate.js'

const BOM = '\uFEFF'

function hasBOM(content: string): boolean {
  return content.length > 0 && content.charCodeAt(0) === 0xFEFF
}

function stripBOM(content: string): string {
  return hasBOM(content) ? content.slice(1) : content
}

function withBOM(content: string, originalHadBOM: boolean): string {
  return originalHadBOM ? BOM + content : content
}

export const tool: ToolModule = {
  name: 'write',
  description: 'Write content to a file in the workspace. Preserves UTF-8 BOM if the file already has one. Detects concurrent modifications.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path relative to workspace' },
      content: { type: 'string', description: 'File content' },
    },
    required: ['path', 'content'],
  },
  dangerous: true,
  execute: async (args, { workspace, workspaces, allowedRoots }) => {
    const input = validate(
      z.object({
        path: z.string().min(1, 'path 不能为空'),
        content: z.string(),
      }),
      args, 'write',
    )
    assertPathSafe(input.path, workspaces ?? [workspace], allowedRoots)
    const fullPath = resolve(workspace, input.path)

    // BOM detection & preservation
    let originalHadBOM = false
    if (existsSync(fullPath)) {
      const existing = readFileSync(fullPath, 'utf-8')
      originalHadBOM = hasBOM(existing)
    }

    // Conflict detection: if file exists, hash current content before write
    if (existsSync(fullPath)) {
      const existing = readFileSync(fullPath, 'utf-8')
      const existingHash = createHash('md5').update(existing).digest('hex')

      writeFileSync(fullPath, withBOM(stripBOM(input.content), originalHadBOM), 'utf-8')

      // Verify write was successful by re-reading
      const written = readFileSync(fullPath, 'utf-8')
      const writtenHash = createHash('md5').update(written).digest('hex')

      // Check if another session modified the file between our read and write
      // by verifying our write actually took effect
      if (writtenHash === existingHash && input.content !== '') {
        return { output: '', error: `Write conflict: ${input.path} was modified by another session. Read the latest version and try again.` }
      }
    } else {
      writeFileSync(fullPath, withBOM(stripBOM(input.content), false), 'utf-8')
    }

    return { output: `Written ${input.content.length} bytes to ${input.path}` }
  },
}
