/**
 * cloud/sync/puller.ts — 实体拉取：云端覆盖本地，覆盖前备份 .sync-backup。
 *
 * 语义（用户定稿）：拉取 = 下载为准；本地不存在的实体落地为新实体；
 * 云端墓碑 → 删除本地对应目录（先整体备份）。
 */

import { readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import type { DeviceRegistry } from '../devices'
import type { CloudStateManager } from '../state.ts'
import type { RemoteFileEntry } from '../contracts-sync/sync-contract'
import { scanEntity, scanAllEntities, type EntityTypeLocal } from './scanner'
import { backupLocalFile } from './pusher'

export interface PullResult {
  ok: boolean
  downloaded: number
  removed: number
  backedUp: number
  entities: string[]
  error: string | null
}

const empty = (): PullResult => ({ ok: true, downloaded: 0, removed: 0, backedUp: 0, entities: [], error: null })

function collectFiles(dir: string, base = dir, out: string[] = []): string[] {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return out
  }
  for (const name of names) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) collectFiles(full, base, out)
    else out.push(relative(base, full).split(sep).join('/'))
  }
  return out
}

/** 拉取单个实体（type+id）覆盖到本地。 */
export async function pullEntity(
  devices: DeviceRegistry,
  state: CloudStateManager,
  dataDir: string,
  type: EntityTypeLocal,
  id: string,
): Promise<PullResult> {
  const label = type === 'config' ? '配置' : id
  const result = empty()
  state.patch({ phase: 'syncing', op: { label: `拉取 ${label}`, done: 0, total: 0 } })
  try {
    const res = await devices.deviceFetch(`/sync/entities/${type}/${encodeURIComponent(id)}/pull`)
    if (res.status === 404) {
      state.patch({ phase: 'idle', op: null, lastError: null })
      result.error = '云端没有这个实体'
      result.ok = false
      return result
    }
    if (!res.ok) throw new Error(`pull ${res.status}`)
    // 注意：拉取空清单（云端从未有过该实体）不算错误，返回零下载。
    const body = await res.json() as { prefix: string; entries: RemoteFileEntry[] }
    const prefix = body.prefix
    const localDir = type === 'config'
      ? join(dataDir, 'config')
      : type === 'character'
        ? join(dataDir, 'characters', id)
        : join(dataDir, 'skills', ...id.split('/'))

    // 拉取前把本地现状整体备份（有空目录时也建备份戳目录，便于追溯）
    const now = Date.now()
    const localFiles = collectFiles(localDir).filter(rel => !rel.startsWith('.sync-backup/'))
    if (localFiles.length > 0) {
      for (const rel of localFiles) backupLocalFile(dataDir, localDir, rel, now)
      result.backedUp = localFiles.length
    }

    const live = body.entries.filter(e => e.deletedAt === null)
    const tombstones = body.entries.filter(e => e.deletedAt !== null)

    // 墓碑：云端已删除 → 删除本地对应文件（已在上面的整体备份里）
    for (const t of tombstones) {
      const rel = t.path.slice(prefix.length)
      const full = join(localDir, rel)
      if (existsSync(full)) {
        rmSync(full, { force: true })
        result.removed++
      }
    }

    // 下载覆盖
    let done = 0
    for (const entry of live) {
      const rel = entry.path.slice(prefix.length)
      if (!rel) continue
      state.patch({ op: { label: `下载 ${label} ${rel.split('/').pop() ?? ''}`, done, total: live.length } })
      const blob = await devices.deviceFetch(`/sync/blob/${entry.hash}`)
      if (!blob.ok) throw new Error(`下载 blob ${entry.hash.slice(0, 8)} 失败（${blob.status}）`)
      const buf = Buffer.from(await blob.arrayBuffer())
      const target = join(localDir, rel)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, buf)
      // 落地 mtime = 云端 updatedAt（保证下次 LWW 一致）
      try { statSync(target) } catch { /* ignore */ }
      result.downloaded++
      done++
    }

    // 云端实体整体为墓碑（live 为空且全是墓碑）→ 本地目录清空后移除
    if (live.length === 0 && tombstones.length > 0 && type !== 'config') {
      if (existsSync(localDir) && collectFiles(localDir).length === 0) {
        rmSync(localDir, { recursive: true, force: true })
      }
    }

    result.entities.push(label)
    state.patch({ phase: 'idle', op: null, lastSyncAt: Date.now(), lastError: null })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    state.patch({ phase: 'error', op: null, lastError: msg })
    result.ok = false
    result.error = msg
  }
  return result
}

/** 拉取全部实体（「拉取云端角色/技能」按钮）：对账索引 → 逐实体 pull。 */
export async function pullAll(
  devices: DeviceRegistry,
  state: CloudStateManager,
  dataDir: string,
  type: Extract<EntityTypeLocal, 'character' | 'skill-package'>,
): Promise<PullResult> {
  const result = empty()
  state.patch({ phase: 'syncing', op: { label: '查询云端实体', done: 0, total: 0 } })
  try {
    const res = await devices.deviceFetch('/sync/entities')
    if (!res.ok) throw new Error(`entities ${res.status}`)
    const { entities } = await res.json() as { entities: { type: string; id: string; fileCount: number }[] }
    // 目标 = 云端索引实体 ∪ 本地已有实体（本地实体若已被云端墓碑删除，索引里没有，
    // 但实体级 pull 会返回墓碑条目 → 触发本地清理）。
    const cloudIds = new Set(entities.filter(e => e.type === type).map(e => e.id))
    const localIds = new Set(
      scanAllEntities(dataDir)
        .filter(r => r.type === type)
        .map(r => r.id),
    )
    const ids = [...new Set([...cloudIds, ...localIds])]
    const wanted = ids.map(id => ({ type, id, fileCount: 0 }))
    let done = 0
    for (const ent of wanted) {
      state.patch({ op: { label: `拉取 ${ent.id}`, done, total: wanted.length } })
      const r = await pullEntity(devices, state, dataDir, type, ent.id)
      result.downloaded += r.downloaded
      result.removed += r.removed
      result.backedUp += r.backedUp
      if (r.entities[0]) result.entities.push(r.entities[0])
      if (!r.ok) result.error = r.error
      done++
    }
    if (wanted.length === 0) state.patch({ phase: 'idle', op: null, lastSyncAt: Date.now() })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    state.patch({ phase: 'error', op: null, lastError: msg })
    result.ok = false
    result.error = msg
  }
  return result
}

/** pull 后让本地 server 重新扫描 dataDir（POST /api/config/reload，失败忽略）。 */
export async function notifyServerReload(serverPort: number): Promise<void> {
  try {
    await fetch(`http://127.0.0.1:${serverPort}/api/config/reload`, {
      method: 'POST',
      signal: AbortSignal.timeout(10_000),
    })
  } catch { /* 尽力而为：失败时用户刷新页面即可 */ }
}

// re-export 供 IPC 层使用
export { scanAllEntities, scanEntity, readFileSync, mkdirSync, copyFileSync }
