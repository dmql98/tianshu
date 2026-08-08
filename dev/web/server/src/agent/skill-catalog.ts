import { existsSync, readFileSync, readdirSync } from 'fs'
import { extname, join, relative, resolve, sep } from 'path'
import { getDataDir } from '../config.js'

export function skillsRoot(): string {
  return resolve(getDataDir(), 'skills')
}

export type SkillFileType = 'reference' | 'script' | 'template' | 'test' | 'asset' | 'other'

export interface SkillFileEntry {
  name: string
  path: string
  type: SkillFileType
}

export interface SkillPackageChild {
  id: string
  name: string
  description: string
  path: string
  preload: boolean
  tags: string[]
}

export interface SkillPackageManifest {
  schemaVersion: 1
  id: string
  name: string
  version?: string
  category: string
  description: string
  author?: string
  tags: string[]
  root: string
  children: SkillPackageChild[]
}

export interface SkillPackageRecord extends SkillPackageManifest {
  dir: string
  rootBody: string
  files: SkillFileEntry[]
}

const ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/

export function parseSkillFrontmatter(content: string): Record<string, unknown> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)\r?\n?/)
  if (!match) return {}
  const result: Record<string, unknown> = {}
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^([\w-]+)\s*:\s*(.*)$/)
    if (!field) continue
    const value = field[2].trim()
    if (value.startsWith('[') && value.endsWith(']')) {
      result[field[1]] = value.slice(1, -1).split(',').map(item => item.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
    } else {
      result[field[1]] = value.replace(/^['"]|['"]$/g, '')
    }
  }
  return result
}

function stripFrontmatter(content: string): string {
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)\r?\n([\s\S]*)$/)
  return match ? match[1].trim() : content
}

function safeRelativePath(value: string, field: string): string {
  if (!value || value.includes('\0')) throw new Error(`${field} must be a non-empty relative path`)
  const normalized = value.replace(/\\/g, '/')
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized) || normalized.split('/').includes('..')) {
    throw new Error(`${field} must stay inside the skill package`)
  }
  return normalized
}

function ensureInside(root: string, target: string): void {
  const rel = relative(resolve(root), resolve(target))
  if (rel === '..' || rel.startsWith(`..${sep}`) || rel.startsWith('/') || rel.startsWith('\\')) {
    throw new Error('Skill path escapes its package')
  }
}

function fileType(path: string): SkillFileType {
  const top = path.split('/')[0]
  if (top === 'references') return 'reference'
  if (top === 'scripts') return 'script'
  if (top === 'templates') return 'template'
  if (top === 'tests') return 'test'
  if (top === 'assets') return 'asset'
  return 'other'
}

function listFiles(root: string, excludedRoots = new Set<string>()): SkillFileEntry[] {
  const result: SkillFileEntry[] = []
  const walk = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (!prefix && excludedRoots.has(entry.name)) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full, rel)
      else if (rel !== 'SKILL.md' && rel !== 'skill-package.json') result.push({ name: entry.name, path: rel, type: fileType(rel) })
    }
  }
  try { walk(root, '') } catch { /* unavailable package */ }
  return result.sort((a, b) => a.path.localeCompare(b.path))
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(item => typeof item === 'string') as string[] : []
}

function readSkill(path: string): { body: string; meta: Record<string, unknown> } {
  const content = readFileSync(path, 'utf-8')
  return { body: stripFrontmatter(content), meta: parseSkillFrontmatter(content) }
}

