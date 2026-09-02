/**
 * Run: npx tsx src/agent/inner-retry.test.ts
 */

import { streamWithRetry, MAX_LLM_STREAM_ATTEMPTS } from './inner.js'

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
    'data: {"choices":[{"delta":{"content":"recovered"},"finish_reason":"stop"}]}',
    'data: {"choices":[],"usage":{"prompt_tokens":30,"completion_tokens":4,"prompt_tokens_details":{"cached_tokens":20}}}',
    'data: [DONE]',
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
    // api_style 固定为 chat_completions：auto 会对 base_url 先探测 /responses，
    // 探测会吃掉第一条 fetch mock（transient 失败），导致 retry 断言失效。
    { base_url: 'https://example.invalid/v1', api_key: '', api_style: 'chat_completions' },
    'test-model',
    undefined,
    {},
    undefined,
    retry => retries.push(retry),
  )

  if (fetchCalls !== 2) throw new Error(`expected 2 fetch calls, got ${fetchCalls}`)
  if (retries.length !== 1) throw new Error(`expected 1 retry event, got ${retries.length}`)
  if (retries[0].attempt !== 2 || retries[0].max_attempts !== MAX_LLM_STREAM_ATTEMPTS) {
    throw new Error(`unexpected retry metadata: ${JSON.stringify(retries[0])}`)
  }
  if (result.text !== 'recovered') throw new Error(`unexpected result: ${JSON.stringify(result)}`)
  if (result.usage?.input !== 30 || result.usage?.output !== 4) {
    throw new Error(`trailing usage chunk was not captured: ${JSON.stringify(result.usage)}`)
  }
  if (result.usage.cacheHit !== 20 || result.usage.cacheMiss !== 10) {
    throw new Error(`cache usage was not captured: ${JSON.stringify(result.usage)}`)
  }
  console.log('  OK transient fetch failure retries and recovers')
} finally {
  globalThis.fetch = originalFetch
}

// ── Attempt isolation: first attempt ends mid-text (EOF, no [DONE]) ──
// Retry must produce a clean result that does not contain the first attempt's
// partial text or its half-built tool arguments (msocwg0bciq5x4 pattern).
async function attemptIsolation() {
  const originalFetch2 = globalThis.fetch
  let fetchCalls2 = 0
  const retries2: Array<{ attempt: number }> = []

  globalThis.fetch = (async () => {
    fetchCalls2++
    if (fetchCalls2 === 1) {
      // First attempt: partial text + truncated tool args, then socket EOF.
      const body = [
        'data: {"choices":[{"delta":{"content":"PARTIAL "}}]}',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","type":"function","function":{"name":"write","arguments":"{\\"content\\":\\"half"}}]}}]}',
        '', // EOF — no [DONE], no finish_reason
      ].join('\n')
      return new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }
    // Second attempt: clean complete response.
    const body = [
      'data: {"choices":[{"delta":{"content":"FULL ANSWER"},"finish_reason":"stop"}]}',
      'data: [DONE]',
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
      { base_url: 'https://example.invalid/v1', api_key: '', api_style: 'chat_completions' },
      'test-model',
      undefined,
      {},
      undefined,
      r => retries2.push(r),
    )
    if (fetchCalls2 !== 2) throw new Error(`expected 2 fetch calls, got ${fetchCalls2}`)
    if (retries2.length !== 1) throw new Error(`expected 1 retry, got ${retries2.length}`)
    if (result.text !== 'FULL ANSWER') throw new Error(`partial text leaked: ${JSON.stringify(result.text)}`)
    if (result.text.includes('PARTIAL')) throw new Error(`first attempt text leaked into result`)
    if (result.toolCalls.length !== 0) throw new Error(`half-built tool call leaked: ${JSON.stringify(result.toolCalls)}`)
    console.log('  OK incomplete stream retries with attempt isolation (no residue)')
  } finally {
    globalThis.fetch = originalFetch2
  }
}

await attemptIsolation()

// ── Empty LLM stream response must retry (was: terminal) ──
// HTTP 200 with a body that closes before any `data:` line (proxy / socket
// cut right after headers) previously failed the run on the first attempt —
// 'Empty LLM stream response' was missing from isTransientLLMError. It must
// retry like any other transport-level failure.
async function emptyStreamRecovers() {
  const originalFetch3 = globalThis.fetch
  let fetchCalls3 = 0
  const retries3: Array<{ attempt: number; max_attempts: number; error: string }> = []

  globalThis.fetch = (async () => {
    fetchCalls3++
    if (fetchCalls3 === 1) {
      // Empty body: HTTP 200, EOF immediately, zero `data:` lines.
      return new Response('', {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }
    const body = [
      'data: {"choices":[{"delta":{"content":"recovered from empty stream"},"finish_reason":"stop"}]}',
      'data: [DONE]',
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
      { base_url: 'https://example.invalid/v1', api_key: '', api_style: 'chat_completions' },
      'test-model',
      undefined,
      {},
      undefined,
      r => retries3.push(r),
    )
    if (fetchCalls3 !== 2) throw new Error(`expected 2 fetch calls, got ${fetchCalls3}`)
    if (retries3.length !== 1) throw new Error(`expected 1 retry, got ${retries3.length}`)
    if (retries3[0].error !== 'Empty LLM stream response') {
      throw new Error(`unexpected retry error: ${JSON.stringify(retries3[0].error)}`)
    }
    if (result.text !== 'recovered from empty stream') {
      throw new Error(`unexpected result: ${JSON.stringify(result)}`)
    }
    console.log('  OK empty stream response retries and recovers')
  } finally {
    globalThis.fetch = originalFetch3
  }
}

await emptyStreamRecovers()
