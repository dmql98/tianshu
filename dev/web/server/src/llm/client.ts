import { describeTransportError, IncompleteLLMStreamError, MalformedSSEError } from './errors.js'

// Toggle streaming usage info. Some providers (proxies) may handle
// include_usage differently and affect prefix caching. Disable to probe.
const INCLUDE_USAGE = process.env.LLM_INCLUDE_USAGE !== 'false'

// Strict stream completion protocol: EOF without [DONE] or a terminal
// finish_reason is treated as an incomplete stream (transient, retryable)
// instead of a successful turn. Default on; set STRICT_LLM_STREAM_COMPLETION=0
// to restore the lenient behaviour.
const STRICT_STREAM = process.env.STRICT_LLM_STREAM_COMPLETION !== '0'

// finish_reason values that mean the model turn genuinely ended, even if the
// provider never emits an explicit `data: [DONE]` marker. Used by the compat
// terminal policy below.
const TERMINAL_FINISH_REASONS = new Set(['stop', 'tool_calls', 'length', 'content_filter', 'function_call', 'end_turn'])

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null | import('../agent/attachments.js').ProviderContentBlock[]
  reasoning_content?: string
  tool_calls?: ToolCall[]
  tool_call_id?: string
}

export interface ToolCall {
  id: string
  index?: number
  type: 'function'
  function: { name: string; arguments: string }
}

export interface LLMUsage {
  input_tokens: number
  output_tokens: number
  cache_hit_tokens?: number
  cache_miss_tokens?: number
}

export interface LLMChunk {
  type: 'delta' | 'done' | 'error' | 'usage'
  text?: string
  reasoning?: string
  finish_reason?: string
  usage?: LLMUsage
  usage_type?: 'stream' | 'final'
  tool_calls?: ToolCall[]
  /** Present on `done`: how the stream reached its terminal state. */
  completion?: StreamCompletion
}

/** How a provider stream reached its end — callers must not infer success
 *  from the absence of an error chunk. */
export interface StreamCompletion {
  finishReason?: string
  sawDoneMarker: boolean
  compatibleTerminal: boolean
}

export interface LLMOptions {
  baseUrl: string
  apiKey: string
  model: string
  messages: LLMMessage[]
  tools?: Array<{
    type: 'function'
    function: {
      name: string
      description: string
      parameters: Record<string, unknown>
    }
  }>
  thinking?: boolean
  reasoning_effort?: string
  signal?: AbortSignal
  onChunk?: (chunk: LLMChunk) => void
}

function parseUsage(raw: any): LLMUsage {
  const usage: LLMUsage = {
    input_tokens: raw?.prompt_tokens || raw?.input_tokens || 0,
    output_tokens: raw?.completion_tokens || raw?.output_tokens || 0,
  }
  if (typeof raw?.prompt_cache_hit_tokens === 'number') usage.cache_hit_tokens = raw.prompt_cache_hit_tokens
  if (typeof raw?.prompt_cache_miss_tokens === 'number') usage.cache_miss_tokens = raw.prompt_cache_miss_tokens
  if (raw?.prompt_tokens_details?.cached_tokens != null) usage.cache_hit_tokens = raw.prompt_tokens_details.cached_tokens
  if (usage.cache_hit_tokens !== undefined && usage.cache_miss_tokens === undefined) {
    usage.cache_miss_tokens = Math.max(0, usage.input_tokens - usage.cache_hit_tokens)
  }
  return usage
}

