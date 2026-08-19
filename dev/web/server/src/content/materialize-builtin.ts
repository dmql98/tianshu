/**
 * 启动时把 builtin/content 全量物化到 dataDir（用户层）。
 *
 * 目的（BUILTIN_CONTENT_DEVELOPMENT_PLAN §5 的"预物化"策略）：
 * - content/builtin 是只读出厂底稿；角色/技能指南里的路径统一指向
 *   <dataDir>（用户层副本）。启动时物化一遍，保证用户层副本**始终存在**，
 *   模型激活管理技能后拿到的 dataDir 路径总能读写到角色/技能定义文件。
 * - 物化是幂等的：已有用户副本时直接跳过（materializeCharacter /
 *   materializeSkillPackage 自带"存在即返回"保护），**绝不覆盖用户修改**。
 * - 单个条目失败不影响其余条目（启动不被一个坏包打断）。
 */
import { readdirSync, existsSync } from 'fs'
import { resolve } from 'path'
import { builtinCharactersRoot, builtinSkillsRoot } from './paths.js'
import {
  materializeCharacter,
  materializeSkillPackage,
  userCharacterDirExists,
  userSkillDirExists,
} from './copy-on-write.js'

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
    // materializeCharacter 在用户目录已存在时也返回非空 userDir，无法区分
    // "新物化"与"已存在"；这里先判存在，统计才准确（已存在 → skipped）。
    if (userCharacterDirExists(id)) {
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
      if (userSkillDirExists(category, id)) {
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

/**
 * 启动时全量物化 builtin 角色与技能到 dataDir。幂等、不覆盖用户副本、
 * 单条失败不中断。返回统计供启动日志使用。
 */
export function materializeAllBuiltinContent(): MaterializeResult {
  const chars = materializeAllCharacters()
  const skills = materializeAllSkills()
  const result: MaterializeResult = {
    materialized: [...chars.materialized, ...skills.materialized],
    skipped: [...chars.skipped, ...skills.skipped],
    failed: [...chars.failed, ...skills.failed],
  }
  return result
}

/** 启动日志用的摘要字符串。 */
export function materializeSummary(r: MaterializeResult): string {
  const parts = [`[startup] materialized ${r.materialized.length} builtin item(s) to dataDir`]
  if (r.skipped.length > 0) parts.push(`${r.skipped.length} already present (skipped)`)
  if (r.failed.length > 0) {
    parts.push(`${r.failed.length} failed:`)
    for (const f of r.failed) parts.push(`  - ${f.id}: ${f.error}`)
  }
  return parts.join('\n')
}
