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
 * - 用户副本内生成 .tianshu-source.json；builtin 包中不得预置。
 * - Provider 和主题不调用本模块。
 */
import { randomUUID } from 'crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs'
import { join, resolve } from 'path'
import { charactersRoot, skillsRoot } from '../data-paths.js'
import { builtinCharactersRoot, builtinSkillsRoot } from './paths.js'

export interface TianshuSourceFile {
  schemaVersion: 1
  kind: 'builtin-fork'
  builtinId: string
  builtinVersion?: string
  forkedAt: number
}

const CHARACTER_COPY_WHITELIST = new Set([
  'character.json',
  'soul.md',
  'user.md',
  'prompt.md',
  'visual',
])

function writeSourceFile(dir: string, builtinId: string, builtinVersion?: string): void {
  const source: TianshuSourceFile = {
    schemaVersion: 1,
    kind: 'builtin-fork',
    builtinId,
    ...(builtinVersion ? { builtinVersion } : {}),
    forkedAt: Date.now(),
  }
  writeFileSync(join(dir, '.tianshu-source.json'), JSON.stringify(source, null, 2), 'utf-8')
}

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
    writeSourceFile(staging, id, builtinVersion)
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
    writeSourceFile(staging, `${category}/${id}`, builtinVersion)
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
