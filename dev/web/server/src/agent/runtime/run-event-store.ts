import { randomUUID } from 'crypto'
import type { TransportBroadcaster } from '../../transport/runtime.js'
import { getDb } from '../../db/schema.js'
import { withTransaction } from '../../db/sqlite-db.js'
import { runStore, isParked, type RunPhase } from './run-store.js'
import { checkpointStore } from './checkpoint-store.js'
import { fanOutToSinks } from '../../transport/event-sinks.js'

export const RAW_STREAM = Symbol('tianshu.rawStream')

// ── R9: run_events write-behind（对齐 DSH SessionWriteBehind 思路）──
// 第一刀（R8）已把高频流式事件（message.delta / tool.output）排除落库，剩余
// durable 事件（run.* / tool.started / tool.completed / message.metrics / usage
// / approval.* 等）每个仍触发一次同步 INSERT 事务。低频下单次开销小，但工具
// 密集 loop（多轮 tool.started→completed）累积几十次 BEGIN/COMMIT 仍会让事件
// 循环出现毫秒级毛刺。本队列把 INSERT 聚合到 ~100ms 窗口批量落库（一个事务
// 多行），状态机副作用（runs 表 / checkpoints 表）保持同步——它们是恢复与
// 审批的权威，不能延迟。
//
// 一致性语义：
// - append() 同步执行状态机副作用并分配 seq（内存游标，见 nextSeq），row 入队
//   后立即返回（广播不依赖落库）；
// - 终态事件（run.completed 等）与 approval.requested 触发该 run 立即 flush，
//   保证恢复/轨迹/统计读到的日志与 runs 表一致；
// - 读取端（list / trajectory 相关 SQL 前）flush 对应 run，重放不漏；
// - 崩溃窗口最多丢 ~100ms 内非终态事件的日志行，runs 表状态已同步提交，
//   恢复语义不受影响（与 R8 的取舍一致：日志是诊断数据，状态机是权威）。
const WRITE_BEHIND_MS = 100
const pendingLogs = new Map<string, RunEventRow[]>()
/** 内存 seq 游标：启动/首次 append 时从 MAX(seq) 起步，之后内存递增，
 *  避免未落库行与 MAX 查询冲突导致 UNIQUE(run_id, seq) 违例。 */
const seqCursor = new Map<string, number>()
let flushTimer: ReturnType<typeof setTimeout> | null = null

/** 分配下一个 seq：内存游标优先，缺失时从 DB MAX(seq) 初始化。 */
function nextSeq(runId: string): number {
  let cur = seqCursor.get(runId)
  if (cur === undefined) {
    const max = (getDb().prepare(
      'SELECT COALESCE(MAX(seq), 0) AS m FROM run_events WHERE run_id = ?',
    ).get(runId) as { m: number }).m
    cur = max
  }
  const next = cur + 1
  seqCursor.set(runId, next)
  return next
}

/** 立即落库一个 run 的 pending 行（一个事务批量 INSERT）。失败保留队列重试。 */
export function flushRunPending(runId: string): void {
  const rows = pendingLogs.get(runId)
  if (!rows || rows.length === 0) return
  pendingLogs.delete(runId)
  const db = getDb()
  try {
    withTransaction(db, () => {
      const stmt = db.prepare(`
        INSERT INTO run_events
          (event_id, run_id, session_id, seq, type, payload, created_at)
        VALUES
          (@event_id, @run_id, @session_id, @seq, @type, @payload, @created_at)
      `)
      for (const row of rows) stmt.run(row)
    })
  } catch (err) {
    // run/会话已被删除（DELETE session → runs → run_events 级联）时，pending
    // 行失去外键目标，INSERT 必然失败且重试无意义——直接丢弃，避免无限重试
    // 刷错误日志。run 仍存在则保留队列等待下次重试。
    const run = runStore.get(runId)
    if (!run) return
    pendingLogs.set(runId, rows)
    console.error(`[run-event] write-behind flush failed for ${runId}:`, err)
  }
}

/** 落库所有 pending 行（定时器到期 / 读取端兜底）。 */
export function flushAllPending(): void {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
  for (const runId of [...pendingLogs.keys()]) flushRunPending(runId)
}

function scheduleFlush(): void {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    flushAllPending()
  }, WRITE_BEHIND_MS)
}

