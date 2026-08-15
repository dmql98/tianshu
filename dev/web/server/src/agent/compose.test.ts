/**
 * Run: npx tsx src/agent/compose.test.ts
 */

import { composeMessages } from './compose.js'

const messages = [
  { role: 'user' as const, content: 'question' },
  { role: 'assistant' as const, content: 'answer', reasoning_content: 'provider reasoning' },
  { role: 'tool' as const, content: '{"output":"ok"}', tool_call_id: 't1' },
]

const thinking = composeMessages(messages, { preserveReasoning: true })
if (thinking[1].reasoning_content !== 'provider reasoning') {
  throw new Error('thinking-mode history must preserve reasoning_content')
}

const regular = composeMessages(messages, { preserveReasoning: false })
if (regular[1].reasoning_content !== undefined) {
  throw new Error('non-thinking history should omit provider-specific reasoning_content')
}

if (messages[1].reasoning_content !== 'provider reasoning') {
  throw new Error('composeMessages must not mutate stored history')
}

// ── Dynamic context is appended as a trailing message ──
const alerts = ['[Policy Plan-first] 当前计划 v1：\n1. [in_progress] 调研', '[System Alert] 注意收敛']
const composed = composeMessages(messages, { systemAlerts: alerts, preserveReasoning: true })
if (composed.length !== messages.length + 1) {
  throw new Error('context alerts must append exactly one trailing message')
}
const tail = composed[composed.length - 1]
if (tail.role !== 'user' || tail.content !== alerts.join('\n')) {
  throw new Error('context alerts must be appended verbatim as a trailing user message')
}

// Mid-history user messages must stay byte-identical (cache stability).
if (composed[0] !== undefined && composed[0].content !== 'question') {
  throw new Error('composeMessages must never rewrite a mid-history user message')
}
if (composed[0] === messages[0]) {
  throw new Error('composeMessages must not alias stored messages (clone expected)')
}

// ── No alerts → no appended context message ──
const none = composeMessages(messages, { systemAlerts: [], preserveReasoning: false })
if (none.length !== messages.length) {
  throw new Error('empty alerts must not append a context message')
}

console.log('  OK context alerts appended as trailing message; history byte-stable')
