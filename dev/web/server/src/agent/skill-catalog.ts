import { existsSync, readFileSync, readdirSync, rmSync } from 'fs'
import { extname, join, relative, resolve, sep } from 'path'
import { skillsRoot as userSkillsRoot } from '../data-paths.js'
import { builtinContentRoot, builtinSkillsRoot, type ContentSource } from '../content/paths.js'
import { mergeById, type ContentOriginFields } from '../content/catalog.js'
import { readContentState } from '../content/state.js'
import { materializeSkillPackage, readSourceTag, markSourceAsUser } from '../content/copy-on-write.js'

/** 用户层技能根（保持既有导出名；路径由 data-paths.ts 统一管理）。 */
export function skillsRoot(): string {
  return userSkillsRoot()
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
  /** 来源标签：builtin（内置出厂/未编辑物化副本）/ user（用户创建或编辑过）。 */
  source?: ContentSource
  version?: string
  category: string
  description: string
  author?: string
  tags: string[]
  root: string
  children: SkillPackageChild[]
}

// SkillPackageRecord 的 source 来自 ContentOriginFields（合并时派生），
// 不继承 Manifest 的 source，避免同名属性类型冲突。
export interface SkillPackageRecord extends Omit<SkillPackageManifest, 'source'>, ContentOriginFields {
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
  // directory so multi-child packages surface all their resources.
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
    source: 'user',
    readOnly: false,
    overridesBuiltin: false,
  }
}

/**
 * 扫描单个技能根（<root>/<category>/<package-id>/），返回原始记录。
 * 调用方负责把 source 归属到对应层（builtin/user）。
 */
export function scanSkillPackages(root: string, source: 'builtin' | 'user'): SkillPackageRecord[] {
  const packages: SkillPackageRecord[] = []
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
        try {
          const pkg = readPackage(category.name, dir)
          pkg.source = source
          pkg.readOnly = source === 'builtin'
          pkg.overridesBuiltin = false
          packages.push(pkg)
        } catch (error: any) {
          console.warn(`[skill-catalog] Skipping ${category.name}/${entry.name}: ${error.message}`)
        }
      }
    }
  } catch { /* skills directory not configured yet */ }
  return packages.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
}

/** 读取 content/builtin 内容发行版本（manifest.contentVersion）。 */
export function builtinContentVersion(): string | undefined {
  try {
    const manifest = JSON.parse(readFileSync(join(builtinContentRoot(), 'manifest.json'), 'utf-8')) as { contentVersion?: string }
    return manifest.contentVersion
  } catch {
    return undefined
  }
}

/** 单层内跨 category 重复 package ID 检测：命中即告警（第一版拒绝隐式歧义）。 */
function checkDuplicateIds(packages: SkillPackageRecord[]): void {
  const seen = new Map<string, string>()
  for (const pkg of packages) {
    const prev = seen.get(pkg.id)
    if (prev && prev !== pkg.category) {
      console.warn(`[skill-catalog] Duplicate package id "${pkg.id}" across categories "${prev}" and "${pkg.category}"`)
    }
    seen.set(pkg.id, pkg.category)
  }
}

/**
 * 双层技能目录（builtin + userdata）合并列表。
 * 同 ID（category + packageId）用户项完整覆盖内置项，不做逐字段隐式合并。
 */
export function listSkillPackages(): SkillPackageRecord[] {
  const builtin = scanSkillPackages(builtinSkillsRoot(), 'builtin')
  // 用户层排除"未编辑的物化副本"（source 标签为 builtin，仍由 builtin 层提供）。
  const user = scanSkillPackages(skillsRoot(), 'user')
    .filter(pkg => readSourceTag(pkg.dir, 'skill') !== 'builtin')
  checkDuplicateIds(builtin)
  checkDuplicateIds(user)

  const hiddenIds = new Set(readContentState().hidden.skills)
  return mergeById<SkillPackageRecord>({
    builtin,
    user,
    hiddenIds,
    builtinVersion: builtinContentVersion(),
  })
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

/** 编辑内置技能前的 copy-on-write 入口：确保用户层存在可写副本并返回其记录。 */
export function ensureSkillPackageWritable(category: string, id: string): SkillPackageRecord {
  const existing = findSkillPackage(id, category)
  if (!existing) throw new Error(`Skill package "${category}/${id}" not found`)
  if (existing.source === 'user') return existing
  materializeSkillPackage(category, id, builtinContentVersion())
  // 用户点击"编辑内置技能"（materialize）= 接管该副本：source 标签置 user，
  // 合并时覆盖 builtin。注意不能用 findSkillPackage（它会把未编辑物化副本
  // 过滤掉、仍显示 builtin）；直接扫用户层目录拿刚物化的可写副本。
  const userCopy = scanSkillPackages(skillsRoot(), 'user')
    .find(pkg => pkg.id === id && pkg.category === category)
  if (!userCopy) {
    throw new Error(`Failed to materialize user copy of skill "${category}/${id}"`)
  }
  markSourceAsUser(userCopy.dir, 'skill')
  return { ...userCopy, overridesBuiltin: true }
}

/** 恢复内置版本：删除用户副本目录（builtin 重新可见，除非仍被隐藏）。 */
export function restoreBuiltinSkill(category: string, id: string): void {
  const dir = resolve(skillsRoot(), category, id)
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
}
