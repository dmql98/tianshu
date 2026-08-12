export interface SystemRunPolicy {
  version: 1
  dynamicLimitEnabled: boolean
  autoContinuationEnabled: boolean

  defaultSoftTurns: number
  defaultGraceTurns: number
  maxAbsoluteTurnsPerRun: number
  maxGraceTurns: number

  noProgressThreshold: number
  weakProgressThreshold: number
  repeatedToolLoopThreshold: number

  maxAutoContinuations: number
  maxChainTurns: number
  maxChainTokens: number
  maxChainWallTimeMs: number
}

export type AutoContinuationPref = 'inherit' | 'enabled' | 'disabled'

export interface CharacterRunPolicy {
  version: 1
  softTurns?: number
  graceTurns?: number
  autoContinuation?: AutoContinuationPref
  maxAutoContinuations?: number
}

export interface RunPolicyEffective {
  softTurns: number
  graceTurns: number
  absoluteTurns: number
  autoContinuation: boolean
  maxAutoContinuations: number
  maxChainTurns: number
  maxChainTokens: number
  maxChainWallTimeMs: number
  noProgressThreshold: number
  weakProgressThreshold: number
  repeatedToolLoopThreshold: number
}

export interface CharacterRunPolicyView {
  configured?: CharacterRunPolicy
  effectivePreview?: RunPolicyEffective
  constrainedFields?: string[]
}

export type RunLimitReason =
  | 'no_progress_after_soft_limit'
  | 'absolute_limit'
  | 'repeated_tool_loop'
  | 'continuation_limit'

export interface RunLimitSummary {
  reason: RunLimitReason
  policyVersion: number
  softTurns: number
  absoluteTurns: number
  turnsUsed: number
  graceTurnsUsed: number
  noProgressStreak: number
  continuationScheduled: boolean
  nextRunId?: string
}

export const REASON_LABELS: Record<RunLimitReason, string> = {
  no_progress_after_soft_limit: '连续多轮没有可验证进展，本轮已停止',
  absolute_limit: '已达到系统单轮安全上限',
  repeated_tool_loop: '检测到重复工具循环，本轮已停止',
  continuation_limit: '已达到自动续跑安全预算，可手动检查后继续',
}
