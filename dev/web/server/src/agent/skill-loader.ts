import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import type { CharacterRecord, SkillBinding } from '../db/characterStore.js'
import {
  skillsRoot,
  findSkillPackage,
  parseSkillFrontmatter,
  resolveSkillReference,
} from './skill-catalog.js'

export { skillsRoot }

export interface SkillIndex {
  name: string
  packageId: string
  description: string
  listing: string
  attachments: string[]
  childCount: number
}

export function stripFrontmatter(content: string): string {
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)\r?\n([\s\S]*)$/)
  return match ? match[1].trim() : content
}

export function characterSkillBindings(character: Pick<CharacterRecord, 'skills' | 'skillBindings'>): SkillBinding[] {
  return character.skillBindings?.filter(binding => binding.enabled !== false) || []
}

export function findSkillByName(name: string): { dir: string; frontmatter: Record<string, unknown>; body: string } | null {
  const resolved = resolveSkillReference(name)
  if (!resolved) return null
  const dir = resolved.child ? join(resolved.pkg.dir, resolved.child.path) : resolved.pkg.dir
  const raw = readFileSync(join(dir, 'SKILL.md'), 'utf-8')
  return { dir, frontmatter: parseSkillFrontmatter(raw), body: stripFrontmatter(raw) }
}

export function skillDirFor(name: string): string | null {
  return findSkillByName(name)?.dir || null
}

export function buildSkillIndex(character: CharacterRecord): SkillIndex[] {
  const bindings = characterSkillBindings(character)
  const index: SkillIndex[] = []
  const seenPackages = new Set<string>()
  for (const binding of bindings) {
    const pkg = findSkillPackage(binding.packageId)
    if (!pkg) {
      console.warn(`[skill-loader] Package "${binding.packageId}" bound to "${character.name}" (${character.id}) was not found; preserving the binding.`)
      continue
    }
    if (seenPackages.has(pkg.id)) continue
    seenPackages.add(pkg.id)
    const enabledChildren = pkg.children.filter(child => !(binding.disabledSkills || []).includes(child.id))
    const childSummary = enabledChildren.length
      ? ` Children: ${enabledChildren.map(child => `${pkg.id}/${child.id} (${child.description || child.name})`).join('; ')}.`
      : ''
    index.push({
      name: pkg.name,
      packageId: pkg.id,
      description: pkg.description,
      listing: `- ${pkg.id}: ${pkg.description || pkg.name}.${childSummary}`,
      attachments: pkg.files.map(file => file.path),
      childCount: enabledChildren.length,
    })
  }
  return index
}
