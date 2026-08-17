import { streamChatCompletion, type LLMMessage, type LLMOptions, type ProviderConfig } from '../../llm/client.js'
import { providerStore } from '../../db/providerStore.js'
import {
  contentToText, systemMessageEnd, estimateTextTokens, estimateTokens,
  DEFAULT_CONTEXT_WINDOW, DEFAULT_COMPACT_POLICY, MAX_COMPACT_ATTEMPTS,
  resolveKeepTokens, shouldCompactTokens, type CompactPolicy,
} from './loop-policy.js'

/**
 * Context compactor: summarization, history selection and compaction.
 * Migrated from agent/outer.ts.
 */

export const SUMMARY_OUTPUT_TOKENS = 2048

/** 摘要长度保险（P2-7）：LLM 输出的摘要超过该 token 上限时按节截断。 */
export const COMPACT_SUMMARY_CAP = 2048

/** 硬约束：压缩只能作用于 system 块之后的对话，system 前缀逐字节保留。 */
const COMPACTED_PREFIX = '[Compacted History]'
const isCompactedSummary = (m: LLMMessage) =>
  m.role === 'system' && typeof m.content === 'string' && m.content.startsWith(COMPACTED_PREFIX)

// P0-3: 摘要调用默认复用会话前缀（system + tools + 消息），把压缩指令作为
// 最后一条 user 消息，让辅助调用成为主请求的真实前缀以复用 provider KV cache。
// 通道不支持长前缀时设 TSS_COMPACT_REPLAY_PREFIX=0 回退到旧的独立 prompt。
const REPLAY_PREFIX = process.env.TSS_COMPACT_REPLAY_PREFIX !== '0'

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
    total += estimateTextTokens(serialized[i].text)
    if (total > tokenBudget) { split = i + 1; break }
    split = i
  }

  if (split === 0) return

  // P0-2: 平衡切点保护。token 预算选出的切点可能切断 tool call/result 配对，
  // 向左扩张 recent 直到 recent 内部自洽且边界不跨配对。
  split = repairSplitForPairs(serialized, split)
  if (split === 0) return

  const recentMsgs = serialized.slice(split).map(e => e.msg)
  const headMsgs = serialized.slice(0, split).map(e => e.msg)

  return { head: headMsgs, recent: recentMsgs }
}

function callIdsOf(m: LLMMessage): string[] {
  if (m.role !== 'assistant' || !m.tool_calls) return []
  return m.tool_calls.filter(tc => tc.id).map(tc => tc.id!)
}

/**
 * 把 cut 向左扩张，直到满足：
 * - recent 内每个 tool 结果都有其 assistant(tool_calls) 调用；
 * - recent 内每个 assistant 调用都有其 tool 结果；
 * - 紧邻 cut 左侧的 head 最后一条消息不能是调用落在 recent 里的 assistant(tool_calls)。
 *
 * 历史数据里无法配对的「永久孤儿」调用/结果（整段会话都不存在对方）按中性处理，
 * 避免它们让整段会话都进 recent 而永远无法压缩。
 */
export function repairSplitForPairs(
  serialized: Array<{ msg: LLMMessage }>,
  split: number,
): number {
  // 永久孤儿集合：全量会话中不存在配对的 id。
  const allResults = new Set<string>()
  const allCalls = new Set<string>()
  for (const { msg } of serialized) {
    if (msg.role === 'tool' && msg.tool_call_id) allResults.add(msg.tool_call_id)
    for (const id of callIdsOf(msg)) allCalls.add(id)
  }

  while (split < serialized.length) {
    const results = new Set<string>()
    const calls = new Set<string>()
    for (let i = split; i < serialized.length; i++) {
      const m = serialized[i].msg
      if (m.role === 'tool' && m.tool_call_id && allCalls.has(m.tool_call_id)) {
        results.add(m.tool_call_id)
      }
      for (const id of callIdsOf(m)) {
        if (allResults.has(id)) calls.add(id)
      }
    }
    // 每个可配对的结果在 recent 内有其调用；每个可配对的调用在 recent 内有其结果。
    const resultsCovered = [...results].every(id => calls.has(id))
    const callsCovered = [...calls].every(id => results.has(id))
    // 紧邻左侧 head 的最后一条调用不得把结果落在 recent。
    let crossing = false
    if (split > 0) {
      const prev = serialized[split - 1].msg
      if (prev.role === 'assistant' && prev.tool_calls) {
        for (const id of callIdsOf(prev)) {
          if (results.has(id)) { crossing = true; break }
        }
      }
    }
    if (resultsCovered && callsCovered && !crossing) return split
    split -= 1
  }
  return 0
}

