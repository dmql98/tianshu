import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { resolve } from 'path'

export const TRUNCATION_DIR = resolve(process.cwd(), 'data', 'tool-output')
export const getOutputDir = () => TRUNCATION_DIR
const MAX_OUTPUT_CHARS = 64000

function ensureDir() {
  if (!existsSync(TRUNCATION_DIR)) mkdirSync(TRUNCATION_DIR, { recursive: true })
}

export function truncateToolOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_CHARS) return output

  ensureDir()
  const name = `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.log`
  const filePath = resolve(TRUNCATION_DIR, name)
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
