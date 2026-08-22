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
 * - Provider 预设目录在单层化下也经本模块的 copyTree 物化到 <dataDir>/providers。
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
import { dirname, join, resolve } from 'path'
import { charactersRoot, skillsRoot, iconPacksRoot, providersRoot } from '../data-paths.js'
import { getDataDir } from '../config.js'
import {
  builtinCharactersRoot,
  builtinSkillsRoot,
  builtinIconPacksRoot,
  builtinPromptsRoot,
  builtinProvidersRoot,
} from './paths.js'

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
    // 单层化：该项原本是出厂内置项（source==='builtin'），进入用户层后标记
    // overridesBuiltin，使合并层即使在 dataDir 中已无同名 builtin 项也能识别"已自定义"。
    const overridesBuiltin = meta?.source === 'builtin'
    writeFileSync(metaPath, JSON.stringify({ ...meta, source: 'user', ...(overridesBuiltin ? { overridesBuiltin: true } : {}) }, null, 2), 'utf-8')
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

/**
 * 恢复内置版本（单层化语义）：先删用户层副本，再从出厂源重新物化一份干净的
 * 内置副本到 dataDir（而非依赖运行时回退层，回退分支已移除）。若出厂源缺失则
 * 保留已删状态（该项不可用）。只影响内置项，不触碰用户自建内容。
 */
export function restoreBuiltinCharacter(id: string): void {
  const dir = resolve(charactersRoot(), id)
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
  try {
    materializeCharacter(id)
  } catch {
    /* 出厂源缺失：保留已删状态 */
  }
}

/** 恢复内置图标包（单层化语义）：删用户层副本，从出厂源重新物化干净副本到 dataDir。 */
export function restoreBuiltinIconPack(id: string): void {
  const dir = resolve(iconPacksRoot(), id)
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
  try {
    materializeIconPack(id)
  } catch {
    /* 出厂源缺失：保留已删状态 */
  }
}

/** 恢复内置默认提示词（单层化语义）：删用户层副本，从出厂源重新物化干净副本到 dataDir。 */
export function restoreBuiltinPrompt(): void {
  const file = resolve(getDataDir(), 'prompts', 'builtin-default.md')
  if (existsSync(file)) rmSync(file, { force: true })
  try {
    materializePrompt()
  } catch {
    /* 出厂源缺失：保留已删状态 */
  }
}

/** 恢复内置服务商预设（单层化语义）：删用户层目录，从出厂源重新物化干净目录到 dataDir。 */
export function restoreBuiltinProvider(name: string): void {
  const dir = resolve(providersRoot(), name)
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
  const builtinDir = resolve(builtinProvidersRoot(), name)
  if (!existsSync(builtinDir)) return // 出厂源缺失：保留已删状态
  const staging = resolve(providersRoot(), `.${name}.materialize-${randomUUID()}`)
  try {
    copyTree(builtinDir, staging, () => true)
    renameSync(staging, dir)
  } catch {
    if (existsSync(staging)) rmSync(staging, { recursive: true, force: true })
  }
}

/**
 * 将内置图标包完整复制到 <dataDir>/iconpacks/<id>/（pack.json + assets/*）。
 * 若用户层已存在同 ID 则直接返回（不覆盖已有内容）。
 */
export function materializeIconPack(id: string): string {
  const builtinDir = resolve(builtinIconPacksRoot(), id)
  if (!existsSync(builtinDir)) {
    throw new Error(`Builtin icon pack "${id}" not found in the read-only content layer`)
  }
  const userDir = resolve(iconPacksRoot(), id)
  if (existsSync(userDir)) return userDir
  mkdirSync(iconPacksRoot(), { recursive: true })
  const staging = resolve(iconPacksRoot(), `.${id}.materialize-${randomUUID()}`)
  try {
    copyTree(builtinDir, staging, () => true)
    if (!existsSync(join(staging, 'pack.json'))) {
      throw new Error(`Builtin icon pack "${id}" has no pack.json`)
    }
    renameSync(staging, userDir)
    return userDir
  } catch (error) {
    if (existsSync(staging)) rmSync(staging, { recursive: true, force: true })
    throw error
  }
}

/**
 * 将内置默认提示词复制到 <dataDir>/prompts/builtin-default.md。
 * 若用户层副本已存在则直接返回（不覆盖用户修改）。
 */
export function materializePrompt(): string {
  const builtinFile = resolve(builtinPromptsRoot(), 'default.md')
  if (!existsSync(builtinFile)) return ''
  const userFile = resolve(getDataDir(), 'prompts', 'builtin-default.md')
  if (existsSync(userFile)) return userFile
  mkdirSync(dirname(userFile), { recursive: true })
  cpSync(builtinFile, userFile)
  return userFile
}

/**
 * 将整个内置服务商预设目录树复制到 <dataDir>/providers/（保留多子目录结构）。
 * 单项存在即跳过（不覆盖用户修改）；单条失败不影响其余项。
 * 返回 { materialized, skipped }（均为目录名列表）。
 */
export function materializeProviderCatalog(): { materialized: string[]; skipped: string[] } {
  const builtinRoot = builtinProvidersRoot()
  const materialized: string[] = []
  const skipped: string[] = []
  if (!existsSync(builtinRoot)) return { materialized, skipped }
  mkdirSync(providersRoot(), { recursive: true })
  for (const entry of readdirSync(builtinRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const name = entry.name
    const userDir = resolve(providersRoot(), name)
    if (existsSync(userDir)) {
      skipped.push(name)
      continue
    }
    const staging = resolve(providersRoot(), `.${name}.materialize-${randomUUID()}`)
    try {
      copyTree(resolve(builtinRoot, name), staging, () => true)
      renameSync(staging, userDir)
      materialized.push(name)
    } catch {
      if (existsSync(staging)) rmSync(staging, { recursive: true, force: true })
    }
  }
  return { materialized, skipped }
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
