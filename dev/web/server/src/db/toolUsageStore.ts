/**
 * toolUsageStore.ts — 工具/技能调用事实表（方案 B）的写入与读取。
 *
 * 背景：messages.tool 行是工具执行的权威记录，但按行聚合代价高、且
 * 需要逐行解析 tool_status；tool_usage 把每次工具/技能调用打平成一行
 * 聚合事实（时间 + 会话 + 工具名 + 结果状态 + 次数），让
 *   - 按天/按状态/按工具/按会话的统计都变成轻量 GROUP BY；
 *   - 会话删除时能随 session_id 级联清理（见 sessionStore）。
 *
 * 写入点约定：调用方（agent 执行管线）在每次工具完成时显式调用
 * recordToolUsage，随后可用 sweepToolUsage(createdAt) 做批量汇总回填，
 * 两者以 created_at / tool_name / status 去重，不会双计。
 */
import { getDb } from './schema.js'
import { withTransaction } from './sqlite-db.js'

export type ToolUsageStatus = 'success' | 'error' | 'denied'

export interface ToolUsageWrite {
  sessionId?: string | null
  toolName: string
  status: ToolUsageStatus
  createdAt?: number
}

export interface ToolUsageRow {
  session_id: string | null
  tool_name: string
  status: ToolUsageStatus
  count: number
  created_at: number
}

/** 写入一次工具/技能调用（默认计数 1，createdAt 缺省用当前时间）。 */
export function recordToolUsage(w: ToolUsageWrite): void {
  getDb().prepare(`
    INSERT INTO tool_usage (session_id, tool_name, status, count, created_at)
    VALUES (?, ?, ?, 1, ?)
  `).run(
    w.sessionId ?? null,
    w.toolName,
    w.status,
    w.createdAt ?? Date.now(),
  )
}

/**
 * 从 messages.tool 行按 (session_id, tool_name, status, created_at) 汇总回填
 * 到 tool_usage。create_at 按天截断对齐，避免同一天同一工具多次调用产生多行。
 * 先删窗口内旧聚合再插入，天然幂等。
 */
export function sweepToolUsage(startMs: number, endMs: number): void {
  const db = getDb()
  withTransaction(db, () => {
    db.prepare('DELETE FROM tool_usage WHERE created_at >= ? AND created_at < ?')
      .run(startMs, endMs)
    const rows = db.prepare(`
      SELECT
        session_id,
        tool_name,
        CASE
          WHEN tool_status = 'error' OR is_error = 1 THEN 'error'
          WHEN tool_status = 'denied' THEN 'denied'
          ELSE 'success'
        END AS status,
        (created_at / 86400000) * 86400000 AS day_start,
        COUNT(*) AS cnt
      FROM messages
      WHERE role = 'tool'
        AND tool_name IS NOT NULL
        AND tool_name != ''
        AND created_at >= ?
        AND created_at < ?
      GROUP BY session_id, tool_name, status, day_start
    `).all(startMs, endMs) as Array<{
      session_id: string | null
      tool_name: string
      status: ToolUsageStatus
      day_start: number
      cnt: number
    }>
    const ins = db.prepare(`
      INSERT INTO tool_usage (session_id, tool_name, status, count, created_at)
      VALUES (?, ?, ?, ?, ?)
    `)
    for (const r of rows) {
      ins.run(r.session_id, r.tool_name, r.status, r.cnt, r.day_start)
    }
  })
}
