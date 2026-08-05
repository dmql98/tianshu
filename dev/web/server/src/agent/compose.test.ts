/**
 * Run: npx tsx src/agent/compose.test.ts
 */

import { composeMessages } from './compose.js'

const messages = [
  { role: 'user' as const, content: 'question' },
  { role: 'assistant' as const, content: 'answer', reasoning_content: 'provider reasoning' },
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

console.log('  OK reasoning history follows provider thinking mode without mutating stored messages')
