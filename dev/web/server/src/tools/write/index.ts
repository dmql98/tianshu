import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, statSync, openSync, closeSync, readSync } from 'fs'
import { resolve, dirname, basename } from 'path'
import { createHash, randomUUID } from 'crypto'
import type { ToolModule } from '../types.js'
import { assertPathSafe } from '../utils.js'
import { z } from 'zod'
import { validate } from '../validate.js'

const BOM = '\uFEFF'
// Synchronous writes above this size would block the event loop for seconds;
// reject and ask the model to write in smaller chunks. (Original had no cap.)
const MAX_WRITE_BYTES = 10 * 1024 * 1024

// Detect a UTF-8 BOM by reading only the first 3 bytes — never the whole file
// (the original did a full read just for BOM detection on every write).
function readPrefixBOM(fullPath: string): boolean {
  let fd: number | undefined
  try {
    fd = openSync(fullPath, 'r')
    const buf = Buffer.alloc(3)
    const n = readSync(fd, buf, 0, 3, 0)
    return n >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf
  } catch {
    return false
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

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
    const existed = existsSync(fullPath)
    const targetContent = withBOM(stripBOM(input.content), existed && readPrefixBOM(fullPath))

    const targetBytes = Buffer.byteLength(targetContent, 'utf-8')
    if (targetBytes > MAX_WRITE_BYTES) {
      return { output: '', error: `Content too large (${targetBytes} bytes > ${MAX_WRITE_BYTES}) for a synchronous write. Write it in smaller chunks instead.` }
    }

    // No-op when the target already contains exactly this content — must not
    // report a conflict for an identical write. Short-circuit on size first so
    // we only do a full read when the byte length already matches.
    if (existed) {
      try {
        if (statSync(fullPath).size === targetBytes) {
          const existing = readFileSync(fullPath, 'utf-8')
          if (existing === targetContent) {
            const hash = createHash('md5').update(targetContent).digest('hex')
            return {
              output: `No change to ${input.path}`,
              metadata: { path: input.path, bytes: targetBytes, existed: true, status: 'noop', hash },
            }
          }
        }
      } catch { /* stat/read errors fall through to a normal write */ }
    }

    // Auto-create parent directories.
    const parent = dirname(fullPath)
    mkdirSync(parent, { recursive: true })

    // Atomic replace: write to a temp file in the same directory, then rename.
    const temp = resolve(parent, `.${basename(fullPath)}.${randomUUID()}.tmp`)
    writeFileSync(temp, targetContent, 'utf-8')
    renameSync(temp, fullPath)

    // Hash from the in-memory content we wrote — no post-write read-back needed.
    const hash = createHash('md5').update(targetContent).digest('hex')
    return {
      output: `Written ${input.content.length} bytes to ${input.path}`,
      metadata: {
        path: input.path,
        bytes: targetBytes,
        existed,
        status: existed ? 'updated' : 'created',
        hash,
      },
    }
  },
}
