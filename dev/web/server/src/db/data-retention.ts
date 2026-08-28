/**
 * data-retention.ts — 数据库保留策略（诊断数据防无界增长）。
 *
 * run_events / llm_calls 目前只在删除会话时级联清理，长时间运行会无限膨胀：
 * - run_events：每轮 run 写入完整 durable 事件流（tool.started/completed、
 *   message.metrics、usage 等），单条 payload 可包含完整工具输入输出；
 * - llm_calls：每次 LLM 调用写入一条完整 request/response 快照（几十 KB）。
 *
 * 启动 sweep 的取舍：
 * - run_events 只删"已终态 run"的旧事件——非终态 run 的事件是恢复、审批与
 *   checkpoint 的权威数据（recoverContinuationState / approval.requested /
 *   ask_user 依赖），永不清理；终态 run 的 finished_at 超过窗口才整体删除，
 *   避免留下半套事件。
 * - llm_calls 是纯调试/轨迹数据，按 created_at 窗口直接清理。
 *
 * 默认保留 30 天，可通过环境变量调整，设 0 或负数禁用：
 * - TSS_RUN_EVENTS_RETENTION_DAYS
 * - TSS_LLM_CALLS_RETENTION_DAYS
 */
import { getDb } from './schema.js'
import { withTransaction } from './sqlite-db.js'

export const RUN_EVENTS_RETENTION_DAYS_DEFAULT = 30
export const LLM_CALLS_RETENTION_DAYS_DEFAULT = 30

export interface RetentionSweepResult {
  runEventsRemoved: number
  llmCallsRemoved: number
  runEventsRetentionDays: number
  llmCallsRetentionDays: number
}

const DAY_MS = 24 * 60 * 60 * 1000

const TERMINAL_STATUSES_SQL = `('completed','failed','cancelled','interrupted','max_turns','budget_exhausted')`

function parseDays(envValue: string | undefined, fallback: number): number {
  if (envValue === undefined || envValue.trim() === '') return fallback
  const parsed = Number(envValue)
  if (!Number.isFinite(parsed)) return fallback
  return parsed
}

/**
 * 执行保留策略清理（启动时调用一次）。
 *
 * @param now 当前时间（毫秒），测试可注入。
 */
export function sweepDataRetention(now = Date.now()): RetentionSweepResult {
  const db = getDb()
  const runEventsDays = parseDays(process.env.TSS_RUN_EVENTS_RETENTION_DAYS, RUN_EVENTS_RETENTION_DAYS_DEFAULT)
  const llmCallsDays = parseDays(process.env.TSS_LLM_CALLS_RETENTION_DAYS, LLM_CALLS_RETENTION_DAYS_DEFAULT)

  const runEventsCutoff = now - runEventsDays * DAY_MS
  const llmCallsCutoff = now - llmCallsDays * DAY_MS

  const result: RetentionSweepResult = { runEventsRemoved: 0, llmCallsRemoved: 0, runEventsRetentionDays: runEventsDays, llmCallsRetentionDays: llmCallsDays }

  if (runEventsDays <= 0 && llmCallsDays <= 0) return result

  withTransaction(db, () => {
    if (runEventsDays > 0) {
      // 只清理已终态 run 的事件；finished_at 为 NULL 的异常行用 updated_at 兜底，
      // 保证任何终态 run 最终都能被窗口覆盖。
      result.runEventsRemoved = db.prepare(`
        DELETE FROM run_events
        WHERE run_id IN (
          SELECT id FROM runs
          WHERE status IN ${TERMINAL_STATUSES_SQL}
            AND COALESCE(finished_at, updated_at) < ?
        )
      `).run(runEventsCutoff).changes
    }
    if (llmCallsDays > 0) {
      result.llmCallsRemoved = db.prepare(
        'DELETE FROM llm_calls WHERE created_at < ?',
      ).run(llmCallsCutoff).changes
    }
  })

  return result
}