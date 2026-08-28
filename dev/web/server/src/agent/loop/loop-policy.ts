import type { LLMMessage } from '../../llm/client.js'
import type { ToolCallRecord } from '../inner.js'
import { codePointLength, pruneToolResultContent } from './tool-result-pruner.js'
import { envInt } from '../../config.js'

/**
 * Loop policy: token budgeting, compaction thresholds and run limits.
 * Pure helpers migrated from agent/outer.ts.
 */

// P2-2: 阈值配置化（环境变量，进程级常量）。
export const DEFAULT_MAX_TURNS = envInt('TSS_MAX_TURNS', 50)
export const DEFAULT_CONTEXT_WINDOW = envInt('TSS_DEFAULT_CONTEXT_WINDOW', 200000)

export const SOFT_COMPACT_RATIO = 0.5
export const SNIP_RATIO = 0.6
export const COMPACT_THRESHOLD = 0.75
export const COLD_RESUME_MS = 24 * 60 * 60 * 1000
/** 保留预算下限/上限（P1-3：预算按窗口缩放时的夹取范围）。 */
export const KEEP_TOKENS_MIN = envInt('TSS_KEEP_TOKENS_MIN', 4000)
export const KEEP_TOKENS_MAX = envInt('TSS_KEEP_TOKENS_MAX', 64000)
/** 保留比：默认 0.16，对齐 deepseek-harness（P1-3）。 */
export const COMPACT_RETAIN_RATIO = parseFloat(process.env.TSS_COMPACT_RETAIN_RATIO || '0.16') || 0.16
/** 手动压缩触发阈值（用户主动点击）：会话用量超过该比例才执行压缩；低于视为无需压缩。 */
export const MANUAL_COMPACT_RATIO = parseFloat(process.env.TSS_MANUAL_COMPACT_RATIO || '0.35') || 0.35
/** 手动压缩的绝对触发下限（token）：相对比例对超大窗口模型（如 1M）过于宽松，
 *  用户常在远低于 50% 窗口时就想手动压缩；触发阈值取 min(窗口×比例, 绝对下限)。
 *  设 0 或负值禁用绝对下限，退回纯相对阈值。 */
export const MANUAL_COMPACT_ABSOLUTE = envInt('TSS_MANUAL_COMPACT_ABSOLUTE', 170000)

/** 手动压缩触发阈值：相对（窗口×MANUAL_COMPACT_RATIO）与绝对下限取较小值。
 *  默认相对 0.35：200k 窗口在 70k 即可触发；1M 窗口被绝对下限 170k 提前接管
 *  （相对 350k 太晚）。小窗口模型不受绝对下限影响（相对阈值更低）。 */
export function manualCompactThreshold(contextWindow = DEFAULT_CONTEXT_WINDOW): number {
  const relative = contextWindow * MANUAL_COMPACT_RATIO
  if (MANUAL_COMPACT_ABSOLUTE > 0) return Math.min(relative, MANUAL_COMPACT_ABSOLUTE)
  return relative
}
/** 单次压缩重试上限（P0-1，对齐 compactionRetries）。 */
export const MAX_COMPACT_ATTEMPTS = envInt('TSS_COMPACT_RETRIES', 2)
/** 溢出触发的压缩重试上限（P1-6，对齐 maxOverflowRetries）。 */
export const MAX_OVERFLOW_COMPACTS = envInt('TSS_OVERFLOW_RETRIES', 2)
export const SNIP_KEEP_TOOL_TURNS = envInt('TSS_SNIP_KEEP_TOOL_TURNS', 3)
export const SUMMARY_OUTPUT_TOKENS = 2048
/** P0-1：snip 时对近期窗口（最近 SNIP_KEEP_TOOL_TURNS 轮）工具结果的头尾剪枝上限（字符）。 */
export const RECENT_PRUNE_CHARS = envInt('TSS_RECENT_PRUNE_CHARS', 16384)
/** P2：压缩预留缓冲（环境变量）。压缩后的 recent 预算不超过 contextWindow − reserved，
 *  为模型输出留出空间。默认 0 = 不额外限制（沿用阈值与保留比之间的天然差 + shrinkVerified）。 */
export const COMPACT_RESERVED = envInt('TSS_COMPACT_RESERVED', 0)

/**
 * 可配置的压缩策略（P1-4）：阈值/保留比/摘要模型。模型级（ModelInfo 扩展字段）
 * 优先，未配置时回退全局默认。thresholdRatio 等均可在模型目录逐模型覆盖。
 */