/** 需要立即落库的事件：终态（恢复/轨迹/统计权威）与 approval（checkpoint 同步）。 */
const IMMEDIATE_FLUSH = /^(run\.(completed|failed|cancelled|max_turns|budget_exhausted|interrupted|queued|started)|approval\.requested|ask_user)/

export interface RunEventRow {
  event_id: string
  run_id: string
  session_id: string
  seq: number
  type: string
  payload: string
  created_at: number
}

const PHASE_BY_EVENT: Array<[RegExp, RunPhase]> = [
  [/^message\.|^run\.retrying$|^usage$|^message\.metrics$/, 'model'],
  [/^tool\.|^approval\./, 'tools'],
  [/^agent_task\.|^sub_agent\./, 'delegate'],
  [/^plan\.|^goal\./, 'verify'],
]

function terminalStatus(type: string, payload: Record<string, unknown>) {
  if (type === 'run.failed') return 'failed' as const
  if (type === 'run.cancelled') return 'cancelled' as const
  if (type === 'run.max_turns') return 'max_turns' as const
  if (type === 'run.budget_exhausted') return 'budget_exhausted' as const
  if (type === 'run.interrupted') return 'interrupted' as const
  if (type !== 'run.completed') return null
  if (payload.status === 'cancelled') return 'cancelled' as const
  if (payload.status === 'max_turns') return 'max_turns' as const
  return 'completed' as const
}

export const runEventStore = {
  list(runId: string, afterSeq = 0, limit = 1000): RunEventRow[] {
    // 读取前先落 pending 行，保证重放/轨迹不漏最近事件。
    flushRunPending(runId)
    return getDb().prepare(`
      SELECT * FROM run_events
      WHERE run_id = ? AND seq > ?
      ORDER BY seq ASC LIMIT ?
    `).all(runId, afterSeq, limit) as RunEventRow[]
  },

  append(runId: string, type: string, payload: Record<string, unknown>): RunEventRow | null {
    const db = getDb()
    const row = withTransaction(db, () => {
      const run = runStore.get(runId)
      if (!run) throw new Error(`Run "${runId}" not found`)
      const terminal = terminalStatus(type, payload)
      if (terminal) {
        const accepted = runStore.finish(runId, terminal, {
          usage: payload.usage,
          result: payload.result,
          error: typeof payload.error === 'string' ? payload.error : undefined,
        })
        if (!accepted) return null
      } else if (type === 'run.started') {
        runStore.transition(runId, 'running', 'model')
      } else if (type === 'approval.requested') {
        runStore.transition(runId, 'awaiting_approval', 'tools')
        checkpointStore.create(runId, {
          reason: 'approval.requested',
          pendingRequest: JSON.stringify(payload),
        })
      } else {
        const current = runStore.get(runId)
        // A run parked on approval/input/pause resumes as soon as real tool
        // or model activity arrives. Note `tool.started` is emitted BEFORE
        // `approval.requested` for a single call, so the resuming signal is
        // usually the post-approval `tool.output` / `tool.completed` — the
        // resume must accept any activity, not just a fresh `tool.started`.
        if (current && isParked(current.status) && /^(tool\.|message\.)/.test(type)) {
          runStore.transition(runId, 'queued', 'tools')
          runStore.transition(runId, 'preparing', 'tools')
          runStore.transition(runId, 'running', 'tools')
        }
        const phase = PHASE_BY_EVENT.find(([pattern]) => pattern.test(type))?.[1]
        if (phase) runStore.setPhase(runId, phase)
      }
      const row: RunEventRow = {
        event_id: `reve_${randomUUID()}`,
        run_id: runId,
        session_id: run.session_id,
        seq: nextSeq(runId),
        type,
        payload: JSON.stringify(payload),
        created_at: Date.now(),
      }
      return row
    })
    if (!row) return null
    // 状态机副作用已同步提交；日志行走 write-behind 批量。
    const pending = pendingLogs.get(runId) ?? []
    pending.push(row)
    pendingLogs.set(runId, pending)
    if (IMMEDIATE_FLUSH.test(type)) flushRunPending(runId)
    else scheduleFlush()
    return row
  },
}

