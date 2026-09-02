export interface ToolBinding {
  name: string
}

export interface ToolCandidate {
  name: string
  source?: string
}

/** 自动门控工具：注入由运行时状态自动决定（记忆工具→memoryMode，skill_manager→技能列表），不纳入「工具管理」开关。 */
export const AUTO_MANAGED_TOOLS = new Set([
  'memory_read',
  'memory_write',
  'memory_update',
  'memory_archive',
  'memory_snapshot',
  'skill_manager',
])

export function isAutoManagedTool(name: string): boolean {
  return AUTO_MANAGED_TOOLS.has(name)
}

export function toToolBindingName(name: string, source?: string): string {
  return source === 'mcp' && !name.startsWith('mcp:') ? `mcp:${name}` : name
}

export function dedupeToolBindings(bindings: ToolBinding[]): ToolBinding[] {
  const seen = new Set<string>()
  return bindings.filter(binding => {
    if (seen.has(binding.name)) return false
    seen.add(binding.name)
    return true
  })
}

export function getUnboundTools<T extends ToolCandidate>(
  candidates: T[],
  bindings: ToolBinding[],
): T[] {
  const boundNames = new Set(bindings.map(binding => binding.name))
  const seenCandidates = new Set<string>()
  return candidates.filter(candidate => {
    const bindingName = toToolBindingName(candidate.name, candidate.source)
    if (boundNames.has(bindingName) || seenCandidates.has(bindingName)) return false
    seenCandidates.add(bindingName)
    return true
  })
}
