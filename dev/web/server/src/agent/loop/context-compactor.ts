import { streamChatCompletion, type LLMMessage } from '../../llm/client.js'
import { contentToText, systemMessageEnd, KEEP_TOKENS } from './loop-policy.js'

/**
 * Context compactor: summarization, history selection and compaction.
 * Migrated from agent/outer.ts.
 */

export const SUMMARY_OUTPUT_TOKENS = 2048

const SUMMARY_TEMPLATE = `Output exactly the structure below and keep section order. Do not include <template> tags.
<template>
## Goal
- [single-sentence task summary]

## Progress
### Done
- [completed work or "(none)"]

### In Progress
- [current work or "(none)"]

### Blocked
- [blockers or "(none)"]

## Key Decisions
- [decision and why, or "(none)"]

## Next Steps
- [ordered next actions or "(none)"]

## Relevant Context
- [important facts, errors, questions, or "(none)"]
</template>

Rules:
- Keep every section, even when empty.
- Use terse bullets.
- Preserve exact file paths, commands, error strings, and identifiers when known.
- Do not mention the summary process or that context was compacted.`

function buildCompactionSummary(msgs: LLMMessage[]): string {
  const parts: string[] = []
  for (const m of msgs) {
    if (m.role === 'user' && m.content) {
      const c = contentToText(m.content)
      parts.push(`User: ${c.length > 200 ? c.slice(0, 200) + '...' : c}`)
    } else if (m.role === 'assistant') {
      if (m.content) {
        const c = contentToText(m.content)
        parts.push(`Assistant: ${c.length > 200 ? c.slice(0, 200) + '...' : c}`)
      }
      if (m.tool_calls) {
        for (const tc of m.tool_calls) parts.push(`Tool Call: ${tc.function.name}`)
      }
    } else if (m.role === 'tool') {
      const c = contentToText(m.content)
      parts.push(`Tool Result: ${c.includes('error') ? c.slice(0, 100) + '...' : 'success'}`)
    }
  }
  return parts.join('\n')
}

function serializeForSummary(msgs: LLMMessage[]): string {
  const lines: string[] = []
  for (const m of msgs) {
    if (m.role === 'user' && m.content) {
      const c = contentToText(m.content)
      lines.push(c.length > 800 ? `[User]: ${c.slice(0, 800)}...` : `[User]: ${c}`)
    } else if (m.role === 'assistant') {
      if (m.content) {
        const c = contentToText(m.content)
        lines.push(c.length > 400 ? `[Assistant]: ${c.slice(0, 400)}...` : `[Assistant]: ${c}`)
      }
      if (m.tool_calls) {
        for (const tc of m.tool_calls) lines.push(`[Tool call]: ${tc.function.name}`)
      }
    }
  }
  return lines.join('\n')
}

export function selectEntries(
  msgs: LLMMessage[],
  tokenBudget: number,
): { head: LLMMessage[]; recent: LLMMessage[] } | undefined {
  type SerEntry = { text: string; msg: LLMMessage }
  const serialized: SerEntry[] = []
  for (const m of msgs) {
    if (m.role === 'user' && m.content) {
      serialized.push({ text: `[User]: ${contentToText(m.content)}`, msg: m })
    } else if (m.role === 'assistant') {
      const parts: string[] = []
      if (m.content) parts.push(`[Assistant]: ${contentToText(m.content)}`)
      if (m.tool_calls) {
        for (const tc of m.tool_calls) parts.push(`[Tool call]: ${tc.function.name}`)
      }
      if (parts.length) serialized.push({ text: parts.join('\n'), msg: m })
    } else if (m.role === 'tool') {
      const content = contentToText(m.content)
      const status = content.includes('error') ? content.slice(0, 100) : 'success'
      serialized.push({ text: `[Tool result]: ${status}`, msg: m })
    } else if (m.role === 'system' && m.content) {
      serialized.push({ text: `[System]: ${contentToText(m.content).slice(0, 200)}`, msg: m })
    }
  }
  if (serialized.length === 0) return

  let total = 0
  let split = serialized.length
  for (let i = serialized.length - 1; i >= 0; i--) {
    total += Math.ceil(serialized[i].text.length / 4)
    if (total > tokenBudget) { split = i + 1; break }
    split = i
  }

  if (split === 0) return

  const recentMsgs = serialized.slice(split).map(e => e.msg)
  const headMsgs = serialized.slice(0, split).map(e => e.msg)

  // Ensure split doesn't break tool_calls/tool_response pairs
  // If the first message in recent is a tool response, its parent assistant(tool_calls)
  // must also stay in recent — find it in head and move everything after it to recent
  if (recentMsgs.length > 0 && recentMsgs[0].role === 'tool') {
    for (let i = headMsgs.length - 1; i >= 0; i--) {
      if (headMsgs[i].role === 'assistant' && headMsgs[i].tool_calls) {
        const moved = headMsgs.splice(i)
        recentMsgs.unshift(...moved)
        break
      }
    }
  }

  return { head: headMsgs, recent: recentMsgs }
}

