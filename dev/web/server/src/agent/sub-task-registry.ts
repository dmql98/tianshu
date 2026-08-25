/**
 * P5 批次聚合：同一父 run 拉起的并行子任务「全部完成」检测。
 *
 * 每个 delegate 派发时 registerPendingSub（子会话创建后立即注册）；
 * 每个子任务完成回注时 completePendingSub（最后一个完成 → 返回 true，由
 * 调用方决定唤醒父会话）。这样父 LLM 只被唤醒一次，且看到的是全部回注结果。
 *
 * 内存态：服务重启后丢失，但重启时子任务大多已中断，可接受（与 run-coordinator
 * 同生命周期，保持简单）。
 */

const pendingByParentRun = new Map<string, Set<string>>()

export function registerPendingSub(parentRunId: string, subSessionId: string): void {
  let set = pendingByParentRun.get(parentRunId)
  if (!set) {
    set = new Set()
    pendingByParentRun.set(parentRunId, set)
  }
  set.add(subSessionId)
}

/**
 * 标记一个子任务完成。返回 true 表示该父 run 的批次全部完成（集合已清空），
 * 调用方应在此刻唤醒父会话。
 */
export function completePendingSub(parentRunId: string, subSessionId: string): boolean {
  const set = pendingByParentRun.get(parentRunId)
  if (!set) return false
  set.delete(subSessionId)
  if (set.size === 0) {
    pendingByParentRun.delete(parentRunId)
    return true
  }
  return false
}

/** 派发/唤醒失败时清空整个批次（避免残留导致永不唤醒）。 */
export function clearPendingSubs(parentRunId: string): void {
  pendingByParentRun.delete(parentRunId)
}

export function pendingSubCount(parentRunId: string): number {
  return pendingByParentRun.get(parentRunId)?.size ?? 0
}
