import type { LLMMessage } from '../../llm/client.js'

/**
 * Loop policy: token budgeting, compaction thresholds and run limits.
 * Pure helpers migrated from agent/outer.ts.
 */

export const DEFAULT_MAX_TURNS = 20
export const DEFAULT_CONTEXT_WINDOW = 200000

export const SOFT_COMPACT_RATIO = 0.5
export const SNIP_RATIO = 0.6
export const COMPACT_THRESHOLD = 0.75
export const COLD_RESUME_MS = 24 * 60 * 60 * 1000
export const KEEP_TOKENS = 8000
export const SNIP_KEEP_TOOL_TURNS = 3
export const SUMMARY_OUTPUT_TOKENS = 2048

const IMAGE_TOKEN_EQUIVALENT = 1100

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
      if (typeof m.content === 'string') total += m.content.length / 4
      else {
        for (const p of m.content) {
          if ('text' in p) total += (p.text?.length || 0) / 4
          else total += IMAGE_TOKEN_EQUIVALENT
        }
      }
    }
    if (m.tool_calls) {
      for (const tc of m.tool_calls) {
        total += tc.function.name.length / 4 + tc.function.arguments.length / 4
      }
    }
    if (m.reasoning_content) total += m.reasoning_content.length / 4
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

export function systemMessageEnd(messages: LLMMessage[]): number {
  let i = 0
  while (i < messages.length && messages[i].role === 'system') i++
  return i
}

/**
 * Trim stale tool results beyond the most recent SNIP_KEEP_TOOL_TURNS
 * assistant tool-call turns, replacing their content with a marker so the
 * prefix cache stays stable.
 */
export function trimToolResults(messages: LLMMessage[]): boolean {
  let trimmed = false
  let turnCount = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
      turnCount++
      if (turnCount > SNIP_KEEP_TOOL_TURNS) {
        const toolIds = new Set(m.tool_calls.filter(tc => tc.id).map(tc => tc.id!))
        for (let j = i + 1; j < messages.length; j++) {
          if (messages[j].role === 'tool' && messages[j].tool_call_id && toolIds.has(messages[j].tool_call_id!)) {
            messages[j] = { ...messages[j], content: JSON.stringify({ output: '[trimmed]' }) }
            trimmed = true
          }
        }
      }
    }
  }
  return trimmed
}
