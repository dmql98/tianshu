/**
 * Run: npx tsx src/llm/client-stream.test.ts
 *
 * Regression suite for LLM stream framing. Case msocwg0bciq5x4: a provider
 * stream that ends mid-tool-arguments (socket EOF, no `[DONE]`, no
 * finish_reason) must NOT be treated as a successful completion.
 */

import { streamChatCompletion, type LLMChunk } from './client.js'

const originalFetch = globalThis.fetch

function withSse(body: string, overrides: Partial<ResponseInit> = {}) {
  globalThis.fetch = (async () => new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
    ...overrides,
  })) as typeof fetch
}

async function collect(baseUrl: string, body: string): Promise<LLMChunk[]> {
  const chunks: LLMChunk[] = []
  for await (const c of streamChatCompletion({
    baseUrl,
    apiKey: '',
    model: 'test-model',
    messages: [{ role: 'user', content: 'hi' }],
  })) {
    chunks.push(c)
  }
  return chunks
}

function lastOf(chunks: LLMChunk[]): LLMChunk {
  return chunks[chunks.length - 1]
}

async function run(name: string, fn: () => Promise<void>) {
  try {
    await fn()
    console.log(`  OK ${name}`)
  } catch (err: any) {
    console.error(`  FAIL ${name}: ${err.message}`)
    process.exitCode = 1
  }
}

async function main() {
  await run('normal text stream with [DONE] completes', async () => {
    withSse([
      'data: {"choices":[{"delta":{"content":"hel"}}]}',
      'data: {"choices":[{"delta":{"content":"lo"},"finish_reason":"stop"}]}',
      'data: [DONE]',
      '',
    ].join('\n'))
    const chunks = await collect('https://example.invalid/v1', '')
    const done = lastOf(chunks)
    if (done.type !== 'done' || done.finish_reason !== 'stop') {
      throw new Error(`expected done/stop, got ${JSON.stringify(done)}`)
    }
  })

  await run('normal tool stream with finish_reason + [DONE] completes', async () => {
    withSse([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","type":"function","function":{"name":"read","arguments":"{\\"path\\":"}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"a.txt\\"}"}}]},"finish_reason":"tool_calls"}]}',
      'data: [DONE]',
      '',
    ].join('\n'))
    const chunks = await collect('https://example.invalid/v1', '')
    const args = chunks
      .filter(c => c.type === 'delta' && c.tool_calls)
      .map(c => c.tool_calls![0]?.function.arguments || '')
      .join('')
    if (!args.includes('"a.txt"')) throw new Error(`tool args not accumulated: ${JSON.stringify(args)}`)
    if (lastOf(chunks).type !== 'done') throw new Error('expected done')
  })

  // ── Accident regression: EOF mid-arguments, no [DONE], no finish_reason ──
  await run('EOF mid tool-arguments (no DONE, no finish) yields error not done', async () => {
    withSse([
      'data: {"choices":[{"delta":{"content":"REM "}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","type":"function","function":{"name":"write","arguments":"{\\"content\\":\\"REM ----"}}]}}]}',
      // socket EOF here — no [DONE], no finish_reason
    ].join('\n'))
    const chunks = await collect('https://example.invalid/v1', '')
    const done = lastOf(chunks)
    if (done.type !== 'error') {
      throw new Error(`EOF without terminal marker must yield error, got ${JSON.stringify(done)}`)
    }
  })

  await run('EOF mid text (no DONE, no finish) yields error not done', async () => {
    withSse([
      'data: {"choices":[{"delta":{"content":"half of a sent"}}]}',
      // EOF
    ].join('\n'))
    const chunks = await collect('https://example.invalid/v1', '')
    if (lastOf(chunks).type !== 'error') {
      throw new Error('text EOF without terminal marker must yield error')
    }
  })

  await run('terminal finish reason without [DONE] is treated as complete (compat)', async () => {
    withSse([
      'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}',
      // EOF, no [DONE]
    ].join('\n'))
    const chunks = await collect('https://example.invalid/v1', '')
    const done = lastOf(chunks)
    if (done.type !== 'done') throw new Error('finish_reason stop without [DONE] should complete in compat mode')
  })

  await run('malformed SSE JSON terminates stream with error', async () => {
    withSse([
      'data: {not-json',
      'data: {"choices":[{"delta":{"content":"more"}}]}',
      'data: [DONE]',
      '',
    ].join('\n'))
    const chunks = await collect('https://example.invalid/v1', '')
    const err = chunks.find(c => c.type === 'error')
    if (!err) throw new Error('malformed SSE must yield error')
  })
}

main()
  .catch(err => { console.error(err); process.exitCode = 1 })
  .finally(() => { globalThis.fetch = originalFetch })
