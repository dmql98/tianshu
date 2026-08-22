import { readdirSync, existsSync } from 'fs'
import { resolve } from 'path'
import type { ToolModule, ToolResult, ToolContext, ToolArgs } from './types.js'
import { readToolMeta, validateToolMetas } from './tool-meta.js'

const TOOLS_DIR = import.meta.dirname

let initialized = false
const byName = new Map<string, ToolModule>()

const IGNORE_DIRS = new Set(['_template'])

export async function init(): Promise<void> {
  if (initialized) return
  initialized = true

  // Surface any broken (non-UTF-8 / invalid) tool.json instead of silently
  // disabling constraint enforcement (B1).
  validateToolMetas()

  const entries = readdirSync(TOOLS_DIR, { withFileTypes: true })
  const dirs = entries
    .filter(e => e.isDirectory() && !IGNORE_DIRS.has(e.name))
    .filter(d => existsSync(resolve(TOOLS_DIR, d.name, 'tool.json')))

  for (const dir of dirs) {
    try {
      const mod = await import(`./${dir.name}/index.js`)
      if (mod.tool?.name) {
        const meta = readToolMeta(dir.name)
        if (meta?.constraintFields?.length) {
          mod.tool.constraintFields = meta.constraintFields
        }
        if (meta && typeof meta.dangerous === 'boolean') {
          mod.tool.dangerous = meta.dangerous
        }
        byName.set(mod.tool.name, mod.tool)
      }
    } catch (err: any) {
      console.error(`[registry] Failed to load tool from ${dir.name}: ${err.message}`)
    }
  }
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

export async function execute(name: string, args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
  const tool = byName.get(name)
  if (!tool) return { output: '', error: `Unknown tool: ${name}` }
  if (tool.signal) return { output: '', error: `Signal tool "${name}" is handled at loop level, not executor` }
  return tool.execute(args, ctx)
}
