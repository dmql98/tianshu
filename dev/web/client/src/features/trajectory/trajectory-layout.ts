import type { TrajectoryModel, TrajectoryRow } from './trajectory'

/**
 * 布局折叠层（对标 deepseek-harness 的 layout.ts）：
 * 把平铺的 rows 折叠成 Turn → Group（「消息」或「Step N」）→ 行 的三层模型，
 * 并在 Step 组上附加请求编号与累计 token 用量。
 *
 * Turn 边界 = user 消息（新轮次）；Step 组 = 一次 LLM 调用（assistant 行 + 其
 * 后继承同一 step 的 tool 行）。step 序号由 buildTrajectory 预先算出。
 */

export type TrajectoryGroupKind = 'message' | 'step'

/** 一个折叠组：「消息」（一个或多个 user 行）或「Step N」（一次 LLM 调用）。 */
export interface TrajectoryGroup {
  kind: TrajectoryGroupKind
  /** Step 组的 LLM 调用序号（assistant 行计数）；消息组为 null。 */
  step: number | null
  rows: TrajectoryRow[]
  /** 该组完成后（含本组）的累计 input/output tokens（step 组才有意义）。 */
  cumulativeInput: number
  cumulativeOutput: number
}

/** 一个轮次：以 user 消息开头的会话段。 */
export interface TrajectoryTurn {
  /** 1-based 轮次号；无 user 开头的延续段为 0。 */
  turn: number
  startedAt: number
  groups: TrajectoryGroup[]
}

export interface TrajectoryLayout {
  turns: TrajectoryTurn[]
  /** 整段累计 input/output tokens（= 最后一个 step 组的累计值）。 */
  totalInput: number
  totalOutput: number
  /** LLM 请求次数（= assistant 行数）。 */
  requestCount: number
}

/**
 * 把轨迹模型折叠为轮次分组模型。纯函数：不修改入参，按 rows 顺序单遍构建。
 */
export function buildTrajectoryLayout(model: TrajectoryModel): TrajectoryLayout {
  const turns: TrajectoryTurn[] = []
  let turnNo = 0
  let currentTurn: TrajectoryTurn | null = null
  let lastGroup: TrajectoryGroup | null = null
  let cumulativeInput = 0
  let cumulativeOutput = 0
  let requestCount = 0

  for (const row of model.rows) {
    if (row.kind === 'user') {
      // 新轮次：user 消息组。
      turnNo += 1
      const turn: TrajectoryTurn = { turn: turnNo, startedAt: row.createdAt, groups: [] }
      turns.push(turn)
      currentTurn = turn
      const group: TrajectoryGroup = {
        kind: 'message', step: null, rows: [], cumulativeInput, cumulativeOutput,
      }
      turn.groups.push(group)
      lastGroup = group
      group.rows.push(row)
      continue
    }

    // assistant / tool：归属当前轮次（无 user 开头的延续段 → 轮次 0）。
    if (!currentTurn) {
      const turn: TrajectoryTurn = { turn: 0, startedAt: row.createdAt, groups: [] }
      turns.push(turn)
      currentTurn = turn
    }
    let group: TrajectoryGroup | null = lastGroup
    if (!group || group.kind !== 'step' || group.step !== row.step) {
      if (row.kind === 'assistant') requestCount += 1
      group = {
        kind: 'step', step: row.step, rows: [], cumulativeInput, cumulativeOutput,
      }
      currentTurn.groups.push(group)
      lastGroup = group
    }
    group.rows.push(row)
    if (row.kind === 'assistant') {
      cumulativeInput += row.inputTokens ?? 0
      cumulativeOutput += row.outputTokens ?? 0
      // 组头显示「本请求完成后」的累计值，所以用更新后的值。
      group.cumulativeInput = cumulativeInput
      group.cumulativeOutput = cumulativeOutput
    }
  }

  return {
    turns,
    totalInput: cumulativeInput,
    totalOutput: cumulativeOutput,
    requestCount,
  }
}

/** 请求编号：Step 组显示为 `#N`（非 compaction 请求按出现顺序编号）。 */
export function requestNumber(group: TrajectoryGroup): number | null {
  return group.kind === 'step' ? group.step : null
}