function readPackage(category: string, dir: string): SkillPackageRecord {
  const raw = JSON.parse(readFileSync(join(dir, 'skill-package.json'), 'utf-8')) as Record<string, any>
  if (raw.schemaVersion !== 1) throw new Error('schemaVersion must be 1')
  if (!ID_RE.test(raw.id || '')) throw new Error('invalid package id')
  if (raw.category && raw.category !== category) throw new Error(`manifest category must match directory category "${category}"`)
  const root = safeRelativePath(raw.root || 'SKILL.md', 'root')
  const rootPath = resolve(dir, root)
  ensureInside(dir, rootPath)
  if (!existsSync(rootPath)) throw new Error(`root skill not found: ${root}`)
  const rootSkill = readSkill(rootPath)
  const seen = new Set<string>()
  const children: SkillPackageChild[] = (raw.children || []).map((child: any) => {
    if (!ID_RE.test(child.id || '') || seen.has(child.id)) throw new Error(`invalid or duplicate child id: ${child.id}`)
    seen.add(child.id)
    const childDir = safeRelativePath(child.path || `children/${child.id}`, `children.${child.id}.path`)
    const skillPath = resolve(dir, childDir, 'SKILL.md')
    ensureInside(dir, skillPath)
    if (!existsSync(skillPath)) throw new Error(`child skill not found: ${childDir}/SKILL.md`)
    const skill = readSkill(skillPath)
    return {
      id: child.id,
      name: child.name || skill.meta.name || child.id,
      description: child.description || skill.meta.description || '',
      path: childDir,
      preload: child.preload === true,
      tags: strings(child.tags || skill.meta.tags),
    }
  })
  // Aggregates resource files from the package root AND every child skill
  // directory so multi-child packages (e.g. uzi, mysticism) surface all
  // their references/scripts/assets instead of only root-level files.
  const packageFiles: SkillFileEntry[] = listFiles(dir, new Set(['children']))
  for (const child of children) {
    const childDir = resolve(dir, child.path)
    for (const entry of listFiles(childDir)) {
      packageFiles.push({ name: entry.name, path: `${child.path}/${entry.path}`, type: entry.type })
    }
  }
  packageFiles.sort((a, b) => a.path.localeCompare(b.path))
  return {
    schemaVersion: 1,
    id: raw.id,
    name: raw.name || rootSkill.meta.name || raw.id,
    version: raw.version || rootSkill.meta.version as string | undefined,
    category,
    description: raw.description || rootSkill.meta.description || '',
    author: raw.author || rootSkill.meta.author as string | undefined,
    tags: strings(raw.tags || rootSkill.meta.tags),
    root,
    children,
    dir,
    rootBody: rootSkill.body,
    files: packageFiles,
  }
}

export function listSkillPackages(): SkillPackageRecord[] {
  const packages: SkillPackageRecord[] = []
  const root = skillsRoot()
  try {
    for (const category of readdirSync(root, { withFileTypes: true })) {
      if (!category.isDirectory()) continue
      const categoryDir = join(root, category.name)
      for (const entry of readdirSync(categoryDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const dir = join(categoryDir, entry.name)
        if (!existsSync(join(dir, 'skill-package.json'))) {
          console.warn(`[skill-catalog] Ignoring non-package directory ${category.name}/${entry.name}`)
          continue
        }
        try { packages.push(readPackage(category.name, dir)) }
        catch (error: any) { console.warn(`[skill-catalog] Skipping ${category.name}/${entry.name}: ${error.message}`) }
      }
    }
  } catch { /* skills directory not configured yet */ }
  return packages.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
}

export function findSkillPackage(id: string, category?: string): SkillPackageRecord | null {
  return listSkillPackages().find(pkg => pkg.id === id && (!category || pkg.category === category)) || null
}

export function resolveSkillReference(ref: string): { pkg: SkillPackageRecord; child?: SkillPackageChild; body: string; files: SkillFileEntry[] } | null {
  const [packageId, childId] = ref.split('/', 2)
  const pkg = findSkillPackage(packageId)
  if (!pkg) return null
  if (!childId) return { pkg, body: pkg.rootBody, files: pkg.files }
  const child = pkg.children.find(item => item.id === childId)
  if (!child) return null
  const childDir = resolve(pkg.dir, child.path)
  ensureInside(pkg.dir, childDir)
  return { pkg, child, body: readSkill(join(childDir, 'SKILL.md')).body, files: listFiles(childDir) }
}

export function skillFileLanguage(path: string): string {
  const ext = extname(path).toLowerCase()
  return ext === '.md' ? 'markdown' : ext === '.sh' ? 'bash' : ext === '.py' ? 'python' : ext === '.yaml' || ext === '.yml' ? 'yaml' : ext === '.json' ? 'json' : ext === '.ts' ? 'typescript' : ext === '.js' ? 'javascript' : ext === '.css' ? 'css' : ext === '.html' ? 'html' : 'text'
}

export function resolvePackageFile(pkg: SkillPackageRecord, filePath: string, childId?: string): string {
  const child = childId ? pkg.children.find(item => item.id === childId) : undefined
  if (childId && !child) throw new Error(`Child skill "${childId}" not found`)
  const base = child ? resolve(pkg.dir, child.path) : pkg.dir
  const target = resolve(base, safeRelativePath(filePath, 'file path'))
  ensureInside(base, target)
  return target
}
