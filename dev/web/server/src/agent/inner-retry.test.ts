/**
 * Run: npx tsx src/agent/inner-retry.test.ts
 */

import { streamWithRetry } from './inner.js'

const originalFetch = globalThis.fetch
let fetchCalls = 0
const retries: Array<{ attempt: number; max_attempts: number; error: string; delay_ms: number }> = []

globalThis.fetch = (async () => {
  fetchCalls++
  if (fetchCalls === 1) {
    const err = new TypeError('fetch failed') as TypeError & { cause?: unknown }
    err.cause = { code: 'UND_ERR_SOCKET', message: 'other side closed' }
    throw err
  }

  const body = [
    'data: {"choices":[{"delta":{"content":"recovered"},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":1}}',
    '',
    '',
  ].join('\n')
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}) as typeof fetch

try {
  const result = await streamWithRetry(
    [{ role: 'user', content: 'test' }],
    undefined,
    { base_url: 'https://example.invalid/v1', api_key: '' },
    'test-model',
    undefined,
    {},
    undefined,
    retry => retries.push(retry),
  )

  if (fetchCalls !== 2) throw new Error(`expected 2 fetch calls, got ${fetchCalls}`)
  if (retries.length !== 1) throw new Error(`expected 1 retry event, got ${retries.length}`)
  if (retries[0].attempt !== 2 || retries[0].max_attempts !== 3) {
    throw new Error(`unexpected retry metadata: ${JSON.stringify(retries[0])}`)
  }
  if (result.text !== 'recovered') throw new Error(`unexpected result: ${JSON.stringify(result)}`)
  console.log('  OK transient fetch failure retries and recovers')
} finally {
  globalThis.fetch = originalFetch
}
