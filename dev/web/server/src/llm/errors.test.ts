/**
 * Run: npx tsx src/llm/errors.test.ts
 */

import { describeTransportError, isTransientLLMError } from './errors.js'

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

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