export function publishRunEvent(
  target: TransportBroadcaster,
  runId: string,
  type: string,
  payload: Record<string, unknown>,
): RunEventRow | null {
  const row = runEventStore.append(runId, type, payload)
  if (!row) return null
  // The packaged desktop server is a forked Node child. Send approval prompts
  // directly to Electron's main process as well as the sinks so a suspended or
  // disconnected renderer cannot hide a request that is blocking the run.
  if (type === 'approval.requested' && typeof process.send === 'function') {
    const session = getDb().prepare('SELECT title FROM sessions WHERE id = ?').get(row.session_id) as
      | { title?: string }
      | undefined
    try {
      process.send({
        type: 'approval-required',
        sessionId: row.session_id,
        runId: row.run_id,
        toolCallId: typeof payload.tool_call_id === 'string' ? payload.tool_call_id : '',
        sessionTitle: session?.title,
        toolName: typeof payload.tool_name === 'string' ? payload.tool_name : undefined,
        approvalKind: payload.approval_kind === 'workspace' ? 'workspace' : 'risk',
      })
    } catch {
      /* desktop IPC may already be closing; sink delivery still proceeds */
    }
  }
  // The transaction above has committed before anything reaches a transport.
  // Delivery is transport-neutral: emit to the run's target AND fan out to
  // every registered sink (SSE connections + Electron IPC).
  const envelope = {
    ...payload,
    event_id: row.event_id,
    session_id: row.session_id,
    run_id: row.run_id,
    seq: row.seq,
    type: row.type,
    occurred_at: row.created_at,
  }
  target.emit(type, envelope)
  // Sinks receive the same envelope; errors are contained inside fanOutToSinks.
  fanOutToSinks(type, envelope)
  return row
}

// R7: `tool.output` (bash 流式 chunk, 每 chunk 一次 emit) 不再参与 durable 落库——
// 它是 high-volume 流式事件，逐 chunk INSERT run_events 会是最大的写入放大点。
// tool.started / tool.completed / approval.requested 等状态类事件仍落库（run 状态机
// 与 checkpoint 依赖），最终结果由 tool.completed + messages 表承载，无信息丢失。
//
// R8: `message.delta` 与 `tool.output` 同等待遇——每 token 一次 emit 的高频流式事件，
// 不再同步落库。读取端早已按 `NOT IN ('message.delta','tool.output')` 排除它们
// （routes/runs.ts trajectory、routes/sessions.ts 统计），最终文本由 messages 表
// 全量承载（innerLoop 结束时 messageStore.addMessage），逐 token 落库是只写不读的
// 同步写事务，阻塞事件循环导致流式推送脉冲式卡顿。message.metrics / message.done
// 等低频终态事件仍 durable。
const DURABLE_EVENT = /^(run\.|message\.(?!delta$)|tool\.(?!output$)|approval\.|control\.|plan\.|goal\.|agent_task\.|character\.|sub_agent\.|usage$|ask_user$)/

export function createDurableStream(stream: TransportBroadcaster, runId: string): TransportBroadcaster {
  return new Proxy(stream, {
    get(target, prop, receiver) {
      if (prop === RAW_STREAM) return target
      if (prop !== 'emit') return Reflect.get(target, prop, receiver)
      return (type: string, payload?: Record<string, unknown>, ...rest: unknown[]) => {
        if (DURABLE_EVENT.test(type) && payload && typeof payload === 'object') {
          try {
            return !!publishRunEvent(target, runId, type, { ...payload, run_id: runId })
          } catch (err) {
            // 落库（append/状态机）抛错绝不能拖垮实时广播：广播是流式命脉，
            // 落库是 write-behind 日志。降级为纯广播（不落库），并记录错误。
            console.error(`[run-event] durable emit failed for ${type}, degrading to broadcast-only:`, err)
            target.emit(type, payload as Record<string, unknown>, ...rest)
            fanOutToSinks(type, payload as Record<string, unknown>)
            return true
          }
        }
        // R8: 非 durable 高频事件（message.delta / tool.output）不落库，但必须
        // 照常投递——`target` 在 SSE / Electron IPC 传输下是 NOOP shim
        // （ws/handlers.ts 注释：delivery via fanOutToSinks），唯一通道就是
        // sinks；只 target.emit 会把 delta 静默丢弃，表现为"流式不输出、
        // 刷新页面才出来"（文本由 messages 表承载，刷新后可见）。
        if (payload && typeof payload === 'object') {
          target.emit(type, payload, ...rest)
          fanOutToSinks(type, payload as Record<string, unknown>)
          return true
        }
        return target.emit(type, payload, ...rest)
      }
    },
  })
}

