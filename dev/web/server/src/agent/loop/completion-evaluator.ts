import type { ToolCallRecord } from '../inner.js'

/**
 * Completion evaluator: decides whether a model turn is done, doomed, or
 * should keep working. Migrated from agent/inner.ts (doom-loop detection)
 * and agent/outer.ts (final-answer policy).
 */

export type DoomVerdict =
  | { doomed: false }
  | { doomed: true; kind: 'all_failed'; lastTool: string }
  | { doomed: true; kind: 'identical_calls'; lastTool: string; argsPreview: string }

export function detectDoomLoop(toolCallHistory: ToolCallRecord[]): DoomVerdict {
  if (toolCallHistory.length < 6) return { doomed: false }
  const recent = toolCallHistory.slice(-6)

  // Branch A: six consecutive real failures — the model is genuinely stuck.
  if (recent.every(r => r.hasError)) {
    return { doomed: true, kind: 'all_failed', lastTool: recent[recent.length - 1].toolName }
  }

  // Branch B: identical-call spin — same tool + same normalized args + same
  // result hash. Legitimate sequential workflows (install → verify → probe →
  // locate) reuse one tool with DIFFERENT args and must not trip this; records
  // without hashes (legacy/synthetic) are never comparable and never doom here.
  const first = recent[0]
  const identical = recent.every(r =>
    r.toolName === first.toolName &&
    !!r.normalizedArgsHash &&
    r.normalizedArgsHash === first.normalizedArgsHash &&
    !!r.resultHash &&
    r.resultHash === first.resultHash,
  )
  if (identical) {
    return {
      doomed: true,
      kind: 'identical_calls',
      lastTool: first.toolName,
      argsPreview: (first.args || '').slice(0, 200),
    }
  }
  return { doomed: false }
}

export interface FinalAnswerDecision {
  shouldStop: boolean
  reason: 'final_answer' | 'no_text_with_tools' | 'no_tools_no_text'
}

/**
 * Evaluate a final_answer result. If the model produced no text but did use
 * tools, the task is likely unfinished — the loop should push a system note
 * and continue instead of stopping.
 */
export function evaluateFinalAnswer(
  fullText: string,
  toolCallHistory: ToolCallRecord[],
): FinalAnswerDecision {
  if (fullText) return { shouldStop: true, reason: 'final_answer' }
  if (toolCallHistory.length > 0) return { shouldStop: false, reason: 'no_text_with_tools' }
  return { shouldStop: true, reason: 'no_tools_no_text' }
}

export interface SubmissionCheckInput {
  mode: 'direct' | 'plan_first' | 'goal'
  planCompleted: boolean
  unmetSteps: Array<{ ordinal: number; title: string }>
  goalVerification?: string | null
  summary: string
  evidence: string[]
}

export interface SubmissionCheckResult {
  accepted: boolean
  unmet: string[]
}

/**
 * CompletionEvaluator for submit_result. In Plan-first mode every plan step
 * must be completed; in Goal mode the submission must carry concrete evidence
 * (file paths / tool outputs) against the goal's verification standard.
 */
export function evaluateSubmission(input: SubmissionCheckInput): SubmissionCheckResult {
  const unmet: string[] = []
  if (input.mode === 'plan_first' || input.mode === 'goal') {
    if (!input.planCompleted) {
      if (input.unmetSteps.length > 0) {
        unmet.push(`未完成计划步骤: ${input.unmetSteps.map(s => `${s.ordinal}. ${s.title}`).join('; ')}`)
      } else {
        unmet.push('尚不存在已完成的执行计划')
      }
    }
  }
  if (input.mode === 'goal') {
    if (input.evidence.length === 0) {
      unmet.push('缺少结果证据；evidence 必须包含支撑结论的文件路径或工具输出')
    }
    if (!input.summary.trim()) {
      unmet.push(`缺少结果摘要；必须对照验证标准总结结果: ${input.goalVerification || '未定义验证标准'}`)
    }
  }
  return { accepted: unmet.length === 0, unmet }
}
