import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'fs'
import { resolve, dirname, basename } from 'path'
import { createHash, randomUUID } from 'crypto'
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
  description: 'Write content to a file in the workspace. Auto-creates parent directories, preserves UTF-8 BOM, and reports structured metadata.',
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
    const targetContent = withBOM(stripBOM(input.content), existsSync(fullPath) && hasBOM(readFileSync(fullPath, 'utf-8')))

    // No-op when the target already contains exactly this content — must not
    // report a conflict for an identical write.
    if (existsSync(fullPath)) {
      const existing = readFileSync(fullPath, 'utf-8')
      if (existing === targetContent) {
        const hash = createHash('md5').update(targetContent).digest('hex')
        return {
          output: `No change to ${input.path}`,
          metadata: { path: input.path, bytes: Buffer.byteLength(targetContent, 'utf-8'), existed: true, status: 'noop', hash },
        }
      }
    }

    // Auto-create parent directories.
    const parent = dirname(fullPath)
    mkdirSync(parent, { recursive: true })

    // Atomic replace: write to a temp file in the same directory, then rename.
    const temp = resolve(parent, `.${basename(fullPath)}.${randomUUID()}.tmp`)
    writeFileSync(temp, targetContent, 'utf-8')
    renameSync(temp, fullPath)

    const written = readFileSync(fullPath, 'utf-8')
    const hash = createHash('md5').update(written).digest('hex')
    return {
      output: `Written ${input.content.length} bytes to ${input.path}`,
      metadata: {
        path: input.path,
        bytes: Buffer.byteLength(written, 'utf-8'),
        existed: existsSync(fullPath),
        status: 'updated',
        hash,
      },
    }
  },
}
