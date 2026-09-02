/**
 * Run: npx tsx src/llm/errors.test.ts
 */

import { describeTransportError, isTransientLLMError } from './errors.js'
import { isContextOverflowError } from './client.js'

let passed = 0
let failed = 0

function assert(condition: boolean, label: string) {
  if (condition) {
    passed++
    console.log(`  OK ${label}`)
  } else {
    failed++
    console.error(`  FAIL ${label}`)
  }
}

assert(isTransientLLMError('fetch failed'), 'plain fetch failures are retriable')
assert(isTransientLLMError('fetch failed [UND_ERR_SOCKET: other side closed]'), 'undici socket failures are retriable')
assert(isTransientLLMError('Empty LLM stream response'), 'empty stream bodies are retriable')
assert(isTransientLLMError('connect ETIMEDOUT 203.0.113.1:443'), 'connection timeouts are retriable')
assert(!isTransientLLMError('LLM API 401: invalid token'), 'authentication failures are terminal')
assert(!isTransientLLMError('LLM API 400: malformed request'), 'bad requests are terminal')

const described = describeTransportError({
  message: 'fetch failed',
  cause: { code: 'UND_ERR_SOCKET', message: 'other side closed' },
})
assert(
  described === 'fetch failed [UND_ERR_SOCKET: other side closed]',
  'transport error keeps the low-level cause',
)

// P1-6: 溢出识别归一化 —— 措辞变体 + finish_reason 强信号。
assert(isContextOverflowError('This model\'s maximum context length is 4096 tokens'), 'chat/completions context_length variant')
assert(isContextOverflowError('The request exceeds the maximum context window'), 'context window variant')
assert(isContextOverflowError('Too many tokens in the input message'), 'too many tokens variant')
assert(isContextOverflowError('LLM API 400: context_length_exceeded'), 'error-code-style variant')
assert(isContextOverflowError('anything', 'length'), 'finish_reason=length is a strong signal regardless of text')
assert(isContextOverflowError('anything', 'max_output_tokens'), 'responses max_output_tokens is a strong signal')
assert(!isContextOverflowError('LLM API 401: invalid api key'), 'auth errors are not overflow')
assert(!isContextOverflowError('LLM API 500: internal server error'), 'server errors are not overflow')

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
