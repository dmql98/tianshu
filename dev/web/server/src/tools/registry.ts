import { readdirSync, existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import type { ToolModule, ToolResult, ToolContext } from './types.js'

const TOOLS_DIR = import.meta.dirname

let initialized = false
const byName = new Map<string, ToolModule>()

const IGNORE_DIRS = new Set(['_template'])

function readToolJson(name: string): Record<string, any> | null {
  const p = resolve(TOOLS_DIR, name, 'tool.json')
  if (!existsSync(p)) return null
  let text = readFileSync(p, 'utf-8')
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1)
  try { return JSON.parse(text) } catch { return null }
}

export async function init(): Promise<void> {
  if (initialized) return
  initialized = true

  const entries = readdirSync(TOOLS_DIR, { withFileTypes: true })
  const dirs = entries
    .filter(e => e.isDirectory() && !IGNORE_DIRS.has(e.name))
    .filter(d => existsSync(resolve(TOOLS_DIR, d.name, 'tool.json')))

  for (const dir of dirs) {
    try {
      const mod = await import(`./${dir.name}/index.js`)
      if (mod.tool?.name) {
        const meta = readToolJson(dir.name)
        if (meta?.constraintFields) {
          mod.tool.constraintFields = meta.constraintFields
        }
        byName.set(mod.tool.name, mod.tool)
      }
    } catch (err: any) {
      console.error(`[registry] Failed to load tool from ${dir.name}: ${err.message}`)
    }
  }

  byName.set('task_complete', {
    name: 'task_complete',
    description: '标记当前任务已完成，结束本轮会话循环。调用时附带最终结果的摘要说明。',
    parameters: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: '任务完成摘要' },
      },
      required: ['summary'],
    },
    execute: async () => ({ output: '', error: 'task_complete is handled at loop level' }),
  })
}

export function getAll(): ToolModule[] {
  if (!initialized) {
    console.warn('[registry] Tools accessed before init — call init() at startup')
    return []
  }
  return Array.from(byName.values())
}

export function getByName(name: string): ToolModule | undefined {
  return byName.get(name)
}

export function getFilteredDefinitions(names: string[]) {
  const result: Array<{
    type: 'function'
    function: { name: string; description: string; parameters: Record<string, any> }
  }> = []
  for (const name of names) {
    const t = byName.get(name)
    if (t) {
      result.push({
        type: 'function' as const,
        function: { name: t.name, description: t.description, parameters: t.parameters },
      })
    }
  }
  return result
}

export async function execute(name: string, args: Record<string, string>, ctx: ToolContext): Promise<ToolResult> {
  const tool = byName.get(name)
  if (!tool) return { output: '', error: `Unknown tool: ${name}` }
  if (tool.signal) return { output: '', error: `Signal tool "${name}" is handled at loop level, not executor` }
  return tool.execute(args, ctx)
}
