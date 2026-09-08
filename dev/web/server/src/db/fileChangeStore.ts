/**
 * fileChangeStore.ts — 文件修改追踪事实表（file_changes）的读写。
 *
 * 写入点约定（对齐方案 v2）：
 * - source='tool'：write/edit 工具完成时实时写入（tool_call_id 有值），前端即时展示；
 * - source='snapshot'：run 结束 git 全量 diff 校准后批量写入（tool_call_id NULL），
 *   聚合时按 path 取最新一条（ORDER BY id DESC），snapshot 行自然覆盖 tool 行。
 *
 * 展示键是 session_id；project_key 是第一键（快照基线归属），供项目全局视图。
 */
import { getDb } from './schema.js'
import { withTransaction } from './sqlite-db.js'
import type { SnapshotFileDiff } from '../agent/snapshot/git-snapshot.js'
import type { FileChange, FileChangeStatus } from '../tools/diff-utils.js'

export type FileChangeSource = 'tool' | 'snapshot'

/** file_changes 表的一行（对外结构，tool_name 不落库——表无该列）。 */
export interface FileChangeRow {
  id: number
  project_key: string
  session_id: string
  run_id: string | null
  tool_call_id: string | null
  source: FileChangeSource
  path: string
  status: FileChangeStatus
  additions: number
  deletions: number
  hash: string | null
  created_at: number
}

export interface FileChangeWrite {
  sessionId: string
  runId?: string | null
  toolCallId?: string | null
  projectKey: string
  path: string
  status: FileChangeStatus
  additions?: number
  deletions?: number
  hash?: string | null
}

/** 快照 diff 的 git status → file_changes 的对外 status。 */
export function mapSnapshotStatus(status: SnapshotFileDiff['status']): Exclude<FileChangeStatus, 'noop'> {
  if (status === 'added') return 'created'
  if (status === 'deleted') return 'deleted'
  return 'updated'
}

export const fileChangeStore = {
  /** 写入一条 tool 实时行（source='tool'）。 */
  recordTool(w: FileChangeWrite): void {
    getDb().prepare(`
      INSERT INTO file_changes
        (project_key, session_id, run_id, tool_call_id, source, path, status, additions, deletions, hash, created_at)
      VALUES (?, ?, ?, ?, 'tool', ?, ?, ?, ?, ?, ?)
    `).run(
      w.projectKey,
      w.sessionId,
      w.runId ?? null,
      w.toolCallId ?? null,
      w.path,
      w.status,
      w.additions ?? 0,
      w.deletions ?? 0,
      w.hash ?? null,
      Date.now(),
    )
  },

  /** 批量写入 run 结束的 snapshot 权威行（source='snapshot'）。 */
  recordSnapshotBatch(sessionId: string, runId: string, projectKey: string, diffs: SnapshotFileDiff[]): void {
    if (diffs.length === 0) return
    const db = getDb()
    const now = Date.now()
    withTransaction(db, () => {
      const ins = db.prepare(`
        INSERT INTO file_changes
          (project_key, session_id, run_id, tool_call_id, source, path, status, additions, deletions, hash, created_at)
        VALUES (?, ?, ?, NULL, 'snapshot', ?, ?, ?, ?, NULL, ?)
      `)
      for (const d of diffs) {
        ins.run(
          projectKey,
          sessionId,
          runId,
          d.file,
          mapSnapshotStatus(d.status),
          d.additions,
          d.deletions,
          now,
        )
      }
    })
  },

  /** 原始行（含 tool 与 snapshot），按时间升序。 */
  listBySession(sessionId: string, limit = 1000): FileChangeRow[] {
    return getDb().prepare(`
      SELECT id, project_key, session_id, run_id, tool_call_id, source, path, status,
             additions, deletions, hash, created_at
      FROM file_changes
      WHERE session_id = ?
      ORDER BY id ASC
      LIMIT ?
    `).all(sessionId, limit) as unknown as FileChangeRow[]
  },

  /**
   * 聚合（会话视图）：按 path 取最新一条 + 剔除 noop + 更新时间。
   * noop 行（write 无变化）对侧边栏无意义，聚合时排除。
   */
  aggregateBySession(sessionId: string): FileChange[] {
    const rows = getDb().prepare(`
      SELECT path,
             (SELECT status    FROM file_changes f2
              WHERE f2.session_id = ? AND f2.path = f.path
              ORDER BY id DESC LIMIT 1) AS status,
             (SELECT additions FROM file_changes f2
              WHERE f2.session_id = ? AND f2.path = f.path
              ORDER BY id DESC LIMIT 1) AS additions,
             (SELECT deletions FROM file_changes f2
              WHERE f2.session_id = ? AND f2.path = f.path
              ORDER BY id DESC LIMIT 1) AS deletions,
             (SELECT source    FROM file_changes f2
              WHERE f2.session_id = ? AND f2.path = f.path
              ORDER BY id DESC LIMIT 1) AS source,
             MAX(created_at) AS updated_at
      FROM file_changes f
      WHERE f.session_id = ? AND f.status != 'noop'
      GROUP BY f.path
      ORDER BY updated_at DESC
    `).all(sessionId, sessionId, sessionId, sessionId, sessionId) as Array<{
      path: string
      status: FileChangeStatus
      additions: number
      deletions: number
      source: FileChangeSource
      updated_at: number
    }>
    return rows.map(r => ({
      path: r.path,
      status: r.status,
      additions: r.additions,
      deletions: r.deletions,
      source: r.source,
      updatedAt: r.updated_at,
    }))
  },

  /** 聚合（项目全局视图）：同一 project_key 跨会话合并，按 path 取最新一条。 */
  aggregateByProject(projectKey: string): FileChange[] {
    const rows = getDb().prepare(`
      SELECT path,
             (SELECT status    FROM file_changes f2
              WHERE f2.project_key = ? AND f2.path = f.path
              ORDER BY id DESC LIMIT 1) AS status,
             (SELECT additions FROM file_changes f2
              WHERE f2.project_key = ? AND f2.path = f.path
              ORDER BY id DESC LIMIT 1) AS additions,
             (SELECT deletions FROM file_changes f2
              WHERE f2.project_key = ? AND f2.path = f.path
              ORDER BY id DESC LIMIT 1) AS deletions,
             (SELECT source    FROM file_changes f2
              WHERE f2.project_key = ? AND f2.path = f.path
              ORDER BY id DESC LIMIT 1) AS source,
             MAX(created_at) AS updated_at
      FROM file_changes f
      WHERE f.project_key = ? AND f.status != 'noop'
      GROUP BY f.path
      ORDER BY updated_at DESC
    `).all(projectKey, projectKey, projectKey, projectKey, projectKey) as Array<{
      path: string
      status: FileChangeStatus
      additions: number
      deletions: number
      source: FileChangeSource
      updated_at: number
    }>
    return rows.map(r => ({
      path: r.path,
      status: r.status,
      additions: r.additions,
      deletions: r.deletions,
      source: r.source,
      updatedAt: r.updated_at,
    }))
  },

  /** 删除会话的 file_changes 行（sessionStore.delete 事务内追加调用；快照仓库不删）。 */
  deleteBySession(sessionId: string): void {
    getDb().prepare('DELETE FROM file_changes WHERE session_id = ?').run(sessionId)
  },
}