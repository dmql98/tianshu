import { readFileSync, existsSync, readdirSync, writeFileSync } from 'fs'
import { resolve, join } from 'path'
import type { CharacterRecord } from '../db/characterStore.js'

const DATA_DIR = process.env.DATA_DIR || resolve(import.meta.dirname, '../../../../data')
export const SKILLS_ROOT = resolve(DATA_DIR, 'skills')

export interface SkillIndex {
  name: string
  description: string
  listing: string
  attachments: string[]
}

function parseFrontmatter(content: string): Record<string, any> {
  const match = content.match(/^---\n([\s\S]*?)\n(?:---|\.\.\.)\n?/)
  if (!match) return {}
  const fm: Record<string, any> = {}
  const lines = match[1].split('\n')
  let currentKey = ''
  let currentValue = ''
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const keyMatch = trimmed.match(/^(\w[\w_-]*)\s*:\s*(.*)$/)
    if (keyMatch) {
      if (currentKey) fm[currentKey] = currentValue.trim()
      currentKey = keyMatch[1]
      currentValue = keyMatch[2]
    } else if (currentKey && /^\s+/.test(line)) {
      currentValue += ' ' + trimmed
    }
  }
  if (currentKey) fm[currentKey] = currentValue.trim()
  return fm
}

export function stripFrontmatter(content: string): string {
  const match = content.match(/^---\n[\s\S]*?\n(?:---|\.\.\.)\n([\s\S]*)$/)
  return match ? match[1].trim() : content
}

function listFiles(dir: string): string[] {
  try {
    const results: string[] = []
    const walk = (base: string, prefix: string) => {
      const entries = readdirSync(base, { withFileTypes: true })
      for (const e of entries) {
        const full = join(base, e.name)
        const rel = prefix ? `${prefix}/${e.name}` : e.name
        if (e.isDirectory()) {
          walk(full, rel)
        } else {
          results.push(rel)
        }
      }
    }
    walk(dir, '')
    return results.sort()
  } catch { return [] }
}

function findSkillDir(name: string): string | null {
  try {
    const categories = readdirSync(SKILLS_ROOT, { withFileTypes: true })
    for (const cat of categories) {
      if (!cat.isDirectory()) continue
      const catPath = join(SKILLS_ROOT, cat.name)
      const entries = readdirSync(catPath, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        if (entry.name === name) {
          const skillFile = join(catPath, entry.name, 'SKILL.md')
          if (existsSync(skillFile)) return join(catPath, entry.name)
        }
      }
    }
  } catch { /* skills dir not found */ }
  return null
}

export function findSkillByName(name: string): { dir: string; frontmatter: Record<string, any>; body: string } | null {
  const dir = findSkillDir(name)
  if (!dir) return null
  const skillFile = join(dir, 'SKILL.md')
  if (!existsSync(skillFile)) return null
  const content = readFileSync(skillFile, 'utf-8')
  return { dir, frontmatter: parseFrontmatter(content), body: stripFrontmatter(content) }
}

export function skillDirFor(name: string): string | null {
  return findSkillDir(name)
}

function extractYilinArray(content: string, field: string): string[] {
  const m = content.match(new RegExp(`metadata:\n\\s+yilin:\n[\\s\\S]*?\\b${field}:\\s*\\[([^\\]]*)\\]`))
  if (!m) return []
  return m[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
}

export function buildSkillIndex(character: CharacterRecord): SkillIndex[] {
  const names = character.skills
  if (!names || names.length === 0) return []

  const valid = names.filter(name => {
    const dir = findSkillDir(name)
    if (!dir) {
      console.warn(`[skill-loader] Skill "${name}" listed in character "${character.name}" (${character.id}) but not found on disk. Auto-removing.`)
      return false
    }
    return true
  })

  // Sync back if stale skills were removed
  if (valid.length < names.length) {
    try {
      const charFile = resolve(DATA_DIR, 'characters', character.id, 'character.json')
      const raw = readFileSync(charFile, 'utf-8')
      const json = JSON.parse(raw)
      json.skills = valid
      writeFileSync(charFile, JSON.stringify(json, null, 2) + '\n', 'utf-8')
      console.log(`[skill-loader] Cleaned up skills for character "${character.name}" (${character.id}): removed ${names.length - valid.length} stale entries`)
    } catch (e: any) {
      console.error(`[skill-loader] Failed to sync skills for character "${character.name}": ${e.message}`)
    }
  }

  return valid.map(name => {
    const dir = findSkillDir(name)!
    const skillFile = join(dir, 'SKILL.md')
    const content = readFileSync(skillFile, 'utf-8')
    const fm = parseFrontmatter(content)
    const description = fm.description || name
    const attachments = listFiles(dir).filter(f => f !== 'SKILL.md')

    const prereqs = extractYilinArray(content, 'prerequisites')
    const related = extractYilinArray(content, 'related_skills')
    let hint = ''
    if (prereqs.length) hint += ` (requires: ${prereqs.join(', ')})`
    if (related.length) hint += ` (next: ${related.join(', ')})`

    return {
      name,
      description,
      listing: `- ${name}: ${description}${hint}`,
      attachments,
    }
  })
}
