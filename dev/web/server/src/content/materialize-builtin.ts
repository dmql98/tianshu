/**
 * 启动时把 builtin/content 全量镜像到 <dataDir>/builtin。
 *
 * 目的：
 * - content/builtin 是只读出厂底稿；技能/角色指南里的路径统一指向
 *   <dataDir>。启动时把 content/builtin 完整复制到 <dataDir>/builtin，
 *   保证 dataDir 内**始终有**角色/技能定义文件可读写。
 * - 镜像目录 <dataDir>/builtin 是**只读镜像**：它不参与双层合并
 *   （mergeById 只扫描 dataDir/characters 与 dataDir/skills），因此不会
 *   把内置角色/技能标记成 source:'user'（否则 smoke/API 的 builtin 来源
 *   检查会失败）。用户真正的修改仍写用户层 characters/ 或 skills/ 目录。
 * - 幂等：目标目录已存在则跳过，不重复复制。单条失败不影响其余条目。
 */
import { readdirSync, existsSync, cpSync, mkdirSync } from 'fs'
import { resolve } from 'path'
import { builtinCharactersRoot, builtinSkillsRoot } from './paths.js'
import { builtinMirrorCharactersRoot, builtinMirrorSkillsRoot } from '../data-paths.js'

export interface MaterializeResult {
  materialized: string[]
  skipped: string[]
  failed: Array<{ id: string; error: string }>
}

/** 递归复制 builtin 目录到镜像目标（不写 .tianshu-source.json，纯镜像）。 */
function mirrorDir(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true })
  cpSync(src, dest, { recursive: true, force: false })
}

/** 镜像 content/builtin 下所有内置角色到 <dataDir>/builtin/characters/<id>/。 */
function mirrorAllCharacters(): { materialized: string[]; skipped: string[]; failed: MaterializeResult['failed'] } {
  const root = builtinCharactersRoot()
  const destRoot = builtinMirrorCharactersRoot()
  const materialized: string[] = []
  const skipped: string[] = []
  const failed: MaterializeResult['failed'] = []
  if (!existsSync(root)) return { materialized, skipped, failed }
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const id = entry.name
    const dest = resolve(destRoot, id)
    if (existsSync(dest)) {
      skipped.push(id)
      continue
    }
    try {
      mirrorDir(resolve(root, id), dest)
      materialized.push(id)
    } catch (err: any) {
      failed.push({ id, error: err?.message || String(err) })
    }
  }
  return { materialized, skipped, failed }
}

/** 镜像 content/builtin/skills/<category>/<package> 到 <dataDir>/builtin/skills/<category>/<id>/。 */
function mirrorAllSkills(): { materialized: string[]; skipped: string[]; failed: MaterializeResult['failed'] } {
  const root = builtinSkillsRoot()
  const destRoot = builtinMirrorSkillsRoot()
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
      const dest = resolve(destRoot, category, id)
      if (existsSync(dest)) {
        skipped.push(label)
        continue
      }
      try {
        mirrorDir(resolve(categoryDir, id), dest)
        materialized.push(label)
      } catch (err: any) {
        failed.push({ id: label, error: err?.message || String(err) })
      }
    }
  }
  return { materialized, skipped, failed }
}

/**
 * 启动时全量镜像 builtin 角色与技能到 <dataDir>/builtin。幂等、不覆盖、
 * 单条失败不中断。返回统计供启动日志使用。
 */
export function materializeAllBuiltinContent(): MaterializeResult {
  const chars = mirrorAllCharacters()
  const skills = mirrorAllSkills()
  const result: MaterializeResult = {
    materialized: [...chars.materialized, ...skills.materialized],
    skipped: [...chars.skipped, ...skills.skipped],
    failed: [...chars.failed, ...skills.failed],
  }
  return result
}

/** 启动日志用的摘要字符串。 */
export function materializeSummary(r: MaterializeResult): string {
  const parts = [`[startup] mirrored ${r.materialized.length} builtin item(s) to <dataDir>/builtin`]
  if (r.skipped.length > 0) parts.push(`${r.skipped.length} already present (skipped)`)
  if (r.failed.length > 0) {
    parts.push(`${r.failed.length} failed:`)
    for (const f of r.failed) parts.push(`  - ${f.id}: ${f.error}`)
  }
  return parts.join('\n')
}
