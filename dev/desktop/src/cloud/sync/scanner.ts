/**
 * cloud/sync/scanner.ts — 扫描 dataDir 实体子目录 → FileEntry 清单（sha256 + mtime + size）。
 *
 * 复用 cloud-server contracts 的 validatePath 语义；实体前缀映射一致。
 */

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import type { FileEntry } from '../contracts-sync/sync-contract'

export type EntityTypeLocal = 'character' | 'skill-package' | 'config'

export interface EntityRef {
  type: EntityTypeLocal
  /** character: id；skill-package: "<category>/<pkgId>"；config: '-' */
  id: string
  /** dataDir 下的绝对根目录。 */
  localDir: string
  /** 云端路径前缀（POSIX，以 / 结尾）。 */
  cloudPrefix: string
}

/** 实体 → 本地目录/云端前缀。dataDir 为本地 server 的数据根。 */
export function entityRef(dataDir: string, type: EntityTypeLocal, id: string): EntityRef {
  if (type === 'character') {
    return { type, id, localDir: join(dataDir, 'characters', id), cloudPrefix: `characters/${id}/` }
  }
  if (type === 'skill-package') {
    const [category, pkgId] = id.split('/')
    if (!category || !pkgId) throw new Error(`skill-package id must be "<category>/<pkgId>": ${id}`)
    return { type, id, localDir: join(dataDir, 'skills', category, pkgId), cloudPrefix: `skills/${category}/${pkgId}/` }
  }
  return { type, id: '-', localDir: join(dataDir, 'config'), cloudPrefix: 'config/' }
}

/** 强制排除（与服务端 ALWAYS_EXCLUDED 对齐，防止把运行数据/备份传上去）。 */
const EXCLUDED = [
  /(^|\/)\.sync-backup(\/|$)/,
  /(^|\/)\.git(\/|$)/,
  /(^|\/)node_modules(\/|$)/,
  /^config\/model-usage\.json$/,
  /\.(tmp|log)$/i,
  /~$/,
  /\.bak-\d+$/,
]

function isExcluded(posixPath: string): boolean {
  return EXCLUDED.some(rule => rule.test(posixPath))
}

function sha256File(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

/** 递归收集目录下所有文件（相对 POSIX 路径）。 */
function walk(dir: string, base: string, out: string[]): void {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return // 目录不存在 = 空实体
  }
  for (const name of entries) {
    const full = join(dir, name)
    const rel = relative(base, full).split(sep).join('/')
    if (isExcluded(rel)) continue
    const st = statSync(full)
    if (st.isDirectory()) {
      walk(full, base, out)
    } else if (st.isFile()) {
      out.push(rel)
    }
  }
}

/** 扫描实体本地目录 → FileEntry[]（path = 云端相对路径，POSIX）。 */
export function scanEntity(dataDir: string, type: EntityTypeLocal, id: string): { ref: EntityRef; entries: FileEntry[] } {
  const ref = entityRef(dataDir, type, id)
  const rels: string[] = []
  walk(ref.localDir, ref.localDir, rels)
  const entries = rels.map(rel => {
    const full = join(ref.localDir, rel)
    const st = statSync(full)
    return {
      path: `${ref.cloudPrefix}${rel}`,
      hash: sha256File(full),
      size: st.size,
      mtime: Math.floor(st.mtimeMs),
    } satisfies FileEntry
  })
  return { ref, entries }
}

/** 扫描全部实体（拉取索引对账用）：characters/* + skills/<cat>/<pkg> + config。 */
export function scanAllEntities(dataDir: string): EntityRef[] {
  const refs: EntityRef[] = []
  try {
    for (const id of readdirSync(join(dataDir, 'characters'))) {
      if (statSync(join(dataDir, 'characters', id)).isDirectory()) {
        refs.push(entityRef(dataDir, 'character', id))
      }
    }
  } catch { /* 无 characters 目录 */ }
  try {
    const skillsRoot = join(dataDir, 'skills')
    for (const category of readdirSync(skillsRoot)) {
      const catDir = join(skillsRoot, category)
      if (!statSync(catDir).isDirectory()) continue
      for (const pkgId of readdirSync(catDir)) {
        if (statSync(join(catDir, pkgId)).isDirectory()) {
          refs.push(entityRef(dataDir, 'skill-package', `${category}/${pkgId}`))
        }
      }
    }
  } catch { /* 无 skills 目录 */ }
  refs.push(entityRef(dataDir, 'config', '-'))
  return refs
}
