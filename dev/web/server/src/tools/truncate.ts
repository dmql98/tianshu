import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { createHash } from 'crypto'
import { resolve } from 'path'
import { getDataDir } from '../config.js'
import { envInt } from '../config.js'

export const getOutputDir = () => resolve(getDataDir(), 'tool-output')
// P2-2: 超长工具输出截断上限（配置化）。
const MAX_OUTPUT_CHARS = envInt('TSS_TOOL_OUTPUT_MAX_CHARS', 64000)

function ensureDir() {
  const dir = getOutputDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

export function truncateToolOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_CHARS) return output

  ensureDir()
  // Content-addressed log name: the same oversized output always truncates to
  // the same bytes (same file path), keeping the message prefix byte-stable
  // across turns and runs so provider prefix caching keeps working.
  const name = `tool_${createHash('sha256').update(output).digest('hex').slice(0, 16)}.log`
  const filePath = resolve(getOutputDir(), name)
  try {
    writeFileSync(filePath, output, 'utf-8')
  } catch {
    // fallback: just show head
    return `${output.slice(0, MAX_OUTPUT_CHARS)}\n\n... (${(output.length / 1024).toFixed(0)}KB total, showing first ${MAX_OUTPUT_CHARS / 1024}KB)`
  }

  const head = output.slice(0, MAX_OUTPUT_CHARS)
  return `${head}\n\n... (${(output.length / 1024).toFixed(0)}KB total, showing first ${MAX_OUTPUT_CHARS / 1024}KB)\n完整输出已保存至 ${filePath}，可用 read/grep 回溯`
}

export function truncateError(error: string): string {
  if (error.length <= MAX_OUTPUT_CHARS) return error
  return `${error.slice(0, MAX_OUTPUT_CHARS)}\n\n... (error truncated, ${error.length} chars total)`
}