async function llmSummarize(
  head: LLMMessage[],
  provider: { base_url: string; api_key: string },
  model: string,
  previousSummary?: string,
): Promise<string> {
  const convo = serializeForSummary(head)
  const prompt = previousSummary
    ? `Update the anchored summary below using the conversation history above. Preserve still-true details, remove stale details, and merge in new facts.\n<previous-summary>\n${previousSummary}\n</previous-summary>\n\n${SUMMARY_TEMPLATE}\n\n${convo}`
    : `Create a new anchored summary from the conversation history.\n\n${SUMMARY_TEMPLATE}\n\n${convo}`

  let summary = ''
  try {
    for await (const chunk of streamChatCompletion({
      baseUrl: provider.base_url, apiKey: provider.api_key, model,
      messages: [{ role: 'user', content: prompt }],
    })) {
      if (chunk.type === 'delta' && chunk.text) summary += chunk.text
      if (chunk.type === 'error') throw new Error(chunk.text)
    }
  } catch (err: any) {
    console.warn('[summarize] LLM failed, fallback to truncation:', err.message)
    return buildCompactionSummary(head)
  }
  return summary || buildCompactionSummary(head)
}

export function compactHistory(
  messages: LLMMessage[],
  summary: string,
  recent: LLMMessage[],
): LLMMessage[] {
  const sysEnd = systemMessageEnd(messages)
  // Leading system messages pass through byte-identical so the cache prefix
  // stays stable across turns. Superseded [Compacted History] summaries are
  // dropped (only the newest is kept) so the system block does not grow
  // unboundedly across successive compactions.
  const systemMsgs = messages
    .slice(0, sysEnd)
    .filter(m => !(m.role === 'system' && typeof m.content === 'string' && m.content.startsWith('[Compacted History]')))
  const compacted: LLMMessage[] = [...systemMsgs]
  compacted.push({ role: 'system', content: `[Compacted History]\n${summary}` })
  compacted.push(...recent)
  return compacted
}

export function extractPreviousSummary(messages: LLMMessage[]): string | undefined {
  const sysEnd = systemMessageEnd(messages)
  const c = sysEnd < messages.length ? contentToText(messages[sysEnd].content) : ''
  if (sysEnd < messages.length && messages[sysEnd].role === 'system' && c.startsWith('[Compacted History]')) {
    return c.replace('[Compacted History]\n', '')
  }
}

export interface CompactResult {
  messages: LLMMessage[]
  didCompact: boolean
  summary?: string
  recent?: LLMMessage[]
  compactedUntilId?: number
}

export async function selectAndSummarize(
  messages: LLMMessage[],
  provider: { base_url: string; api_key: string },
  model: string,
): Promise<CompactResult> {
  const sysEnd = systemMessageEnd(messages)
  if (sysEnd >= messages.length) return { messages, didCompact: false }

  const conversation = messages.slice(sysEnd)
  const previousSummary = extractPreviousSummary(messages)
  const selected = selectEntries(conversation, KEEP_TOKENS)
  if (!selected || selected.head.length === 0) return { messages, didCompact: false }

  const summary = await llmSummarize(selected.head, provider, model, previousSummary)
  const compacted = compactHistory(messages, summary, selected.recent)

  let compactedUntilId = 0
  for (const m of selected.head) {
    const dbId = (m as any).__dbId
    if (typeof dbId === 'number' && dbId > compactedUntilId) compactedUntilId = dbId
  }

  return { messages: compacted, didCompact: true, summary, recent: selected.recent, compactedUntilId }
}