export function unwrapDurableStream(stream: TransportBroadcaster): TransportBroadcaster {
  return (stream as TransportBroadcaster & { [RAW_STREAM]?: TransportBroadcaster })[RAW_STREAM] || stream
}

/** Force a run to the terminal `cancelled` state at the DB level, bypassing
 *  any in-memory coordinator entry. Returns the persisted terminal event (or
 *  null if the run was already terminal / unknown). Callers must still publish
 *  it through the durable stream to notify clients. */
export function forceCancelRun(runId: string, reason = 'user_requested'): RunEventRow | null {
  const run = runStore.get(runId)
  if (!run) return null
  return runEventStore.append(runId, 'run.cancelled', { status: 'cancelled', reason })
}

/** Force-cancel every non-terminal run of a session (e.g. one stuck in
 *  `awaiting_approval` with no live coordinator entry after a restart). */
export function forceCancelSessionRuns(sessionId: string, reason = 'user_requested'): Array<{ runId: string; event: RunEventRow }> {
  const cancelled: Array<{ runId: string; event: RunEventRow }> = []
  for (const run of runStore.listForSession(sessionId, 50)) {
    if (isTerminalStatus(run.status)) continue
    const event = forceCancelRun(run.id, reason)
    if (event) cancelled.push({ runId: run.id, event })
  }
  return cancelled
}

function isTerminalStatus(status: string): boolean {
  return ['completed', 'failed', 'cancelled', 'max_turns', 'budget_exhausted', 'interrupted'].includes(status)
}

/**
 * Startup recovery for the continuation chain (§11.4). Runs at boot, before any
 * traffic, so a previous process crash cannot leave the durable event log and
 * run rows inconsistent.
 *
 * Returns a summary of what was repaired.
 */
export function recoverContinuationState(): { interrupted: string[]; repairedEvents: string[]; cancelledQueued: string[] } {
  // 防御性：启动恢复前清空任何 write-behind pending（正常为 0），
  // 保证下面的 run_events 直查与 append 后的状态一致。
  flushAllPending()
  const interrupted: string[] = []
  const repairedEvents: string[] = []
  const cancelledQueued: string[] = []

  // 1. Orphaned running/preparing/cancelling runs (their in-memory coordinator
  //    + run closures died with the previous process). Mark interrupted rather
  //    than re-executing tools — never duplicate side effects. append()
  //    performs the status transition to `interrupted` and persists the event.
  const orphans = getDb().prepare(
    `SELECT id FROM runs WHERE status IN ('running', 'preparing', 'cancelling')`,
  ).all() as Array<{ id: string }>
  for (const row of orphans) {
    const event = runEventStore.append(row.id, 'run.interrupted', { reason: 'orphaned_after_restart' })
    if (event) interrupted.push(row.id)
  }

  // 2. Repair missing `run.queued` durable events for queued runs (mapping
  //    exists in runs, but the event row was lost). Idempotent.
  const queued = getDb().prepare(
    `SELECT id FROM runs WHERE status = 'queued'`,
  ).all() as Array<{ id: string }>
  for (const row of queued) {
    const hasQueued = getDb().prepare(
      `SELECT 1 FROM run_events WHERE run_id = ? AND type = 'run.queued' LIMIT 1`,
    ).get(row.id)
    if (!hasQueued) {
      runEventStore.append(row.id, 'run.queued', {
        run_id: row.id,
        status: 'queued',
      })
      repairedEvents.push(row.id)
    }
  }

  // 3. Cancel orphaned queued runs: the coordinator that would have started
  //    them died with the previous process, so they will never execute. Without
  //    this, a queued run stays non-terminal forever and re-sticks the client
  //    (resumeActiveRun treats any non-terminal run as "running").
  for (const row of queued) {
    const event = runEventStore.append(row.id, 'run.cancelled', { status: 'cancelled', reason: 'orphaned_after_restart' })
    if (event) cancelledQueued.push(row.id)
  }

  return { interrupted, repairedEvents, cancelledQueued }
}
