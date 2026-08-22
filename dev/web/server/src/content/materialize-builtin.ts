/**
 * 启动时把 builtin/content 全量物化到 dataDir 用户层。
 *
 * 目的：
 * - content/builtin 是只读出厂底稿；角色/技能/图标包/提示词/服务商预设的
 *   指南与路径统一指向 <dataDir>。启动时把全部五类 content/builtin 物化到
 *   <dataDir> 对应目录，保证用户层**始终有**可读写的内容文件。
 * - 物化副本的元数据文件自带 source: 'builtin' 标签（复制自 builtin 层）。
 *   合并扫描时，**未编辑的物化副本仍由 source 标签标识为 builtin**（single-layer
 *   改造后运行时只扫 dataDir，不再回退 content/builtin）；用户编辑后标签置 'user'。
 * - 幂等：已有用户目录则跳过（materializeXxx 自带"存在即返回"保护），**绝不覆盖
 *   用户修改**。单条失败不影响其余条目。
 * - 完成后通过 content/state.ts 记录 seed 状态（contentVersion + seededAt）。
 */
import { readdirSync, existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import {
  builtinCharactersRoot,
  builtinSkillsRoot,
  builtinIconPacksRoot,
  builtinPromptsRoot,
  builtinContentRoot,
} from './paths.js'
import { charactersRoot, skillsRoot, iconPacksRoot } from '../data-paths.js'
import {
  materializeCharacter,
  materializeSkillPackage,
  materializeIconPack,
  materializePrompt,
  materializeProviderCatalog,
} from './copy-on-write.js'
import { markSeeded } from '../content/state.js'

export interface MaterializeResult {
  materialized: string[]
  skipped: string[]
  failed: Array<{ id: string; error: string }>
}

/** 遍历 content/builtin 下所有内置角色并物化到 <dataDir>/characters/<id>/。 */
function materializeAllCharacters(): { materialized: string[]; skipped: string[]; failed: MaterializeResult['failed'] } {
  const root = builtinCharactersRoot()
  const materialized: string[] = []
  const skipped: string[] = []
  const failed: MaterializeResult['failed'] = []
  if (!existsSync(root)) return { materialized, skipped, failed }
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const id = entry.name
    const userDir = resolve(charactersRoot(), id)
    if (existsSync(userDir)) {
      skipped.push(id)
      continue
    }
    try {
      materializeCharacter(id)
      materialized.push(id)
    } catch (err: any) {
      failed.push({ id, error: err?.message || String(err) })
    }
  }
  return { materialized, skipped, failed }
}

/** 遍历 content/builtin/skills/<category>/<package> 并物化到 <dataDir>/skills/<category>/<id>/。 */
function materializeAllSkills(): { materialized: string[]; skipped: string[]; failed: MaterializeResult['failed'] } {
  const root = builtinSkillsRoot()
  const materialized: string[] = []
  const skipped: string[] = []
  const failed: MaterializeResult['failed'] = []
  if (!existsSync(root)) return { materialized, skipped, failed }
  for (const categoryEntry of readdirSync(root, { withFileTypes: true })) {
    if (!categoryEntry.isDirectory()) continue
    const category = categoryEntry.name
    const categoryDir = resolve(root, category)
    for (const pkgEntry of readdirSync(categoryDir, { withFileTypes: true })) {
      if (!pkgEntry.isDirectory()) continue
      const id = pkgEntry.name
      const label = `${category}/${id}`
      const userDir = resolve(skillsRoot(), category, id)
      if (existsSync(userDir)) {
        skipped.push(label)
        continue
      }
      try {
        materializeSkillPackage(category, id)
        materialized.push(label)
      } catch (err: any) {
        failed.push({ id: label, error: err?.message || String(err) })
      }
    }
  }
  return { materialized, skipped, failed }
}

