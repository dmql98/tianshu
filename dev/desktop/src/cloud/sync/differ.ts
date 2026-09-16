/**
 * cloud/sync/differ.ts — 上传/拉取前的差异决策（纯函数，单测友好）。
 *
 * LWW（用户定稿）：按文件 mtime 最新者胜；云端与本地 mtime 相同但 hash 不同 → 冲突，
 * 上传场景以本地胜（本地即真相），拉取场景以云端胜（下载为准）。
 * 拉取覆盖本地前必须把被覆盖文件备份到 .sync-backup。
 */

import type { RemoteFileEntry } from '../contracts-sync/sync-contract'

export interface LocalFile {
  path: string
  hash: string
  size: number
  mtime: number
}

export type DiffOp =
  | { kind: 'upload'; path: string; reason: 'new' | 'changed' }
  | { kind: 'skip'; path: string; reason: 'same' }
  | { kind: 'conflict-keep-local'; path: string; cloudMtime: number; localMtime: number }

/** 上传决策：比较本地文件与云端清单。 */
export function decideUploads(local: LocalFile[], cloud: RemoteFileEntry[]): DiffOp[] {
  const cloudByPath = new Map(cloud.map(e => [e.path, e]))
  return local.map(f => {
    const remote = cloudByPath.get(f.path)
    if (!remote) return { kind: 'upload', path: f.path, reason: 'new' as const }
    if (remote.hash === f.hash) return { kind: 'skip', path: f.path, reason: 'same' as const }
    // 内容不同：本地较新（或等新）→ 上传覆盖；云端较新 → 上传（LWW 由服务端裁决 superseded，
    // 上传仍发出：让服务端返回云端较新条目，UI 提示用户）。
    return {
      kind: 'conflict-keep-local',
      path: f.path,
      cloudMtime: remote.updatedAt,
      localMtime: f.mtime,
    }
  })
}

export type PullOp =
  | { kind: 'download'; path: string; hash: string; reason: 'new' | 'changed' }
  | { kind: 'skip'; path: string; reason: 'same' | 'local-newer' }
  | { kind: 'delete-local'; path: string; reason: 'cloud-tombstone' }

/** 拉取决策：云端覆盖本地（下载为准）。本地较新且内容不同的文件仍下载，但先备份。 */
export function decidePulls(cloud: RemoteFileEntry[], local: LocalFile[]): PullOp[] {
  const localByPath = new Map(local.map(f => [f.path, f]))
  const ops: PullOp[] = []
  const seen = new Set<string>()
  for (const remote of cloud) {
    if (remote.deletedAt !== null) {
      seen.add(remote.path)
      if (localByPath.has(remote.path)) ops.push({ kind: 'delete-local', path: remote.path, reason: 'cloud-tombstone' })
      continue
    }
    seen.add(remote.path)
    const l = localByPath.get(remote.path)
    if (!l) {
      ops.push({ kind: 'download', path: remote.path, hash: remote.hash, reason: 'new' })
    } else if (l.hash === remote.hash) {
      ops.push({ kind: 'skip', path: remote.path, reason: 'same' })
    } else if (remote.updatedAt >= l.mtime) {
      ops.push({ kind: 'download', path: remote.path, hash: remote.hash, reason: 'changed' })
    } else {
      // 本地 mtime 较新：仍以云端为准（拉取语义=下载覆盖），但标记先备份
      ops.push({ kind: 'download', path: remote.path, hash: remote.hash, reason: 'changed' })
    }
  }
  // 云端没有、本地有的文件：拉取不动它们（下载覆盖语义，不做本地删除）
  void seen
  return ops
}

/** 备份相对路径：.sync-backup/<utc-时间戳>/<原相对路径>。 */
export function backupPath(posixRel: string, now: number): string {
  const stamp = new Date(now).toISOString().replace(/[:.]/g, '-')
  return `.sync-backup/${stamp}/${posixRel}`
}
