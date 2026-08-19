/**
 * 启动时把 builtin/content 全量物化到 dataDir 用户层。
 *
 * 目的：
 * - content/builtin 是只读出厂底稿；角色/技能指南里的路径统一指向
 *   <dataDir>。启动时把 content/builtin 物化到 <dataDir>/characters 与
 *   <dataDir>/skills，保证用户层**始终有**角色/技能定义文件可读写。
 * - 物化副本的元数据文件自带 source: 'builtin' 标签（复制自 builtin 层）。
 *   合并扫描时，**未编辑的物化副本仍由 builtin 层提供**（source 保持
 *   'builtin'，smoke/API 的 builtin 来源检查不受影响）；用户通过系统写路径
 *   编辑后标签置 'user'，副本才作为用户覆盖。
 * - 幂等：已有用户目录则跳过（materializeCharacter / materializeSkillPackage
 *   自带"存在即返回"保护），**绝不覆盖用户修改**。单条失败不影响其余条目。
 */
import { readdirSync, existsSync } from 'fs'
import { resolve } from 'path'
import { builtinCharactersRoot, builtinSkillsRoot } from './paths.js'
import { charactersRoot, skillsRoot } from '../data-paths.js'
import {
  materializeCharacter,
  materializeSkillPackage,
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

/**
 * 启动时全量物化 builtin 角色与技能到 dataDir 用户层。幂等、不覆盖用户修改、
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
  const parts = [`[startup] materialized ${r.materialized.length} builtin item(s) to <dataDir>`]
  if (r.skipped.length > 0) parts.push(`${r.skipped.length} already present (skipped)`)
  if (r.failed.length > 0) {
    parts.push(`${r.failed.length} failed:`)
    for (const f of r.failed) parts.push(`  - ${f.id}: ${f.error}`)
  }
  return parts.join('\n')
}
