import { getAll, getFilteredDefinitions } from './registry.js'
import type { ToolBinding } from './types.js'

export { PathEscapeError } from './utils.js'
export type { ToolConstraint, ToolBinding, ToolResult } from './types.js'

export function getDangerousTools(): string[] {
  return getAll().filter(t => t.dangerous).map(t => t.name)
}

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
    return getAll().filter(t => !t.signal).map(t => ({ name: t.name }))
  }
  const result: ToolBinding[] = []
  for (const ct of characterTools) {
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

export function getCharacterToolDefinitions(characterTools?: ToolBinding[]) {
  if (!characterTools || characterTools.length === 0) {
    return getAll()
      .filter(t => !t.signal)
      .map(t => ({ type: 'function' as const, function: { name: t.name, description: t.description, parameters: t.parameters } }))
  }
  const result: Array<{ type: 'function'; function: { name: string; description: string; parameters: Record<string, any> } }> = []
  for (const ct of characterTools) {
    const t = getAll().find(t => t.name === ct.name)
    if (t) {
      if (t.signal) continue
      result.push({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })
    } else {
      if (ct.name.startsWith('mcp:')) continue
      result.push({ type: 'function', function: { name: ct.name, description: `External tool`, parameters: { type: 'object', properties: {} } } })
    }
  }
  return result
}
