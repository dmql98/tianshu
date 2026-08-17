import type { LLMMessage } from '../../llm/client.js'
import type { ToolCallRecord } from '../inner.js'
import { pruneToolResultContent } from './tool-result-pruner.js'
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
export const KEEP_TOKENS = envInt('TSS_KEEP_TOKENS', 8000)
export const SNIP_KEEP_TOOL_TURNS = envInt('TSS_SNIP_KEEP_TOOL_TURNS', 3)
export const SUMMARY_OUTPUT_TOKENS = 2048

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

export function shouldCompact(messages: LLMMessage[], contextWindow = DEFAULT_CONTEXT_WINDOW): boolean {
  return estimateTokens(messages) > contextWindow * COMPACT_THRESHOLD
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

export function shouldCompactTokens(usedTokens: number, contextWindow = DEFAULT_CONTEXT_WINDOW): boolean {
  return usedTokens > contextWindow * COMPACT_THRESHOLD
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
      if (turnCount > SNIP_KEEP_TOOL_TURNS) {
        const toolIds = new Set(m.tool_calls.filter(tc => tc.id).map(tc => tc.id!))
        for (let j = i + 1; j < messages.length; j++) {
          if (messages[j].role === 'tool' && messages[j].tool_call_id && toolIds.has(messages[j].tool_call_id!)) {
            const content = messages[j].content
            const original = typeof content === 'string' ? content : ''
            const prunedContent = pruneToolResultContent(original)
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
