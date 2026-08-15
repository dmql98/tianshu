import type { LLMMessage } from '../llm/client.js'

export interface ComposeContext {
  systemAlerts?: string[]
  preserveReasoning?: boolean
}

/**
 * Compose the per-turn dynamic context (plan / goal / runtime alerts) into the
 * provider request.
 *
 * Cache rule: provider prefix caching matches the request on the exact
 * byte-prefix. The dynamic context is therefore appended as a TRAILING user
 * message — never merged into a mid-history user message — so the entire
 * conversation history stays byte-stable across turns and only this small tail
 * becomes a cache miss each turn. The context message is intentionally NOT
 * persisted into the master history (the caller only sends it).
 */
export function composeMessages(
  messages: LLMMessage[],
  ctx: ComposeContext,
): LLMMessage[] {
  const prepare = ctx.preserveReasoning ? cloneMessage : stripReasoning
  const result = messages.map(prepare)
  if (!ctx.systemAlerts?.length) return result

  const prefix = ctx.systemAlerts.join('\n')
  if (!prefix) return result

  result.push({ role: 'user', content: prefix })
  return result
}

function cloneMessage(m: LLMMessage): LLMMessage {
  const msg = { ...m }
  // DeepSeek-style reasoning APIs require the `reasoning_content` field on
  // EVERY assistant message once thinking mode is active — including turns
  // where the model produced no reasoning (null). Omitting the field (even
  // when empty) makes the upstream reject with "The reasoning_content in the
  // thinking mode must be passed back to the API."
  if (msg.role === 'assistant' && msg.reasoning_content == null) {
    msg.reasoning_content = ''
  }
  return msg
}

function stripReasoning(m: LLMMessage): LLMMessage {
  if (!m.reasoning_content) return m
  const msg = { ...m }
  delete msg.reasoning_content
  return msg
}
