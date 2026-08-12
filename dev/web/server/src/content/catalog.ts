/**
 * 双层内容合并（BUILTIN_CONTENT_DEVELOPMENT_PLAN §4）。
 *
 * 角色和技能分别扫描：
 *   1. content/builtin/<type>
 *   2. <dataDir>/<type>
 * 按稳定 ID 合并；同 ID 用户项完整覆盖内置项，不做逐字段隐式合并。
 * 隐藏项不进入普通列表（调用方传 all=true 时可见）。
 */
import type { ContentSource } from './paths.js'

export interface ContentOriginFields {
  source: ContentSource
  readOnly: boolean
  overridesBuiltin?: boolean
  builtinVersion?: string
  /** 用户副本损坏时置 true，调用方必须报错而非静默回退内置项。 */
  corruptUserCopy?: boolean
}

export type MergedItem<T extends { id: string }> = T & ContentOriginFields

export interface MergeOptions<T extends { id: string }> {
  builtin: T[]
  user: T[]
  hiddenIds: Set<string>
  /** 用户层同 ID 目录损坏时抛出而非静默回退（默认 false：直接让 user 项获胜）。 */
  failOnCorruptUser?: boolean
  isUserCorrupt?: (item: T) => boolean
  /** 内置发行版本（manifest.contentVersion），用于 builtinVersion 派生字段。 */
  builtinVersion?: string
}

/**
 * 合并两个层级的同 ID 内容。返回带来源字段的稳定排序列表。
 * 用户项完整覆盖内置项；只有内置项标 readOnly；被隐藏的 ID 被剔除。
 */
export function mergeById<T extends { id: string }>(options: MergeOptions<T>): MergedItem<T>[] {
  const { builtin, user, hiddenIds, failOnCorruptUser, isUserCorrupt, builtinVersion } = options
  const userById = new Map(user.map(item => [item.id, item]))
  const result: MergedItem<T>[] = []

  for (const item of builtin) {
    if (hiddenIds.has(item.id)) continue
    const userItem = userById.get(item.id)
    if (!userItem) {
      result.push({
        ...item,
        source: 'builtin',
        readOnly: true,
        overridesBuiltin: false,
        ...(builtinVersion ? { builtinVersion } : {}),
      })
    }
  }

  for (const item of user) {
    if (hiddenIds.has(item.id)) continue
    if (failOnCorruptUser && isUserCorrupt?.(item)) {
      throw new Error(`User copy of "${item.id}" is corrupted; refusing to fall back to the builtin item`)
    }
    const builtinItem = builtin.find(b => b.id === item.id)
    result.push({
      ...item,
      source: 'user',
      readOnly: false,
      overridesBuiltin: !!builtinItem,
      ...(builtinItem && builtinVersion ? { builtinVersion } : {}),
    })
  }

  return result.sort((a, b) => a.id.localeCompare(b.id))
}
