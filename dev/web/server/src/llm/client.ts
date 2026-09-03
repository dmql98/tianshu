import { randomUUID } from 'crypto'
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

/**
 * 归一化"输入超上下文窗口"判定（P1-6，对齐 deepseek-harness 的
 * CONTEXT_WINDOW_EXCEEDED_CODE 思路）。调用方不要再各自字符串匹配——
 * 错误措辞一变即失效；finish_reason 是强信号，文本匹配作兜底。
 */
export function isContextOverflowError(message: string, finishReason?: string): boolean {
  if (finishReason === 'length' || finishReason === 'max_output_tokens') return true
  const m = message.toLowerCase()
  return m.includes('context length')
    || m.includes('maximum context')
    || m.includes('context_length')
    || m.includes('context window')
    || m.includes('too many tokens')
    || m.includes('input tokens exceeds')
    || m.includes('token limit')
}

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

/** Provider API surface: chat/completions vs the OpenAI Responses API. */
export type ProviderApiStyle = 'auto' | 'chat_completions' | 'responses'

/**
 * 每请求级头模板：配置里允许用 `${session}` / `${request}` 占位，
 * 每次请求替换为随机值——模拟真实客户端指纹（如 opencode 免费档的
 * x-opencode-session/request），规避按固定 session 指纹的限流。
 */
export function resolveHeaderTemplates(headers?: Record<string, string>): Record<string, string> | undefined {
  if (!headers) return headers
  let hasTemplate = false
  for (const v of Object.values(headers)) {
    if (v.includes('${session}') || v.includes('${request}')) { hasTemplate = true; break }
  }
  if (!hasTemplate) return headers
  const session = `ses_${randomUUID().replace(/-/g, '')}`
  const request = `msg_${randomUUID().replace(/-/g, '')}`
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) {
    out[k] = v.replace(/\$\{session\}/g, session).replace(/\$\{request\}/g, request)
  }
  return out
}

/** The provider slice threaded through the agent loop (matches ProviderRecord). */
export interface ProviderConfig {
  base_url: string
  api_key: string
  api_style?: ProviderApiStyle
  /** 附加请求头（如 opencode 免费档的客户端指纹头），原样透传。 */
  headers?: Record<string, string>
}

// ── Auto protocol detection ────────────────────────────────────────────────
// Decision criterion is NOT the provider name but "which API reports prompt
// cache hits": chat/completions (prompt_cache_hit_tokens / prompt_tokens_details
// .cached_tokens) vs Responses API (input_tokens_details.cached_tokens). LM
// Studio / llama.cpp only report cache hits through /v1/responses, so auto
// probes it once per base URL and remembers the decision for the process.
const protocolDecisions = new Map<string, 'chat_completions' | 'responses'>()

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '')
}

/** Probe whether /v1/responses reports cache-hit tokens. One cheap non-stream
 *  request (1 output token). False on any failure / missing field. */
