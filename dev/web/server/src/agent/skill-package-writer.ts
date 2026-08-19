import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'fs'
import { resolve } from 'path'
import { skillsRoot, parseSkillFrontmatter, type SkillPackageManifest } from './skill-catalog.js'

const ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/

export interface CreateSkillPackageInput {
  id: string
  category: string
  content: string
  name?: string
  description?: string
  version?: string
  author?: string
  tags?: string[]
}

export interface CreatedSkillPackage {
  dir: string
  manifest: SkillPackageManifest
}

function validateId(value: string, field: string): string {
  const trimmed = value.trim()
  if (!ID_RE.test(trimmed)) throw new Error(`${field} must contain only letters, numbers, dots, underscores or hyphens`)
  return trimmed
}

/**
 * Create a standard single-skill package through a sibling staging directory,
 * then atomically rename it into place.
 */
export function createSkillPackage(input: CreateSkillPackageInput, skillsRootOverride = skillsRoot()): CreatedSkillPackage {
  const id = validateId(input.id, 'id')
  const category = validateId(input.category, 'category')
  if (!input.content.trim()) throw new Error('content is required')

  const frontmatter = parseSkillFrontmatter(input.content)
  const name = (input.name || String(frontmatter.name || '')).trim()
  if (!name) throw new Error('A package name or SKILL.md frontmatter name is required')

  const categoryDir = resolve(skillsRootOverride, category)
  const targetDir = resolve(categoryDir, id)
  if (existsSync(targetDir)) throw new Error(`Skill package "${id}" already exists`)

  const manifest: SkillPackageManifest = {
    schemaVersion: 1,
    id,
    name,
    // 用户新建的技能 → source 标签置 user（默认覆盖任何同名内置项）。
    source: 'user',
    version: input.version || (frontmatter.version ? String(frontmatter.version) : undefined),
    category,
    description: input.description ?? String(frontmatter.description || ''),
    author: input.author || (frontmatter.author ? String(frontmatter.author) : undefined),
    tags: input.tags || (Array.isArray(frontmatter.tags) ? frontmatter.tags as string[] : []),
    root: 'SKILL.md',
    children: [],
  }

  mkdirSync(categoryDir, { recursive: true })
  const stagingDir = resolve(categoryDir, `.${id}.staging-${randomUUID()}`)
  try {
    mkdirSync(stagingDir)
    writeFileSync(resolve(stagingDir, 'SKILL.md'), input.content.endsWith('\n') ? input.content : `${input.content}\n`, 'utf-8')
    const diskManifest = {
      schemaVersion: manifest.schemaVersion,
      id: manifest.id,
      name: manifest.name,
      source: manifest.source,
      ...(manifest.version ? { version: manifest.version } : {}),
      category: manifest.category,
      description: manifest.description,
      ...(manifest.author ? { author: manifest.author } : {}),
      tags: manifest.tags,
      root: manifest.root,
      children: [],
    }
    writeFileSync(resolve(stagingDir, 'skill-package.json'), `${JSON.stringify(diskManifest, null, 2)}\n`, 'utf-8')
    renameSync(stagingDir, targetDir)
    return { dir: targetDir, manifest }
  } catch (error) {
    if (existsSync(stagingDir)) rmSync(stagingDir, { recursive: true, force: true })
    throw error
  }
}
