/**
 * cloud/sync/pusher.ts — 实体上传：扫描 → begin-upload → PUT blob → entities push。
 *
 * 全手动：仅由「同步到云端」按钮触发；进度经 CloudStateManager 汇报。
 */

import { readFileSync, mkdirSync, copyFileSync, rmSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { DeviceRegistry } from '../devices'
import type { CloudStateManager } from '../state.ts'
import type { CommitOpResult, FileOp } from '../contracts-sync/sync-contract'
import { scanEntity, type EntityTypeLocal } from './scanner'

const CH = 1 // 每文件进度粒度：上传按文件计数

export interface PushResult {
  ok: boolean
  uploaded: number
  skipped: number
  superseded: { path: string; cloudMtime: number }[]
  error: string | null
}

/** 备份单个本地文件到 dataDir/.sync-backup/<stamp>/<rel>（上传不备份；此函数供拉取用，此处一并导出）。 */
export function backupLocalFile(dataDir: string, localDir: string, posixRel: string, now: number): string {
  const stamp = new Date(now).toISOString().replace(/[:.]/g, '-')
  const target = join(dataDir, '.sync-backup', stamp, posixRel)
  mkdirSync(dirname(target), { recursive: true })
  copyFileSync(join(localDir, posixRel), target)
  return target
}

/** 实体级 push 上传整个实体（覆盖式：以本地为真相）。 */
export async function pushEntity(
  devices: DeviceRegistry,
  state: CloudStateManager,
  dataDir: string,
  type: EntityTypeLocal,
  id: string,
): Promise<PushResult> {
  const label = type === 'config' ? '配置' : id
  state.patch({ phase: 'syncing', op: { label: `扫描 ${label}`, done: 0, total: 0 } })
  let scanned
  try {
    scanned = scanEntity(dataDir, type, id)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, uploaded: 0, skipped: 0, superseded: [], error: `扫描失败：${msg}` }
  }
  const { entries } = scanned
  if (entries.length === 0) {
    state.patch({ phase: 'idle', op: null, lastSyncAt: Date.now() })
    return { ok: true, uploaded: 0, skipped: 0, superseded: [], error: null }
  }

  const result: PushResult = { ok: true, uploaded: 0, skipped: 0, superseded: [], error: null }
  try {
    // 1. begin-upload：问云端缺哪些 blob
    const hashes = [...new Set(entries.map(e => e.hash))]
    const begin = await devices.deviceFetch('/sync/begin-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hashes }),
    })
    if (!begin.ok) throw new Error(`begin-upload ${begin.status}`)
    const { missingHashes } = await begin.json() as { missingHashes: string[] }

    // 2. PUT 缺失 blob
    let done = 0
    for (const entry of entries) {
      state.patch({ op: { label: `上传 ${label} ${entry.path.split('/').pop()}`, done, total: entries.length * CH } })
      if (missingHashes.includes(entry.hash)) {
        const body = readFileSync(join(dataDir, entry.path))
        const put = await devices.deviceFetch(`/sync/blob/${entry.hash}`, { method: 'PUT', body })
        if (!put.ok) {
          const detail = await put.text().catch(() => '')
          throw new Error(`上传 blob 失败（${put.status}）${detail.slice(0, 120)}`)
        }
      }
      done++
    }

    // 3. 实体级 commit（云端校验前缀 + blob 存在 + LWW）
    const ops: FileOp[] = entries.map(e => ({ kind: 'upsert', path: e.path, hash: e.hash, size: e.size, mtime: e.mtime }))
    const commit = await devices.deviceFetch(`/sync/entities/${type}/${encodeURIComponent(id)}/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ops }),
    })
    if (!commit.ok) {
      const detail = await commit.text().catch(() => '')
      throw new Error(`提交失败（${commit.status}）${detail.slice(0, 160)}`)
    }
    const body = await commit.json() as { applied: CommitOpResult[]; conflicts: CommitOpResult[] }
    result.uploaded = body.applied.length
    result.skipped = 0
    for (const c of body.conflicts) {
      if (c.outcome === 'superseded' && c.cloudEntry) {
        result.superseded.push({ path: c.path, cloudMtime: c.cloudEntry.updatedAt })
      }
    }
    state.patch({ phase: 'idle', op: null, lastSyncAt: Date.now(), lastError: null })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    state.patch({ phase: 'error', op: null, lastError: msg })
    result.ok = false
    result.error = msg
  }
  return result
}

/** 删除本地目录（拉取墓碑落地用；限定必须位于 dataDir 内）。 */
export function removeLocalDir(dataDir: string, localDir: string): void {
  const norm = join(localDir)
  if (!norm.startsWith(join(dataDir))) throw new Error('refusing to delete outside dataDir')
  if (existsSync(norm)) rmSync(norm, { recursive: true, force: true })
}
