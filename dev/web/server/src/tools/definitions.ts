import { getAll, getFilteredDefinitions } from './registry.js'
import type { ToolBinding } from './types.js'
import type { MemoryMode } from '../db/characterStore.js'

export { PathEscapeError } from './utils.js'
export type { ToolConstraint, ToolBinding, ToolResult } from './types.js'
export type { MemoryMode } from '../db/characterStore.js'

/** 记忆系统工具（v2，与文件系统 read/write 完全解耦）。 */
const MEMORY_TOOLS = {
  read: ['memory_read'],
  editable: ['memory_read', 'memory_write', 'memory_update', 'memory_archive', 'memory_snapshot'],
} as const

/** 按 memoryMode 返回应注入的记忆工具名（off → []，read_only → 仅 memory_read，editable/undefined → 全部）。 */
export function memoryToolNamesForMode(mode?: MemoryMode): string[] {
  if (mode === 'read_only') return [...MEMORY_TOOLS.read]
  if (mode === 'off') return []
  return [...MEMORY_TOOLS.editable]
}

/** 记忆写工具集合（read_only 之外的工具名，供执行层门控参考）。 */
export const MEMORY_WRITE_TOOLS = new Set(['memory_write', 'memory_update', 'memory_archive', 'memory_snapshot'])

export function isMemoryTool(name: string): boolean {
  return name === 'memory_read' || MEMORY_WRITE_TOOLS.has(name)
}

/**
 * 自动门控工具：不纳入「工具管理」开关，由运行时状态自动决定注入——
 * 记忆工具由 memoryMode、skill_manager 由技能列表门控。工具管理元数据
 * （/api/tools）不返回它们，避免在界面出现可勾选项。
 */
export function isAutoManagedTool(name: string): boolean {
  return isMemoryTool(name) || name === 'skill_manager'
}

/** v1 时代的旧记忆工具名：v2 已拆分为 memory_read/write/update/archive/snapshot，绑定里残留的旧名直接忽略。 */
export const LEGACY_MEMORY_TOOL = 'character_memory'

function isLegacyOrMemoryTool(name: string): boolean {
  return name === LEGACY_MEMORY_TOOL || isMemoryTool(name)
}

export function getDangerousTools(): string[] {
  return getAll().filter(t => t.dangerous).map(t => t.name)
}

/**
 * 默认工具白名单：当角色没有显式配置 tools 时，只暴露这些工具。
 * provider/character/mcp 管理已改为「技能 + dataDir 文件 / webfetch+REST」，
 * 不再作为默认工具下发（三个 manager 工具已下线）。
 */
export const DEFAULT_TOOL_NAMES = new Set([
  'read', 'edit', 'write', 'grep', 'glob', 'bash', 'pwsh', 'webfetch', 'websearch', 'get_time',
  'skill_manager', 'debug_sessions',
])

function matchPath(pattern: string, target: string): boolean {
  if (pattern.endsWith('/**')) return target.startsWith(pattern.slice(0, -3)) || target === pattern.slice(0, -3)
  if (pattern.endsWith('*')) return target.startsWith(pattern.slice(0, -1))
  return target === pattern || target.startsWith(pattern + '/')
}

function parseFileSize(s: string): number {
  const m = s.match(/^(\d+)\s*(B|KB|MB|GB)?$/i)
  if (!m) return 0
  const num = parseInt(m[1])
  const unit = (m[2] || 'B').toUpperCase()
  const multipliers: Record<string, number> = { B: 1, KB: 1024, MB: 1024 * 1024, GB: 1024 * 1024 * 1024 }
  return num * (multipliers[unit] || 1)
}