/** 摘要指令：前缀复用模式下作为会话尾部唯一的 user 消息（P0-3）。 */
function compactionInstruction(previousSummary?: string): string {
  return previousSummary
    ? `Update the anchored summary below using the conversation history above. Preserve still-true details, remove stale details, and merge in new facts.\n<previous-summary>\n${previousSummary}\n</previous-summary>\n\n${SUMMARY_TEMPLATE}`
    : `Create a new anchored summary from the conversation history.\n\n${SUMMARY_TEMPLATE}`
}

export interface SummarizeOptions {
  /** 主请求的 tools，用于 prefix 对齐（复用 KV cache）。 */
  tools?: LLMOptions['tools']
  /** 压缩保留预算（P0-1 重试时逐级递减）；缺省按 contextWindow×retainRatio。 */
  keepTokens?: number
  /** 上下文窗口（P1-3 保留预算缩放用）；缺省 DEFAULT_CONTEXT_WINDOW。 */
  contextWindow?: number
  /** 模型级压缩策略（P1-4）。 */
  policy?: CompactPolicy
  /** 独立摘要 provider id（P1-4 模型级策略 / P1-5 环境变量）。 */
  summarizationProviderId?: string
  /** 独立摘要模型名。 */
  summarizationModel?: string
  /** 直接指定摘要 provider（优先于 id 解析）。 */
  summarizationProvider?: ProviderConfig
}

/** 解析摘要调用目标：显式 provider > 环境变量 TSS_COMPACT_PROVIDER/MODEL > 主链路。 */
function resolveSummarizerTarget(
  provider: ProviderConfig,
  model: string,
  opts?: SummarizeOptions,
): { provider: ProviderConfig; model: string } {
  if (opts?.summarizationProvider) {
    return { provider: opts.summarizationProvider, model: opts.summarizationModel || model }
  }
  const providerId = opts?.summarizationProviderId || process.env.TSS_COMPACT_PROVIDER || ''
  const modelName = opts?.summarizationModel || process.env.TSS_COMPACT_MODEL || ''
  if (providerId) {
    const sp = providerStore.getById(providerId)
    if (sp) {
      return {
        provider: { ...sp, api_style: sp.api_style },
        model: modelName || sp.models[0]?.id || model,
      }
    }
  }
  if (modelName) return { provider, model: modelName }
  return { provider, model }
}

/** 摘要长度保险：按行保留完整节标题，超出 COMPACT_SUMMARY_CAP 后截断并标注。 */
export function capSummaryLength(summary: string): string {
  const total = estimateTextTokens(summary)
  if (total <= COMPACT_SUMMARY_CAP) return summary
  let out = ''
  let acc = 0
  for (const line of summary.split('\n')) {
    const t = estimateTextTokens(line) + 1
    if (acc + t > COMPACT_SUMMARY_CAP) break
    out += line + '\n'
    acc += t
  }
  return (out.trimEnd() || summary.slice(0, Math.max(0, Math.floor(COMPACT_SUMMARY_CAP * 4)))) + '\n(truncated)'
}

async function llmSummarize(
  head: LLMMessage[],
  systemMsgs: LLMMessage[],
  provider: ProviderConfig,
  model: string,
  previousSummary?: string,
  opts?: SummarizeOptions,
): Promise<string> {
  const instruction = compactionInstruction(previousSummary)
  const target = resolveSummarizerTarget(provider, model, opts)
  const messages: LLMMessage[] = REPLAY_PREFIX
    ? [...systemMsgs, ...head, { role: 'user', content: instruction }]
    : [{ role: 'user', content: `${instruction}\n\n${serializeForSummary(head)}` }]

  let summary = ''
  try {
    for await (const chunk of streamChatCompletion({
      baseUrl: target.provider.base_url, apiKey: target.provider.api_key, model: target.model,
      apiStyle: target.provider.api_style,
      messages,
      tools: opts?.tools,
      // P1-5: 摘要输出上限，防摘要无限膨胀。
      max_tokens: SUMMARY_OUTPUT_TOKENS,
    })) {
      if (chunk.type === 'delta' && chunk.text) summary += chunk.text
      if (chunk.type === 'error') throw new Error(chunk.text)
    }
  } catch (err: any) {
    console.warn('[summarize] LLM failed, fallback to truncation:', err.message)
    return buildCompactionSummary(head)
  }
  return capSummaryLength(summary) || buildCompactionSummary(head)
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
  /** 压缩后确实小于原上下文（收缩保证）。 */
  shrinkVerified?: boolean
  reason?: 'nothing_to_select' | 'system_prompt_modified' | 'not_smaller'
  tokensBefore?: number
  tokensAfter?: number
}

