/**
 * Run: npx tsx src/agent/inner-retry.test.ts
 */

import { streamWithRetry, MAX_LLM_STREAM_ATTEMPTS, MAX_CONCURRENCY_ATTEMPTS, CONCURRENCY_BACKOFF_MS, CONCURRENCY_MAX_BACKOFF_MS } from './inner.js'

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

// ── 429 rate limit: longer backoff + Retry-After header ──
// 429 errors must use the extended retry budget (MAX_429_ATTEMPTS) and the
// longer 5s → 10s → 20s → 30s backoff instead of the normal 1s → 2s.
// When the provider sends a Retry-After header, that value is used directly.
async function rateLimitBackoff() {
  const originalFetch4 = globalThis.fetch
  let fetchCalls4 = 0
  const retries4: Array<{ attempt: number; max_attempts: number; error: string; delay_ms: number }> = []
  const delays: number[] = []

  globalThis.fetch = (async () => {
    fetchCalls4++
    if (fetchCalls4 <= 3) {
      // First 3 attempts: 429 with Retry-After: 2
      return new Response('{"error":{"code":"RateLimitExceeded"}}', {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': '2' },
      })
    }
    // 4th attempt: success
    const body = [
      'data: {"choices":[{"delta":{"content":"rate limit recovered"},"finish_reason":"stop"}]}',
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
      r => { retries4.push(r); delays.push(r.delay_ms) },
    )
    if (fetchCalls4 !== 4) throw new Error(`expected 4 fetch calls, got ${fetchCalls4}`)
    if (retries4.length !== 3) throw new Error(`expected 3 retry events, got ${retries4.length}`)
    // All retries should report max_attempts = MAX_429_ATTEMPTS (not MAX_LLM_STREAM_ATTEMPTS)
    for (const r of retries4) {
      if (r.max_attempts < MAX_LLM_STREAM_ATTEMPTS) {
        throw new Error(`429 retry should use extended budget: ${JSON.stringify(r)}`)
      }
    }
    // Delays should come from Retry-After header (2000ms = 2s)
    for (const d of delays) {
      if (d !== 2000) throw new Error(`expected Retry-After delay 2000ms, got ${d}`)
    }
    if (result.text !== 'rate limit recovered') {
      throw new Error(`unexpected result: ${JSON.stringify(result.text)}`)
    }
    console.log('  OK 429 rate limit uses Retry-After header and extended retry budget')
  } finally {
    globalThis.fetch = originalFetch4
  }
}

await rateLimitBackoff()

// ── 429 without Retry-After: exponential backoff 5s → 10s → 20s ──
async function rateLimitBackoffNoHeader() {
  const originalFetch5 = globalThis.fetch
  let fetchCalls5 = 0
  const delays5: number[] = []

  globalThis.fetch = (async () => {
    fetchCalls5++
    if (fetchCalls5 <= 2) {
      return new Response('{"error":{"message":"too many requests"}}', {
        status: 429,
        headers: { 'Content-Type': 'application/json' }, // no Retry-After
      })
    }
    const body = [
      'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}',
      'data: [DONE]',
      '',
    ].join('\n')
    return new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    })
  }) as typeof fetch

  try {
    await streamWithRetry(
      [{ role: 'user', content: 'test' }],
      undefined,
      { base_url: 'https://example.invalid/v1', api_key: '', api_style: 'chat_completions' },
      'test-model',
      undefined,
      {},
      undefined,
      r => { delays5.push(r.delay_ms) },
    )
    if (fetchCalls5 !== 3) throw new Error(`expected 3 fetch calls, got ${fetchCalls5}`)
    if (delays5.length !== 2) throw new Error(`expected 2 retries, got ${delays5.length}`)
    // Without Retry-After: 5s → 10s
    if (delays5[0] !== 5000) throw new Error(`expected 5000ms delay, got ${delays5[0]}`)
    if (delays5[1] !== 10000) throw new Error(`expected 10000ms delay, got ${delays5[1]}`)
    console.log('  OK 429 without Retry-After uses 5s→10s exponential backoff')
  } finally {
    globalThis.fetch = originalFetch5
  }
}

await rateLimitBackoffNoHeader()

// ── Model concurrency limit 429 (DeepSeek V4 Flash pattern) ──
// "Model 'DeepSeek-V4-Flash' is at its concurrency limit (64); please retry
// later or use another model" must use the dedicated concurrency budget
// (MAX_CONCURRENCY_ATTEMPTS) with a longer backoff (15s → 30s → … capped at
// 60s) instead of the plain 429 budget, and still recover when the limit clears.
async function concurrencyLimitBackoff() {
  const originalFetch6 = globalThis.fetch
  let fetchCalls6 = 0
  const retries6: Array<{ attempt: number; max_attempts: number; error: string; delay_ms: number }> = []

  globalThis.fetch = (async () => {
    fetchCalls6++
    if (fetchCalls6 <= 2) {
      return new Response(
        '{"error":{"message":"Model \'DeepSeek-V4-Flash\' is at its concurrency limit (64); please retry later or use another model","type":"rate_limit_error","code":"model_concurrency_rate_limit_exceeded"}}',
        { status: 429, headers: { 'Content-Type': 'application/json' } }, // no Retry-After
      )
    }
    const body = [
      'data: {"choices":[{"delta":{"content":"concurrency recovered"},"finish_reason":"stop"}]}',
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
      'deepseek-v4-flash',
      undefined,
      {},
      undefined,
      r => retries6.push(r),
    )
    if (fetchCalls6 !== 3) throw new Error(`expected 3 fetch calls, got ${fetchCalls6}`)
    if (retries6.length !== 2) throw new Error(`expected 2 retries, got ${retries6.length}`)
    // Must use the dedicated concurrency budget (wider than plain 429).
    for (const r of retries6) {
      if (r.max_attempts !== MAX_CONCURRENCY_ATTEMPTS) {
        throw new Error(`concurrency retry should use dedicated budget: ${JSON.stringify(r)}`)
      }
    }
    // No Retry-After: 15s → 30s backoff (capped at 60s on later attempts).
    if (retries6[0].delay_ms !== CONCURRENCY_BACKOFF_MS) {
      throw new Error(`expected first concurrency delay ${CONCURRENCY_BACKOFF_MS}ms, got ${retries6[0].delay_ms}`)
    }
    if (retries6[1].delay_ms !== Math.min(CONCURRENCY_BACKOFF_MS * 2, CONCURRENCY_MAX_BACKOFF_MS)) {
      throw new Error(`expected second concurrency delay ${Math.min(CONCURRENCY_BACKOFF_MS * 2, CONCURRENCY_MAX_BACKOFF_MS)}ms, got ${retries6[1].delay_ms}`)
    }
    if (result.text !== 'concurrency recovered') {
      throw new Error(`unexpected result: ${JSON.stringify(result.text)}`)
    }
    console.log('  OK model concurrency limit 429 uses dedicated longer backoff budget')
  } finally {
    globalThis.fetch = originalFetch6
  }
}

await concurrencyLimitBackoff()