/** 遍历 content/builtin/iconpacks/<id>/ 并物化到 <dataDir>/iconpacks/<id>/。 */
function materializeAllIconPacks(): { materialized: string[]; skipped: string[]; failed: MaterializeResult['failed'] } {
  const root = builtinIconPacksRoot()
  const materialized: string[] = []
  const skipped: string[] = []
  const failed: MaterializeResult['failed'] = []
  if (!existsSync(root)) return { materialized, skipped, failed }
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const id = entry.name
    const userDir = resolve(iconPacksRoot(), id)
    if (existsSync(userDir)) {
      skipped.push(`iconpack:${id}`)
      continue
    }
    try {
      materializeIconPack(id)
      materialized.push(`iconpack:${id}`)
    } catch (err: any) {
      failed.push({ id: `iconpack:${id}`, error: err?.message || String(err) })
    }
  }
  return { materialized, skipped, failed }
}

/** 物化内置默认提示词到 <dataDir>/prompts/builtin-default.md。 */
function materializeAllPrompts(): { materialized: string[]; skipped: string[]; failed: MaterializeResult['failed'] } {
  try {
    const result = materializePrompt()
    if (!result) return { materialized: [], skipped: [], failed: [] }
    return { materialized: ['prompt:default'], skipped: [], failed: [] }
  } catch (err: any) {
    return { materialized: [], skipped: [], failed: [{ id: 'prompt:default', error: err?.message || String(err) }] }
  }
}

/** 物化整个内置服务商预设目录树到 <dataDir>/providers/。 */
function materializeAllProviders(): { materialized: string[]; skipped: string[]; failed: MaterializeResult['failed'] } {
  const { materialized, skipped } = materializeProviderCatalog()
  return {
    materialized: materialized.map(name => `provider:${name}`),
    skipped: skipped.map(name => `provider:${name}`),
    failed: [],
  }
}

/** 读取 content/builtin/manifest.json 的发行版本号（供 seed 状态记录）。 */
function readBuiltinVersion(): string | undefined {
  try {
    const manifest = JSON.parse(readFileSync(resolve(builtinContentRoot(), 'manifest.json'), 'utf-8')) as { contentVersion?: string }
    return manifest.contentVersion
  } catch {
    return undefined
  }
}

/**
 * 启动时全量物化 builtin 角色/技能/图标包/提示词/服务商预设到 dataDir 用户层。
 * 幂等、不覆盖用户修改、单条失败不中断。返回统计供启动日志使用。
 */
export function materializeAllBuiltinContent(): MaterializeResult {
  const chars = materializeAllCharacters()
  const skills = materializeAllSkills()
  const iconPacks = materializeAllIconPacks()
  const prompts = materializeAllPrompts()
  const providers = materializeAllProviders()
  const result: MaterializeResult = {
    materialized: [...chars.materialized, ...skills.materialized, ...iconPacks.materialized, ...prompts.materialized, ...providers.materialized],
    skipped: [...chars.skipped, ...skills.skipped, ...iconPacks.skipped, ...prompts.skipped, ...providers.skipped],
    failed: [...chars.failed, ...skills.failed, ...iconPacks.failed, ...prompts.failed, ...providers.failed],
  }
  // 记录 seed 状态（contentVersion + seededAt），复用 content/state.ts。
  try {
    const version = readBuiltinVersion()
    if (version) markSeeded(version)
  } catch {
    /* 不阻塞启动 */
  }
  return result
}

/** 启动日志用的摘要字符串。 */
export function materializeSummary(r: MaterializeResult): string {
  const parts = [`[startup] materialized ${r.materialized.length} builtin item(s) to <dataDir>`]
  if (r.skipped.length > 0) parts.push(`${r.skipped.length} already present (skipped)`)
  if (r.failed.length > 0) {
    parts.push(`${r.failed.length} failed:`)
    for (const f of r.failed) parts.push(`  - ${f.id}: ${f.error}`)
  }
  return parts.join('\n')
}