export interface CompactPolicy {
  thresholdRatio: number
  retainRatio: number
  summarizationProvider?: string
  summarizationModel?: string
}

export const DEFAULT_COMPACT_POLICY: CompactPolicy = {
  thresholdRatio: COMPACT_THRESHOLD,
  retainRatio: COMPACT_RETAIN_RATIO,
}

export function resolveCompactPolicy(modelConfig?: {
  compact_threshold_ratio?: number
  compact_retain_ratio?: number
  compact_provider?: string
  compact_model?: string
} | null): CompactPolicy {
  return {
    thresholdRatio: modelConfig?.compact_threshold_ratio ?? COMPACT_THRESHOLD,
    retainRatio: modelConfig?.compact_retain_ratio ?? COMPACT_RETAIN_RATIO,
    summarizationProvider: modelConfig?.compact_provider ?? '',
    summarizationModel: modelConfig?.compact_model ?? '',
  }
}

/**
 * 按窗口计算保留预算（P1-3）：retainRatio×contextWindow，夹在 KEEP_TOKENS_MIN/MAX。
 * attempt>0 时逐级减半（P0-1 重试时压缩更激进），下限 KEEP_TOKENS_MIN。
 */
export function resolveKeepTokens(
  contextWindow = DEFAULT_CONTEXT_WINDOW,
  attempt = 0,
  policy: CompactPolicy = DEFAULT_COMPACT_POLICY,
  reserved: number = COMPACT_RESERVED,
): number {
  const scaled = Math.floor(contextWindow * policy.retainRatio)
  const budget = Math.min(KEEP_TOKENS_MAX, Math.max(KEEP_TOKENS_MIN, scaled))
  // P2：reserved > 0 时强制 recent 预算不超过 contextWindow − reserved，为模型输出留空间。
  const capped = reserved > 0
    ? Math.max(KEEP_TOKENS_MIN, Math.min(budget, Math.max(0, contextWindow - reserved)))
    : budget
  return Math.max(KEEP_TOKENS_MIN, capped >> attempt)
}

const IMAGE_TOKEN_EQUIVALENT = 1100

/**
 * CJK-aware text token estimate. Pure char/4 badly undercounts Chinese /
 * Japanese / Korean text (each CJK char ≈ 1 token), which delayed compaction
 * until overflow. CJK chars count 1:1; other text is ~4 chars/token.
 */
export function estimateTextTokens(text: string): number {
  if (!text) return 0
  const cjk = (text.match(/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) || []).length
  const nonCjk = text.length - cjk
  return cjk + Math.ceil(nonCjk / 4)
}

/** Flatten any LLMMessage content (string or multimodal parts) into plain text. */
export function contentToText(content: LLMMessage['content']): string {
  if (!content) return ''
  if (typeof content === 'string') return content
  return content
    .map((p) => {
      if ('text' in p) return p.text || ''
      return '[media attachment]'
    })
    .join('\n')
}

export function estimateTokens(messages: LLMMessage[]): number {
  let total = 0
  for (const m of messages) {
    if (m.content) {
      if (typeof m.content === 'string') total += estimateTextTokens(m.content)
      else {
        for (const p of m.content) {
          if ('text' in p) total += estimateTextTokens(p.text || '')
          else total += IMAGE_TOKEN_EQUIVALENT
        }
      }
    }
    if (m.tool_calls) {
      for (const tc of m.tool_calls) {
        total += estimateTextTokens(tc.function.name) + estimateTextTokens(tc.function.arguments)
      }
    }
    if (m.reasoning_content) total += estimateTextTokens(m.reasoning_content)
    total += 4
  }
  return Math.ceil(total)
}

export function shouldSnip(messages: LLMMessage[], contextWindow = DEFAULT_CONTEXT_WINDOW): boolean {
  return estimateTokens(messages) > contextWindow * SNIP_RATIO
}

export function shouldCompact(messages: LLMMessage[], contextWindow = DEFAULT_CONTEXT_WINDOW, policy: CompactPolicy = DEFAULT_COMPACT_POLICY): boolean {
  return estimateTokens(messages) > contextWindow * policy.thresholdRatio
}

/**
 * Token-based variants backed by the provider-reported input token count
 * (usage.input), which is far more accurate than the char/4 estimate — the
 * local estimate badly under-counts CJK text and can delay compaction until
 * overflow. Callers pass the last request's actual input tokens.
 */
export function shouldSnipTokens(usedTokens: number, contextWindow = DEFAULT_CONTEXT_WINDOW): boolean {
  return usedTokens > contextWindow * SNIP_RATIO
}

