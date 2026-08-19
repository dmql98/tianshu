/**
 * Copy-on-write：内置角色 / 技能首次持久写入前物化用户副本
 * （BUILTIN_CONTENT_DEVELOPMENT_PLAN §5）。
 *
 * 规则：
 * - 角色只复制定义文件和静态视觉素材（character.json / soul.md / 可选
 *   user.md / prompt.md / 可选 visual/）；绝不复制 memory、revision、归档
 *   或运行状态。
 * - 技能复制完整合法 package（scripts / templates / references / assets
 *   都可能是技能定义的一部分）。
 * - 先复制到用户根下临时目录 → 校验 → 原子 rename 为正式目录。
 * - 来源标签直接写在元数据文件本身（character.json / skill-package.json 的
 *   `source` 字段）：物化副本自带 builtin 标签，用户编辑后写路径置 user。
 * - Provider 和主题不调用本模块。
 */
import { randomUUID } from 'crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs'
import { join, resolve } from 'path'
import { charactersRoot, skillsRoot } from '../data-paths.js'
import { builtinCharactersRoot, builtinSkillsRoot } from './paths.js'

/** 内容来源标签（写入元数据文件的 `source` 字段）。未来可扩展 'market'。 */
export type ContentSourceTag = 'builtin' | 'user'

const CHARACTER_COPY_WHITELIST = new Set([
  'character.json',
  'soul.md',
  'user.md',
  'prompt.md',
  'visual',
])

function copyTree(src: string, dest: string, filter: (name: string) => boolean): void {
  mkdirSync(dest, { recursive: true })
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    if (!filter(entry.name)) continue
    const from = join(src, entry.name)
    const to = join(dest, entry.name)
    if (entry.isDirectory()) {
      copyTree(from, to, () => true)
    } else if (entry.isFile()) {
      cpSync(from, to)
    }
  }
}

/** 读取用户层副本元数据文件里的来源标签。 */
export function readSourceTag(dir: string, kind: 'character' | 'skill'): ContentSourceTag {
  const metaFile = kind === 'character' ? 'character.json' : 'skill-package.json'
  const metaPath = join(dir, metaFile)
  if (!existsSync(metaPath)) return 'user'
  try {
    const meta = JSON.parse(readFileSync(metaPath, 'utf-8'))
    return meta?.source === 'builtin' ? 'builtin' : 'user'
  } catch {
    return 'user'
  }
}

/** 把用户层副本元数据文件里的来源标签置为 'user'（用户编辑后调用）。 */
export function markSourceAsUser(dir: string, kind: 'character' | 'skill'): void {
  const metaFile = kind === 'character' ? 'character.json' : 'skill-package.json'
  const metaPath = join(dir, metaFile)
  if (!existsSync(metaPath)) return
  try {
    const meta = JSON.parse(readFileSync(metaPath, 'utf-8'))
    if (meta?.source === 'user') return
    writeFileSync(metaPath, JSON.stringify({ ...meta, source: 'user' }, null, 2), 'utf-8')
  } catch { /* keep current tag */ }
}

/**
 * 将内置角色完整定义复制到 <dataDir>/characters/<id>/。
 * 若用户目录已存在同 ID 内容则直接返回（不覆盖已有用户内容）。
 */
export function materializeCharacter(id: string, builtinVersion?: string): string {
  const builtinDir = resolve(builtinCharactersRoot(), id)
  if (!existsSync(builtinDir)) {
    throw new Error(`Builtin character "${id}" not found in the read-only content layer`)
  }
  const userDir = resolve(charactersRoot(), id)
  if (existsSync(userDir)) return userDir

  mkdirSync(charactersRoot(), { recursive: true })
  const staging = resolve(charactersRoot(), `.${id}.materialize-${randomUUID()}`)
  try {
    copyTree(builtinDir, staging, name => CHARACTER_COPY_WHITELIST.has(name))
    if (!existsSync(join(staging, 'character.json'))) {
      throw new Error(`Builtin character "${id}" has no character.json`)
    }
    // 纯复制：副本的 character.json 自带 source: 'builtin' 标签（由 builtin 层文件提供）。
    // 原子 rename；Windows 同卷 rename 成功即完成。
    renameSync(staging, userDir)
    return userDir
  } catch (error) {
    if (existsSync(staging)) rmSync(staging, { recursive: true, force: true })
    throw error
  }
}

/**
 * 将内置技能完整 package 复制到 <dataDir>/skills/<category>/<id>/。
 * 若用户层已存在同 ID 内容则直接返回。
 */
export function materializeSkillPackage(category: string, id: string, builtinVersion?: string): string {
  const builtinDir = resolve(builtinSkillsRoot(), category, id)
  if (!existsSync(builtinDir)) {
    throw new Error(`Builtin skill "${category}/${id}" not found in the read-only content layer`)
  }
  const userDir = resolve(skillsRoot(), category, id)
  if (existsSync(userDir)) return userDir

  mkdirSync(resolve(skillsRoot(), category), { recursive: true })
  const staging = resolve(skillsRoot(), category, `.${id}.materialize-${randomUUID()}`)
  try {
    copyTree(builtinDir, staging, () => true)
    if (!existsSync(join(staging, 'skill-package.json'))) {
      throw new Error(`Builtin skill "${category}/${id}" has no skill-package.json`)
    }
    // 纯复制：副本的 skill-package.json 自带 source: 'builtin' 标签（由 builtin 层文件提供）。
    renameSync(staging, userDir)
    return userDir
  } catch (error) {
    if (existsSync(staging)) rmSync(staging, { recursive: true, force: true })
    throw error
  }
}

/** 用户层角色目录是否存在（含损坏目录，损坏仍视为存在以便报错而非静默回退）。 */
export function userCharacterDirExists(id: string): boolean {
  return existsSync(resolve(charactersRoot(), id))
}

/** 恢复内置版本：删除用户个人副本目录（builtin 重新可见，除非仍被隐藏）。 */
export function restoreBuiltinCharacter(id: string): void {
  const dir = resolve(charactersRoot(), id)
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
}

/** 用户层技能目录是否存在。 */
export function userSkillDirExists(category: string, id: string): boolean {
  return existsSync(resolve(skillsRoot(), category, id))
}

/** 目录是否非空（用于判断损坏副本）。 */
export function isEmptyDir(dir: string): boolean {
  try {
    return readdirSync(dir).length === 0
  } catch {
    return true
  }
}

/** 目录树总大小（字节），用于损坏/空目录判断。 */
export function dirSize(dir: string): number {
  let total = 0
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, entry.name)
      if (entry.isDirectory()) walk(p)
      else if (entry.isFile()) total += statSync(p).size
    }
  }
  try {
    walk(dir)
  } catch {
    /* ignore */
  }
  return total
}