function validateByRule(rule: string, constraintValue: any, argValue: any, constraintKey: string): string | null {
  switch (rule) {
    case 'glob-allow': {
      const patterns = Array.isArray(constraintValue) ? constraintValue : [constraintValue]
      if (patterns.length > 0 && argValue && !patterns.some(p => matchPath(p, argValue))) {
        return `Path "${argValue}" is not in allowed paths: ${patterns.join(', ')}`
      }
      break
    }
    case 'glob-deny': {
      const patterns = Array.isArray(constraintValue) ? constraintValue : [constraintValue]
      if (argValue && patterns.some(p => matchPath(p, argValue))) {
        return `Path "${argValue}" is denied`
      }
      break
    }
    case 'bytes-max': {
      if (!argValue) break
      const bytes = new TextEncoder().encode(argValue).length
      const max = parseFileSize(constraintValue)
      if (max > 0 && bytes > max) return `File content exceeds max size ${constraintValue} (${bytes} bytes)`
      break
    }
    case 'exact-allow': {
      if (!argValue) break
      const cmd = argValue.trim().split(/\s+/)[0]
      const allowed = Array.isArray(constraintValue) ? constraintValue : [constraintValue]
      if (allowed.length > 0 && !allowed.includes(cmd)) {
        return `Command "${cmd}" is not in allowed commands: ${allowed.join(', ')}`
      }
      break
    }
    case 'substring-deny': {
      if (!argValue) break
      const patterns = Array.isArray(constraintValue) ? constraintValue : [constraintValue]
      for (const p of patterns) {
        if (argValue.includes(p)) return `Command contains denied pattern: "${p}"`
      }
      break
    }
    case 'readonly-query': {
      if (!argValue) break
      const trimmed = argValue.trim().toUpperCase()
      if (trimmed.startsWith('INSERT') || trimmed.startsWith('UPDATE') || trimmed.startsWith('DELETE') || trimmed.startsWith('DROP')) {
        return 'Write queries are not allowed in read-only mode'
      }
      break
    }
    case 'max-number': {
      if (argValue == null) break
      if (argValue > constraintValue) return `Value ${argValue} exceeds max ${constraintValue}`
      break
    }
  }
  return null
}

export function validateConstraints(toolName: string, args: Record<string, any>, binding: ToolBinding): string | null {
  const c = binding.constraints
  if (!c) return null

  const tool = getAll().find(t => t.name === toolName)
  if (tool?.constraintFields) {
    for (const field of tool.constraintFields) {
      const constraintValue = (c as any)[field.key]
      if (constraintValue === undefined || constraintValue === null) continue
      if (field.validateRule === 'flag') continue
      if (field.validateArg) {
        const argValue = args[field.validateArg]
        if (argValue === undefined || argValue === null) continue
        const error = validateByRule(field.validateRule!, constraintValue, argValue, field.key)
        if (error) return error
      }
    }
    return null
  }

  if (toolName.startsWith('mcp__') || toolName === 'mcp__db_query') {
    if (c.readonly && args.query) {
      const trimmed = args.query.trim().toUpperCase()
      if (trimmed.startsWith('INSERT') || trimmed.startsWith('UPDATE') || trimmed.startsWith('DELETE') || trimmed.startsWith('DROP')) {
        return 'Write queries are not allowed in read-only mode'
      }
    }
    if (c.max_rows && args.limit && args.limit > c.max_rows) {
      return `Query limit ${args.limit} exceeds max rows ${c.max_rows}`
    }
  }

  return null
}

export function resolveCharacterTools(characterTools?: ToolBinding[]): ToolBinding[] {
  if (!characterTools || characterTools.length === 0) {
    // 默认只暴露白名单工具；管理类不再默认下发。
    return Array.from(DEFAULT_TOOL_NAMES)
      .map(name => getAll().find(t => t.name === name))
      .filter((t): t is NonNullable<typeof t> => !!t && !t.signal)
      .map(t => ({ name: t.name }))
  }
  const result: ToolBinding[] = []
  for (const ct of characterTools) {
    if (isLegacyOrMemoryTool(ct.name)) continue
    const registered = getAll().find(t => t.name === ct.name)
    if (registered) {
      if (registered.signal) continue
      result.push(ct)
    } else {
      result.push(ct)
    }
  }
  return result
}

export function getCharacterToolDefinitions(characterTools?: ToolBinding[], memoryMode?: MemoryMode, skills?: string[]) {
  const memoryTools = memoryToolNamesForMode(memoryMode)
  const hasSkills = (skills || []).length > 0
  const names = new Set<string>()

  if (!characterTools || characterTools.length === 0) {
    // 默认只暴露白名单工具。
    for (const name of DEFAULT_TOOL_NAMES) names.add(name)
  } else {
    for (const ct of characterTools) {
      // 记忆工具由 memoryMode 统一门控注入，不从角色工具绑定列表单独纳入。
      if (isLegacyOrMemoryTool(ct.name)) continue
      names.add(ct.name)
    }
  }
  // memoryMode 门控：注入对应记忆工具（off → []，read_only → memory_read，editable/undefined → 全部）。
  for (const name of memoryTools) names.add(name)

  const result: Array<{ type: 'function'; function: { name: string; description: string; parameters: Record<string, any> } }> = []
  for (const name of names) {
    // skill_manager 由角色技能列表自动门控（技能为空 → 不注入，无技能包可管理），不纳入「工具管理」开关。
    if (name === 'skill_manager' && !hasSkills) continue
    const t = getAll().find(t => t.name === name)
    if (t) {
      if (t.signal) continue
      result.push({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })
    } else {
      if (name.startsWith('mcp:')) continue
      result.push({ type: 'function', function: { name, description: `External tool`, parameters: { type: 'object', properties: {} } } })
    }
  }
  return result
}
