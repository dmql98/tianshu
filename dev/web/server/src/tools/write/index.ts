import { readFileSync, existsSync, statSync, openSync, closeSync, readSync } from 'fs'
import { open as fspOpen, rename as fspRename, mkdir as fspMkdir, rm as fspRm } from 'fs/promises'
import { resolve, dirname, basename } from 'path'
import { createHash, randomUUID } from 'crypto'
import type { ToolModule } from '../types.js'
import { assertPathSafe } from '../utils.js'
import { z } from 'zod'
import { validate } from '../validate.js'

const BOM = '\uFEFF'
// 单次 write 的内容字节上限（安全阀）。write 已是分块异步流式写，不再像旧的同步
// 整块写一样阻塞事件循环，故从 10MB 提升到 200MB；超限仍拒绝并提示分块。
const MAX_WRITE_BYTES = 200 * 1024 * 1024
// 分块写：每块字节数。64KB 对多数文件足够小，避免单次同步写阻塞；同时控制进度事件量。
const CHUNK_BYTES = 64 * 1024
// 每产生多少字节进度输出一次 onOutput（1MB 一条进度，兼顾可见性与事件量；
// 内层 inner.ts 另有 50ms 合并窗兜底防刷屏）。
const PROGRESS_EVERY_BYTES = 256 * 1024

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

/**
 * 把整段内容分块异步写入临时文件，边写边让出事件循环并回调进度，支持中途中止：
 * - 按字节切分（UTF-8 安全，无多字节截断），每块 await，避免大文件同步写阻塞主线程；
 * - 每累计 PROGRESS_EVERY_BYTES 输出一次 onOutput 进度，供前端 running 卡片实时展示；
 * - abort 时清理临时文件并抛错，让上层中止该工具调用。
 * 返回 { temp, bytes }：调用方随后 rename 到目标路径完成原子替换。
 * @throws 写失败或已中止时抛出，调用方负责清理。
 */
async function streamWriteTemp(
  fullPath: string,
  content: string,
  onOutput?: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<{ temp: string; bytes: number }> {
  const parent = dirname(fullPath)
  await fspMkdir(parent, { recursive: true })
  const temp = resolve(parent, `.${basename(fullPath)}.${randomUUID()}.tmp`)
  const buf = Buffer.from(content, 'utf-8')
  const total = buf.byteLength
  let handle: Awaited<ReturnType<typeof fspOpen>> | undefined
  try {
    handle = await fspOpen(temp, 'w')
    let position = 0
    let lastProgress = 0
    while (position < total) {
      if (signal?.aborted) {
        await handle.close().catch(() => {})
        handle = undefined
        await fspRm(temp, { force: true }).catch(() => {})
        const err = new Error(`Write aborted (${position}/${total} bytes written)`)
        ;(err as any).aborted = true
        throw err
      }
      const end = Math.min(position + CHUNK_BYTES, total)
      const piece = buf.subarray(position, end)
      await handle.write(piece, 0, piece.byteLength, position)
      position = end
      // 进度：每累计 PROGRESS_EVERY_BYTES 输出一次；最后一块也补一条完成前进度。
      if (onOutput && (position - lastProgress >= PROGRESS_EVERY_BYTES || position === total)) {
        lastProgress = position
        onOutput(`written ${position}/${total} bytes to ${fullPath}`)
      }
      // 让出事件循环，避免长时间占用主线程（大文件写期间其他请求/SSE 仍可服务）。
      await new Promise<void>(r => setImmediate(r))
    }
    // 写完后必须关闭句柄（Windows 上打开中的文件无法 rename，否则 EPERM）。
    await handle.close().catch(() => {})
    handle = undefined
    return { temp, bytes: total }
  } catch (err: any) {
    if (handle) await handle.close().catch(() => {})
    await fspRm(temp, { force: true }).catch(() => {})
    throw err
  }
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
  execute: async (args, { workspace, workspaces, allowedRoots, onOutput, signal }) => {
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
      return { output: '', error: `Content too large (${targetBytes} bytes > ${MAX_WRITE_BYTES}) for a single write. Write it in smaller chunks instead.` }
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

    // 分块异步流式写临时文件（带进度 + 可中止），随后 rename 到目标路径完成原子替换。
    const { temp } = await streamWriteTemp(fullPath, targetContent, onOutput, signal)
    try {
      await fspRename(temp, fullPath)
    } catch (err: any) {
      await fspRm(temp, { force: true }).catch(() => {})
      throw err
    }

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