export function shouldCompactTokens(usedTokens: number, contextWindow = DEFAULT_CONTEXT_WINDOW, policy: CompactPolicy = DEFAULT_COMPACT_POLICY): boolean {
  return usedTokens > contextWindow * policy.thresholdRatio
}

export function systemMessageEnd(messages: LLMMessage[]): number {
  let i = 0
  while (i < messages.length && messages[i].role === 'system') i++
  return i
}

/** trimToolResults 的结果：是否发生剪枝 + 被剪枝消息的最大 __dbId。 */
export interface TrimResult {
  /** 是否发生了实际剪枝（内存态变化）。 */
  pruned: boolean
  /** 被剪枝消息的最大 __dbId（P0-4 持久化水印用；0 表示无 id 可记录）。 */
  trimmedUntilId: number
}

/**
 * Trim stale tool results beyond the most recent SNIP_KEEP_TOOL_TURNS
 * assistant tool-call turns. Oversized results are head/tail-pruned in place
 * (P0-1) so the retained text stays byte-stable and the prefix cache is not
 * invalidated; small stale results are kept untouched.
 */
export function trimToolResults(messages: LLMMessage[]): TrimResult {
  let pruned = false
  let trimmedUntilId = 0
  let turnCount = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
      turnCount++
      const isRecent = turnCount <= SNIP_KEEP_TOOL_TURNS
      const toolIds = new Set(m.tool_calls.filter(tc => tc.id).map(tc => tc.id!))
      for (let j = i + 1; j < messages.length; j++) {
        if (messages[j].role === 'tool' && messages[j].tool_call_id && toolIds.has(messages[j].tool_call_id!)) {
          const content = messages[j].content
          const original = typeof content === 'string' ? content : ''
          if (!original) continue
          // P0-1：近期窗口（最近 SNIP_KEEP_TOOL_TURNS 轮）内超过硬上限的工具结果也做头尾剪枝
          // （防止其被 repair 整体拉入 recent 后撑破压缩预算导致 not_smaller 死锁）；
          // 旧结果沿用默认阈值。两者都扩展 trimmedUntilId 水印以便重载一致恢复。
          const recentOversized = isRecent && codePointLength(original) > RECENT_PRUNE_CHARS
          const stale = turnCount > SNIP_KEEP_TOOL_TURNS
          if (!recentOversized && !stale) continue
          const prunedContent = recentOversized
            ? pruneToolResultContent(original, {
                thresholdChars: RECENT_PRUNE_CHARS,
                headChars: Math.floor(RECENT_PRUNE_CHARS * 0.6),
                tailChars: Math.floor(RECENT_PRUNE_CHARS * 0.4),
              })
            : pruneToolResultContent(original)
          if (prunedContent !== original) {
            messages[j] = { ...messages[j], content: prunedContent }
            pruned = true
            const dbId = (messages[j] as unknown as { __dbId?: number }).__dbId
            if (typeof dbId === 'number' && dbId > trimmedUntilId) trimmedUntilId = dbId
          }
        }
      }
    }
  }
  return { pruned, trimmedUntilId }
}

// ── Progress assessment (RUN_LIMIT_POLICY_PLAN §8) ──

export type ProgressLevel = 'strong' | 'weak' | 'none'

export interface ProgressSignal {
  kind: string
  key: string
  detail?: string
}

export interface ProgressAssessment {
  level: ProgressLevel
  signals: ProgressSignal[]
  fingerprint: string
  repeatedFingerprint: boolean
}

/**
 * Normalized per-turn facts consumed by assessProgress(). Produced by the loop
 * engine from ToolCallRecords + plan/goal state — the assessment itself is pure.
 */
export interface TurnFacts {
  toolCalls: ToolCallRecord[]
  /** A plan step transitioned to a different status this turn. */
  planStepChanged: boolean
  /** New verification evidence was written for a plan step / goal. */
  verificationEvidenceAdded: boolean
  /** A file was created or an existing file's content hash changed. */
  fileChanged: boolean
  /** A business object in the DB changed state (plan/goal/step). */
  databaseObjectChanged: boolean
  /** The failing set of tests/builds shrank, or a failure became a success. */
  testFailuresReduced: boolean
  /** The first structured evidence influencing future decisions arrived. */
  firstEvidence: boolean
  /** submit_result was accepted (task complete). */
  submitSucceeded: boolean
  /** A file / API object was read for the first time. */
  firstNewRead: boolean
  /** A brand-new error category appeared this turn. */
  newErrorCategory: boolean
  /** The model switched to a tool category it had not used before. */
  toolCategorySwitched: boolean
  /** Context was compacted and token usage dropped significantly. */
  compactionSucceeded: boolean
  /** Only assistant text grew; no new tool results / state. */
  textGrowthOnly: boolean
}

