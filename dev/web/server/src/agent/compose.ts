import type { LLMMessage } from '../llm/client.js'

export interface ComposeContext {
  systemAlerts?: string[]
  preserveReasoning?: boolean
}

function lastUserIdx(messages: LLMMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return i
  }
  return -1
}

export function composeMessages(
  messages: LLMMessage[],
  ctx: ComposeContext,
): LLMMessage[] {
  const prepare = ctx.preserveReasoning ? cloneMessage : stripReasoning
  if (!ctx.systemAlerts?.length) return messages.map(prepare)

  const prefix = ctx.systemAlerts.join('\n')
  if (!prefix) return messages.map(prepare)

  const result = messages.map(prepare)
  const idx = lastUserIdx(result)
  if (idx < 0) return result

  const userMsg = { ...result[idx] }
  const existing = userMsg.content
  if (typeof existing === 'string') {
    userMsg.content = prefix + (existing ? '\n\n' + existing : '')
  } else if (Array.isArray(existing)) {
    userMsg.content = [{ type: 'text', text: prefix }, ...existing] as LLMMessage['content']
  } else {
    userMsg.content = prefix
  }
  result[idx] = userMsg
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