export async function selectAndSummarize(
  messages: LLMMessage[],
  provider: ProviderConfig,
  model: string,
  opts?: SummarizeOptions,
): Promise<CompactResult> {
  const sysEnd = systemMessageEnd(messages)
  if (sysEnd >= messages.length) return { messages, didCompact: false }

  const contextWindow = opts?.contextWindow ?? DEFAULT_CONTEXT_WINDOW
  const policy = opts?.policy ?? DEFAULT_COMPACT_POLICY
  const budget = opts?.keepTokens ?? resolveKeepTokens(contextWindow, 0, policy)

  const conversation = messages.slice(sysEnd)
  const previousSummary = extractPreviousSummary(messages)
  const selected = selectEntries(conversation, budget)
  if (!selected || selected.head.length === 0) return { messages, didCompact: false }

  const systemMsgs = messages.slice(0, sysEnd)
  const summary = await llmSummarize(selected.head, systemMsgs, provider, model, previousSummary, opts)
  const compacted = compactHistory(messages, summary, selected.recent)

  const tokensBefore = estimateTokens(messages)
  const tokensAfter = estimateTokens(compacted)

  // 硬约束断言：初始 system prompt 必须逐字节原样保留。压缩只作用于
  // system 之后的对话；若未来改动破坏该结构，立即判为无效压缩。
  const cSysEnd = systemMessageEnd(compacted)
  const sysBefore = JSON.stringify(messages.slice(0, sysEnd).filter(m => !isCompactedSummary(m)))
  const sysAfter = JSON.stringify(compacted.slice(0, cSysEnd).filter(m => !isCompactedSummary(m)))
  if (sysBefore !== sysAfter) {
    console.error('[compact] system prompt was modified — compaction aborted')
    return { messages, didCompact: false, reason: 'system_prompt_modified' }
  }

  // 收缩保证：摘要 + recent 必须严格小于被压缩的完整上下文，否则视为无效压缩
  // （摘要模型失控 / recent 尾部过大时压缩形同虚设，必须显式失败而非假装成功）。
  if (tokensAfter >= tokensBefore) {
    return { messages, didCompact: false, reason: 'not_smaller', tokensBefore, tokensAfter }
  }

  let compactedUntilId = 0
  for (const m of selected.head) {
    const dbId = (m as any).__dbId
    if (typeof dbId === 'number' && dbId > compactedUntilId) compactedUntilId = dbId
  }

  return { messages: compacted, didCompact: true, summary, recent: selected.recent, compactedUntilId, shrinkVerified: true }
}

export interface CompactRetryResult {
  didCompact: boolean
  summary?: string
  compactedUntilId?: number
  /** 实际发生的压缩次数（含重试）。 */
  attempts: number
}

/**
 * 带收缩重试的压缩（P0-1）：成功后用压缩后的新上下文重测，仍超阈值则
 * 降低保留预算再压一次（最多 MAX_COMPACT_ATTEMPTS 次），对齐
 * deepseek-harness 的 compactionRetries。**就地替换 messages**（与现有调用
 * 约定一致）。系统提示词永远不被压缩。
 */
export async function compactWithRetries(
  messages: LLMMessage[],
  provider: ProviderConfig,
  model: string,
  opts?: SummarizeOptions,
): Promise<CompactRetryResult> {
  const contextWindow = opts?.contextWindow ?? DEFAULT_CONTEXT_WINDOW
  const policy = opts?.policy ?? DEFAULT_COMPACT_POLICY
  let attempts = 0
  let summary: string | undefined
  let compactedUntilId: number | undefined

  while (attempts <= MAX_COMPACT_ATTEMPTS) {
    const keepTokens = resolveKeepTokens(contextWindow, attempts, policy)
    const result = await selectAndSummarize(messages, provider, model, { ...opts, keepTokens })
    if (!result.didCompact) break
    messages.length = 0
    messages.push(...result.messages)
    attempts++
    summary = result.summary
    compactedUntilId = result.compactedUntilId
    if (!shouldCompactTokens(estimateTokens(messages), contextWindow, policy)) break
  }

  return { didCompact: attempts > 0, summary, compactedUntilId, attempts }
}