/** Deterministic fingerprint of a turn's tool activity (stable ordering). */
function toolFingerprint(calls: ToolCallRecord[]): string {
  let out = ''
  for (const call of calls) {
    out += [
      call.toolName,
      call.normalizedArgsHash || '',
      call.outcomeKind || '',
      call.hasError ? 'err' : 'ok',
      call.resultHash || '',
    ].join('|')
    out += '\n'
  }
  return out
}

import { createHash } from 'crypto'

/**
 * Stable hash of tool-call arguments: strips timestamps, sorts object keys,
 * and canonicalizes relative paths. Two calls that would hit the same
 * resource with the same intent produce the same hash; volatile noise does not
 * count as a repeat.
 */
export function stableArgsHash(args: unknown): string {
  let out: string
  try {
    out = stableStringify(args)
  } catch {
    out = ''
  }
  return createHash('sha256').update(out).digest('hex').slice(0, 16)
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value === 'string') {
    // Path normalization: collapse drive-relative noise / trailing separators.
    const normalized = value
      .replace(/\\\\/g, '/')
      .replace(/timestamp|ts|time|date|now/gi, '')
      .replace(/\d{4,}/g, 'N')
      .trim()
    return JSON.stringify(normalized)
  }
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value)
}

const OUTCOME_STRONG: Set<string> = new Set(['state_change', 'verification', 'write'])

/**
 * Pure progress assessment for a single turn (§8.2–8.4). Strong signals dominate;
 * weak signals alone can only extend the run a bounded number of times; identical
 * tool fingerprints with no strong signal are flagged as repeated.
 */
export function assessProgress(
  facts: TurnFacts,
  previousFingerprint?: string,
): ProgressAssessment {
  const signals: ProgressSignal[] = []
  let strong = false

  const emit = (kind: string, key: string, detail?: string) => signals.push({ kind, key, detail })

  if (facts.submitSucceeded) { emit('submit_succeeded', 'submit_result'); strong = true }

  // Write tools that actually changed state count as strong progress.
  let fileChangedSeen = false
  for (const call of facts.toolCalls) {
    if (call.changed || (call.outcomeKind && OUTCOME_STRONG.has(call.outcomeKind) && !call.hasError)) {
      emit('state_change', `tool:${call.toolName}`)
      strong = true
    }
    if (call.outcomeKind === 'write' && call.changed) fileChangedSeen = true
  }
  if (facts.fileChanged && !fileChangedSeen) { emit('file_changed', 'file'); strong = true }
  if (facts.planStepChanged) { emit('plan_step_changed', 'plan'); strong = true }
  if (facts.verificationEvidenceAdded || facts.databaseObjectChanged) { emit('verification_evidence', 'verify'); strong = true }
  if (facts.testFailuresReduced) { emit('test_failures_reduced', 'verify'); strong = true }
  if (facts.firstEvidence) { emit('first_evidence', 'evidence'); strong = true }

  if (!strong) {
    if (facts.firstNewRead) emit('first_new_read', 'read')
    if (facts.newErrorCategory) emit('new_error_category', 'error')
    if (facts.toolCategorySwitched) emit('tool_category_switched', 'tools')
    if (facts.compactionSucceeded) emit('context_compacted', 'context')
  }

  const fingerprint = toolFingerprint(facts.toolCalls)
  const repeatedFingerprint = !strong && facts.toolCalls.length > 0
    && !!previousFingerprint && previousFingerprint === fingerprint
    && !facts.planStepChanged && !facts.verificationEvidenceAdded && !facts.fileChanged

  const level: ProgressLevel = strong ? 'strong'
    : signals.length > 0 ? 'weak'
    : 'none'

  return { level, signals, fingerprint, repeatedFingerprint }
}

// ── Structured run-limit result (§9.4) ──

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

/** Runtime state tracking for dynamic convergence (§9.1). */
export interface RunLimitRuntimeState {
  graceStarted: boolean
  graceTurnsUsed: number
  consecutiveNoProgress: number
  consecutiveWeakOnly: number
  lastStrongProgressTurn: number
  warningEmitted: boolean
}

export function createRuntimeState(): RunLimitRuntimeState {
  return {
    graceStarted: false,
    graceTurnsUsed: 0,
    consecutiveNoProgress: 0,
    consecutiveWeakOnly: 0,
    lastStrongProgressTurn: 0,
    warningEmitted: false,
  }
}