export async function* streamChatCompletion(opts: LLMOptions): AsyncGenerator<LLMChunk> {
  const { baseUrl, apiKey, model, messages, tools, thinking, reasoning_effort, signal } = opts
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`
  const body: Record<string, unknown> = {
    model, messages, stream: true,
    ...(INCLUDE_USAGE ? { stream_options: { include_usage: true } } : {}),
  }
  if (tools && tools.length > 0) body.tools = tools
  if (thinking) {
    body.thinking = { type: 'enabled' }
    if (reasoning_effort) body.reasoning_effort = reasoning_effort
  }

  // ── Stream framing state ──
  let reader: any = null
  let finishReason: string | undefined
  let sawFinishReason = false
  let sawDoneMarker = false
  let latestUsage: LLMUsage | undefined
  let sawAnyData = false

  const onAbort = () => { reader?.cancel().catch(() => {}) }
  signal?.addEventListener('abort', onAbort, { once: true })

  const emitDone = (compatibleTerminal: boolean): LLMChunk => ({
    type: 'done', finish_reason: finishReason, usage: latestUsage,
    completion: { finishReason, sawDoneMarker, compatibleTerminal },
  })

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal,
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      yield { type: 'error', text: `LLM API ${res.status}: ${text}` }
      return
    }

    reader = res.body?.getReader()
    if (!reader) { yield { type: 'error', text: 'No response body' }; return }
    const decoder = new TextDecoder()
    let buffer = ''
    // ── Idle timeout ──
    // A provider that stops sending bytes (connection hang) must not block the
    // run forever: fail with a transient error so streamWithRetry can retry.
    const IDLE_TIMEOUT_MS = 60_000
    let idleTimer: ReturnType<typeof setTimeout> | undefined
    const clearIdle = () => {
      if (idleTimer) { clearTimeout(idleTimer); idleTimer = undefined }
    }
    const readWithIdleTimeout = (): Promise<ReadableStreamReadResult<Uint8Array>> => {
      clearIdle()
      const readPromise = reader!.read()
      const timeoutPromise = new Promise<never>((_, reject) => {
        idleTimer = setTimeout(() => {
          reader?.cancel().catch(() => {})
          reject(new Error('LLM stream idle timeout (no data for 60s)'))
        }, IDLE_TIMEOUT_MS)
      })
      return Promise.race([readPromise, timeoutPromise])
    }
    try {
      while (true) {
        if (signal?.aborted) return
        const { done, value } = await readWithIdleTimeout()
        clearIdle()
        if (signal?.aborted) return
      if (done) {
        // Flush the decoder so any trailing multibyte sequence is decoded, and
        // process every complete SSE line. `decoder.decode()` (final call) no
        // longer streams, so there is no pending partial line to defer.
        buffer += decoder.decode()
        for (const line of buffer.split('\n')) {
          const trimmed = line.trim()
          if (!trimmed || !trimmed.startsWith('data: ')) continue
          const data = trimmed.slice(6)
          if (data === '[DONE]') { sawDoneMarker = true; continue }
          let parsed: any
          try { parsed = JSON.parse(data) } catch (err: any) {
            throw new MalformedSSEError(String(err?.message || err))
          }
          sawAnyData = true
          for (const chunk of handleDataChunk(parsed)) yield chunk
        }
        break
      }
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith('data: ')) continue
        const data = trimmed.slice(6)
        if (data === '[DONE]') {
          sawDoneMarker = true
          yield emitDone(false)
          return
        }
        let parsed: any
        try { parsed = JSON.parse(data) } catch (err: any) {
          // A `data:` payload that fails JSON.parse can still carry tool-call
          // deltas. Silently skipping (old behaviour) can drop the tail of a
          // tool call; fail the stream instead.
          throw new MalformedSSEError(String(err?.message || err))
        }
        sawAnyData = true
        for (const chunk of handleDataChunk(parsed)) yield chunk
      }
    }
    } finally { clearIdle() }
  } catch (err: any) {
    if (err.name === 'AbortError' || signal?.aborted) return
    const errorText = describeTransportError(err)
    let host = 'unknown'
    try { host = new URL(url).host } catch {}
    console.error(`[llm] request failed host=${host}: ${errorText}`)
    yield { type: 'error', text: errorText }
    return
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }

  // ── EOF reached. Decide whether the turn completed. ──
  if (sawDoneMarker) {
    yield emitDone(false)
    return
  }
  if (sawFinishReason && TERMINAL_FINISH_REASONS.has(finishReason || '')) {
    // Some OpenAI-compatible providers end the stream without `[DONE]` but
    // still send a terminal finish_reason on the last delta. Accept it in
    // compat mode but record that it wasn't a clean marker.
    yield emitDone(true)
    return
  }
  if (!STRICT_STREAM) {
    // Legacy lenient behaviour: EOF counts as completion regardless of
    // terminal markers. Kept behind a flag for rollback.
    yield emitDone(true)
    return
  }
  if (!sawAnyData) {
    // Empty body with no data at all — transport-level failure.
    yield { type: 'error', text: 'Empty LLM stream response' }
    return
  }
  // EOF with data but no terminal marker: the stream was cut mid-response.
  // Treat as an incomplete stream (retry), never as success.
  const detail = `EOF without [DONE] or terminal finish_reason` +
    (finishReason ? ` (finish_reason=${finishReason})` : '')
  yield { type: 'error', text: new IncompleteLLMStreamError(detail).message }
  return

  function handleDataChunk(parsed: any): LLMChunk[] {
    const chunks: LLMChunk[] = []
    const choices = parsed.choices
    const hasDelta = choices?.[0]?.delta
    const finish = choices?.[0]?.finish_reason

    // Usage-only chunks (streaming intermediate usage info)
    if (parsed.usage && !hasDelta) {
      latestUsage = parseUsage(parsed.usage)
      chunks.push({ type: 'usage', usage: latestUsage, usage_type: finishReason || finish ? 'final' : 'stream' })
    }

    const delta = hasDelta || {}
    if (delta.reasoning_content) {
      chunks.push({ type: 'delta', reasoning: delta.reasoning_content })
    }
    if (delta.content) {
      chunks.push({ type: 'delta', text: delta.content })
    }
    if (delta.tool_calls) {
      chunks.push({
        type: 'delta',
        tool_calls: delta.tool_calls.map((tc: any) => ({
          id: tc.id || '',
          index: tc.index,
          type: 'function' as const,
          function: { name: tc.function?.name || '', arguments: tc.function?.arguments || '' },
        })),
      })
    }
    if (finish) {
      finishReason = finish
      sawFinishReason = true
      if (parsed.usage) latestUsage = parseUsage(parsed.usage)
    }
    return chunks
  }
}
