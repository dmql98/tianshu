/**
 * Run: npx tsx src/llm/client-responses.test.ts
 *
 * Regression suite for the OpenAI Responses API (/v1/responses) streaming
 * path, focused on tool-call assembly.
 *
 * Accident: some providers (LM Studio / llama.cpp) do NOT stream
 * `function_call_arguments.delta`; they deliver the full arguments on
 * `output_item.done` (or on `function_call_arguments.done`). The old code
 * emitted only the delta-accumulated arguments, so such providers produced
 * EMPTY tool-call arguments, which `normalizeToolCalls` then rejected as
 * invalid JSON — breaking every tool turn while chat/completions stayed fine.
 */

import { streamChatCompletion, type LLMChunk } from './client.js'

function withSse(body: string) {
  globalThis.fetch = (async () => new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })) as typeof fetch
}

async function collect(body: string): Promise<LLMChunk[]> {
  const chunks: LLMChunk[] = []
  for await (const c of streamChatCompletion({
    baseUrl: 'https://example.invalid/v1',
    apiKey: '',
    model: 'test-model',
    messages: [{ role: 'user', content: 'hi' }],
    apiStyle: 'responses',
  })) {
    chunks.push(c)
  }
  return chunks
}

function toolCallsOf(chunks: LLMChunk[]) {
  return chunks.filter(c => c.type === 'delta' && c.tool_calls).flatMap(c => c.tool_calls || [])
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
  // ── Regression: full arguments only on output_item.done (no deltas) ──
  await run('full args on output_item.done (no deltas) yield complete tool call', async () => {
    withSse([
      'data: {"type":"response.output_item.added","item":{"id":"fc_1","type":"function_call","call_id":"call_1","name":"read_file","arguments":""}}',
      'data: {"type":"response.output_item.done","item":{"id":"fc_1","type":"function_call","call_id":"call_1","name":"read_file","arguments":"{\\"path\\":\\"a.txt\\"}"}}',
      'data: {"type":"response.completed","response":{"status":"completed","output":[{"type":"function_call"}],"usage":{"input_tokens":1,"output_tokens":1}}}',
      '',
    ].join('\n'))
    const chunks = await collect('')
    const calls = toolCallsOf(chunks)
    if (calls.length !== 1) throw new Error(`expected 1 tool call, got ${calls.length}`)
    if (calls[0].function.name !== 'read_file') throw new Error(`name wrong: ${calls[0].function.name}`)
    if (calls[0].function.arguments !== '{"path":"a.txt"}') {
      throw new Error(`arguments empty/malformed: ${JSON.stringify(calls[0].function.arguments)}`)
    }
  })

  // ── Full args via function_call_arguments.done (no deltas) ──
  await run('full args on function_call_arguments.done (no deltas) yield complete tool call', async () => {
    withSse([
      'data: {"type":"response.output_item.added","item":{"id":"fc_2","type":"function_call","call_id":"call_2","name":"write","arguments":""}}',
      'data: {"type":"response.function_call_arguments.done","item_id":"fc_2","arguments":"{\\"content\\":\\"hi\\",\\"path\\":\\"b.txt\\"}"}',
      'data: {"type":"response.output_item.done","item":{"id":"fc_2","type":"function_call","call_id":"call_2","name":"write","arguments":"{\\"content\\":\\"hi\\",\\"path\\":\\"b.txt\\"}"}}',
      'data: {"type":"response.completed","response":{"status":"completed","output":[{"type":"function_call"}],"usage":{"input_tokens":1,"output_tokens":1}}}',
      '',
    ].join('\n'))
    const chunks = await collect('')
    const calls = toolCallsOf(chunks)
    const args = calls[0]?.function.arguments || ''
    if (!args.includes('"b.txt"') || !args.includes('"hi"')) {
      throw new Error(`arguments incomplete: ${JSON.stringify(args)}`)
    }
  })

  // ── Delta accumulation + done still works (OpenAI reference behavior) ──
  await run('delta accumulation + done (OpenAI style) yields complete tool call', async () => {
    withSse([
      'data: {"type":"response.output_item.added","item":{"id":"fc_3","type":"function_call","call_id":"call_3","name":"read","arguments":""}}',
      'data: {"type":"response.function_call_arguments.delta","item_id":"fc_3","delta":"{\\"path\\":"}',
      'data: {"type":"response.function_call_arguments.delta","item_id":"fc_3","delta":"\\"c.txt\\"}"}',
      'data: {"type":"response.output_item.done","item":{"id":"fc_3","type":"function_call","call_id":"call_3","name":"read","arguments":"{\\"path\\":\\"c.txt\\"}"}}',
      'data: {"type":"response.completed","response":{"status":"completed","output":[{"type":"function_call"}],"usage":{"input_tokens":1,"output_tokens":1}}}',
      '',
    ].join('\n'))
    const chunks = await collect('')
    const calls = toolCallsOf(chunks)
    const args = calls[0]?.function.arguments || ''
    if (!args.includes('"c.txt"')) throw new Error(`arguments incomplete: ${JSON.stringify(args)}`)
    if (lastOf(chunks).type !== 'done') throw new Error('expected done chunk')
    const done = lastOf(chunks)
    if (done.finish_reason !== 'tool_calls') {
      throw new Error(`expected finish_reason tool_calls, got ${done.finish_reason}`)
    }
  })

  // ── Multiple function calls in one response ──
  await run('multiple function calls are all emitted', async () => {
    withSse([
      'data: {"type":"response.output_item.added","item":{"id":"fc_4","type":"function_call","call_id":"call_4","name":"read","arguments":""}}',
      'data: {"type":"response.output_item.done","item":{"id":"fc_4","type":"function_call","call_id":"call_4","name":"read","arguments":"{\\"path\\":\\"d.txt\\"}"}}',
      'data: {"type":"response.output_item.added","item":{"id":"fc_5","type":"function_call","call_id":"call_5","name":"write","arguments":""}}',
      'data: {"type":"response.output_item.done","item":{"id":"fc_5","type":"function_call","call_id":"call_5","name":"write","arguments":"{\\"content\\":\\"x\\"}"}}',
      'data: {"type":"response.completed","response":{"status":"completed","output":[{"type":"function_call"},{"type":"function_call"}],"usage":{"input_tokens":1,"output_tokens":1}}}',
      '',
    ].join('\n'))
    const chunks = await collect('')
    const calls = toolCallsOf(chunks)
    if (calls.length !== 2) throw new Error(`expected 2 tool calls, got ${calls.length}`)
    if (calls[0].id !== 'call_4' || calls[1].id !== 'call_5') {
      throw new Error(`ids wrong: ${JSON.stringify(calls.map(c => c.id))}`)
    }
  })

  // ── Pure text response still completes with finish_reason stop ──
  await run('text-only response completes with stop', async () => {
    withSse([
      'data: {"type":"response.output_text.delta","delta":"hel"}',
      'data: {"type":"response.output_text.delta","delta":"lo"}',
      'data: {"type":"response.completed","response":{"status":"completed","output":[],"usage":{"input_tokens":1,"output_tokens":1}}}',
      '',
    ].join('\n'))
    const chunks = await collect('')
    const text = chunks.filter(c => c.type === 'delta' && c.text).map(c => c.text).join('')
    if (text !== 'hello') throw new Error(`text wrong: ${JSON.stringify(text)}`)
    const done = lastOf(chunks)
    if (done.type !== 'done' || done.finish_reason !== 'stop') {
      throw new Error(`expected done/stop, got ${JSON.stringify(done)}`)
    }
  })
}

main().then(() => {
  if (process.exitCode) process.exit(process.exitCode)
})