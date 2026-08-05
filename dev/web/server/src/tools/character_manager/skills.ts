export function parseSkillNames(value: string | undefined): string[] {
  if (!value) return []
  return [...new Set(value.split(',').map(name => name.trim()).filter(Boolean))]
}

export function updateSkillNames(
  current: string[] | undefined,
  add: string[] = [],
  remove: string[] = [],
): string[] {
  const removed = new Set(remove)
  const result = (current || []).filter(name => !removed.has(name))
  const seen = new Set(result)
  for (const name of add) {
    if (!seen.has(name)) {
      seen.add(name)
      result.push(name)
    }
  }
  return result
}

export function updateNamedBindings<T extends { name: string }>(
  current: T[] | undefined,
  add: string[] = [],
  remove: string[] = [],
): Array<T | { name: string }> {
  const removed = new Set(remove)
  const result: Array<T | { name: string }> = (current || []).filter(binding => !removed.has(binding.name))
  const seen = new Set(result.map(binding => binding.name))
  for (const name of add) {
    if (!seen.has(name)) {
      seen.add(name)
      result.push({ name })
    }
  }
  return result
}
