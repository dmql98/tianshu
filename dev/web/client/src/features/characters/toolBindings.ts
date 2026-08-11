export interface ToolBinding {
  name: string
}

export interface ToolCandidate {
  name: string
  source?: string
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