export async function probeResponsesApi(baseUrl: string, apiKey: string, model: string, headers?: Record<string, string>): Promise<boolean> {
  try {
    const res = await fetch(`${normalizeBaseUrl(baseUrl)}/responses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}),
        ...(resolveHeaderTemplates(headers) || {}),
      },
      body: JSON.stringify({
        model,
        instructions: 'Reply with the single token "ok".',
        input: 'hi',
        stream: false,
        max_output_tokens: 1,
      }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return false
    const body = await res.json()
    return typeof body?.usage?.input_tokens_details?.cached_tokens === 'number'
  } catch {
    return false
  }
}

/** Resolve the effective protocol for an auto-configured provider (cached). */
async function resolveApiStyle(opts: LLMOptions): Promise<'chat_completions' | 'responses'> {
  const key = normalizeBaseUrl(opts.baseUrl)
  const decided = protocolDecisions.get(key)
  if (decided) return decided
  const decidedStyle = await probeResponsesApi(opts.baseUrl, opts.apiKey, opts.model, opts.headers)
    ? 'responses' as const
    : 'chat_completions' as const
  protocolDecisions.set(key, decidedStyle)
  return decidedStyle
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
  /** 429 限流时从 Retry-After 头提取的建议等待毫秒数，供上层退避使用。 */
  retryAfterMs?: number
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
  /** 附加请求头（provider 级自定义，如 opencode 免费档指纹头）。 */
  headers?: Record<string, string>
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
  /** Provider API protocol. Defaults to chat/completions. */
  apiStyle?: ProviderApiStyle
  /** 输出 token 上限（P1-5：摘要等辅助调用用；不设置则不携带）。 */
  max_tokens?: number
}

/** 从 HTTP 响应中提取 Retry-After 头（秒），返回毫秒。仅处理数字格式，返回 undefined 表示无/无效。 */
function parseRetryAfter(res: Response): number | undefined {
  const raw = res.headers.get('retry-after')
  if (!raw) return undefined
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return undefined
  return Math.round(n * 1000)
}

function parseUsage(raw: any): LLMUsage {
  const usage: LLMUsage = {
    input_tokens: raw?.prompt_tokens || raw?.input_tokens || 0,
    output_tokens: raw?.completion_tokens || raw?.output_tokens || 0,
  }
  if (typeof raw?.prompt_cache_hit_tokens === 'number') usage.cache_hit_tokens = raw.prompt_cache_hit_tokens
  if (typeof raw?.prompt_cache_miss_tokens === 'number') usage.cache_miss_tokens = raw.prompt_cache_miss_tokens
  if (raw?.prompt_tokens_details?.cached_tokens != null) usage.cache_hit_tokens = raw.prompt_tokens_details.cached_tokens
  // OpenAI Responses API: cached prompt tokens live under input_tokens_details.
  if (raw?.input_tokens_details?.cached_tokens != null) usage.cache_hit_tokens = raw.input_tokens_details.cached_tokens
  if (usage.cache_hit_tokens !== undefined && usage.cache_miss_tokens === undefined) {
    usage.cache_miss_tokens = Math.max(0, usage.input_tokens - usage.cache_hit_tokens)
  }
  return usage
}

export async function* streamChatCompletion(opts: LLMOptions): AsyncGenerator<LLMChunk> {
  if (opts.apiStyle === 'responses') {
    yield* streamResponses(opts)
    return
  }
  if (opts.apiStyle === 'auto' || opts.apiStyle === undefined) {
    const decided = await resolveApiStyle(opts)
    if (decided === 'responses') {
      yield* streamResponses(opts)
      return
    }
    // decided === 'chat_completions': fall through to the default path below.
  }
  const { baseUrl, apiKey, model, messages, tools, thinking, reasoning_effort, signal } = opts
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`
  const body: Record<string, unknown> = {
    model, messages, stream: true,
    ...(INCLUDE_USAGE ? { stream_options: { include_usage: true } } : {}),
    ...(opts.max_tokens != null ? { max_tokens: opts.max_tokens } : {}),
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
        ...(resolveHeaderTemplates(opts.headers) || {}),
      },
      body: JSON.stringify(body),
      signal,
    })

    if (!res.ok) {
      const retryAfterMs = parseRetryAfter(res)
      const text = await res.text().catch(() => '')
      yield { type: 'error', text: `LLM API ${res.status}: ${text}`, ...(retryAfterMs != null ? { retryAfterMs } : {}) }
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

// ── OpenAI Responses API (/v1/responses) ──────────────────────────────────
// Some providers (e.g. LM Studio / llama.cpp) expose prompt-cache hit tokens
// only through the Responses API (`usage.input_tokens_details.cached_tokens`),
// not through chat/completions. Stream events are mapped to the same LLMChunk
// contract so the rest of the agent loop is protocol-agnostic.

function responsesText(m: LLMMessage): string {
  if (m.content == null) return ''
  if (typeof m.content === 'string') return m.content
  return m.content
    .map(p => ('text' in p ? p.text || '' : '[media attachment]'))
    .join('\n')
}

/** Convert agent LLMMessage[] into Responses API `input` items. */
function toResponsesInput(messages: LLMMessage[]): unknown[] {
  const items: unknown[] = []
  for (const m of messages) {
    if (m.role === 'system') continue
    if (m.role === 'tool') {
      items.push({
        type: 'function_call_output',
        call_id: m.tool_call_id || `call_${items.length}`,
        output: responsesText(m),
      })
      continue
    }
    if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
      for (const tc of m.tool_calls) {
        items.push({
          type: 'function_call',
          call_id: tc.id || `call_${items.length}`,
          name: tc.function.name,
          arguments: tc.function.arguments || '{}',
        })
      }
      continue
    }
    const text = responsesText(m)
    if (!text) continue
    // Responses API: user messages carry `input_text` parts; assistant
    // messages carry `output_text` parts. Using the wrong part type makes the
    // provider reject the whole `input` union (LM Studio 400 invalid_union).
    items.push({
      type: 'message',
      role: m.role,
      content: [{ type: m.role === 'assistant' ? 'output_text' : 'input_text', text }],
    })
  }
  return items
}

async function* streamResponses(opts: LLMOptions): AsyncGenerator<LLMChunk> {
  const { baseUrl, apiKey, model, messages, tools, thinking, reasoning_effort, signal } = opts
  const url = `${baseUrl.replace(/\/+$/, '')}/responses`

  const instructions = messages
    .filter(m => m.role === 'system')
    .map(m => responsesText(m))
    .filter(Boolean)
    .join('\n\n')

  const body: Record<string, unknown> = {
    model,
    instructions: instructions || undefined,
    input: toResponsesInput(messages),
    stream: true,
    stream_options: INCLUDE_USAGE ? { include_usage: true } : undefined,
    ...(opts.max_tokens != null ? { max_output_tokens: opts.max_tokens } : {}),
  }
  if (tools && tools.length > 0) {
    // Responses API expects flat function tools ({type,name,description,
    // parameters}); chat/completions wraps them under a `function` key.
    body.tools = tools.map(t => ({
      type: 'function' as const,
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters,
    }))
  }
  if (thinking) {
    body.reasoning = { effort: reasoning_effort || 'medium' }
  }

  let finishReason: string | undefined
  let latestUsage: LLMUsage | undefined

  const onAbort = () => { reader?.cancel().catch(() => {}) }
  let reader: any = null
  signal?.addEventListener('abort', onAbort, { once: true })

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}),
        ...(resolveHeaderTemplates(opts.headers) || {}),
      },
      body: JSON.stringify(body),
      signal,
    })

    if (!res.ok) {
      const retryAfterMs = parseRetryAfter(res)
      const text = await res.text().catch(() => '')
      yield { type: 'error', text: `LLM API ${res.status}: ${text}`, ...(retryAfterMs != null ? { retryAfterMs } : {}) }
      return
    }

    reader = res.body?.getReader()
    if (!reader) { yield { type: 'error', text: 'No response body' }; return }
    const decoder = new TextDecoder()
    let buffer = ''
    // Tool-call assembly state (streamed as delta events).
    const toolCallState = new Map<string, { name: string; arguments: string }>()

    while (true) {
      if (signal?.aborted) return
      const { done, value } = await reader.read()
      if (signal?.aborted) return
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith('data:')) continue
        const payload = trimmed.slice(5).trim()
        if (!payload || payload === '[DONE]') continue
        let ev: any
        try { ev = JSON.parse(payload) } catch { continue }
        if (!ev.type) continue

        if (ev.type === 'response.output_text.delta') {
          yield { type: 'delta', text: ev.delta || '' }
        } else if (ev.type === 'response.reasoning_text.delta') {
          yield { type: 'delta', reasoning: ev.delta || '' }
        } else if (ev.type === 'response.output_item.added' && ev.item?.type === 'function_call') {
          // Key on item.id (fc_...): function_call_arguments.delta/done reference
          // it via item_id. item.call_id (call_...) is a DIFFERENT id.
          toolCallState.set(ev.item.id, {
            name: ev.item.name || '',
            arguments: ev.item.arguments || '',
          })
        } else if (ev.type === 'response.function_call_arguments.delta') {
          const st = toolCallState.get(ev.item_id) || { name: '', arguments: '' }
          st.arguments += ev.delta || ''
          toolCallState.set(ev.item_id, st)
        } else if (ev.type === 'response.function_call_arguments.done') {
          // Some providers deliver the FULL accumulated arguments here instead
          // of streaming deltas; the done payload is authoritative.
          const st = toolCallState.get(ev.item_id) || { name: '', arguments: '' }
          if (typeof ev.arguments === 'string') st.arguments = ev.arguments
          toolCallState.set(ev.item_id, st)
        } else if (ev.type === 'response.output_item.done' && ev.item?.type === 'function_call') {
          // Prefer the authoritative full arguments on the done item. Delta
          // accumulation can be empty for providers that only send arguments
          // via function_call_arguments.done, or none at all.
          const st = toolCallState.get(ev.item.id) || { name: '', arguments: '' }
          yield {
            type: 'delta',
            tool_calls: [{
              id: ev.item.call_id || ev.item.id || '',
              type: 'function' as const,
              function: {
                name: st.name || ev.item.name || '',
                arguments: ev.item.arguments || st.arguments,
              },
            }],
          }
          toolCallState.delete(ev.item.id)
        } else if (ev.type === 'response.completed') {
          const r = ev.response
          if (r?.usage) latestUsage = parseUsage(r.usage)
          const sawToolCalls = toolCallState.size > 0
            || (Array.isArray(r?.output) && r.output.some((o: any) => o.type === 'function_call'))
          finishReason = r?.status === 'completed'
            ? (r?.incomplete_details?.reason || (sawToolCalls ? 'tool_calls' : 'stop'))
            : 'length'
          yield { type: 'usage', usage: latestUsage!, usage_type: 'final' }
          yield {
            type: 'done',
            finish_reason: finishReason,
            usage: latestUsage,
            completion: { finishReason, sawDoneMarker: false, compatibleTerminal: true },
          }
          return
        } else if (ev.type === 'error') {
          yield { type: 'error', text: ev.message || JSON.stringify(ev) }
          return
        }
      }
    }

    // EOF without response.completed: treat as incomplete (retryable).
    if (finishReason) {
      yield {
        type: 'done',
        finish_reason: finishReason,
        usage: latestUsage,
        completion: { finishReason, sawDoneMarker: false, compatibleTerminal: true },
      }
    } else {
      yield { type: 'error', text: new IncompleteLLMStreamError('EOF before response.completed').message }
    }
  } catch (err: any) {
    if (err.name === 'AbortError' || signal?.aborted) return
    const errorText = describeTransportError(err)
    let host = 'unknown'
    try { host = new URL(url).host } catch {}
    console.error(`[llm] responses request failed host=${host}: ${errorText}`)
    yield { type: 'error', text: errorText }
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
}
