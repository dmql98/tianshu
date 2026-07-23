// Toggle streaming usage info. Some providers (proxies) may handle
// include_usage differently and affect prefix caching. Disable to probe.
const INCLUDE_USAGE = process.env.LLM_INCLUDE_USAGE !== 'false'

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

  let reader: any = null
  const onAbort = () => { reader?.cancel().catch(() => {}) }
  signal?.addEventListener('abort', onAbort, { once: true })

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
        if (!trimmed || !trimmed.startsWith('data: ')) continue
        const data = trimmed.slice(6)
        if (data === '[DONE]') { yield { type: 'done' }; return }

        try {
          const parsed = JSON.parse(data)
          const choices = parsed.choices
          const hasDelta = choices?.[0]?.delta
          const finish = choices?.[0]?.finish_reason

          // Usage-only chunks (streaming intermediate usage info)
          if (parsed.usage && !hasDelta) {
            const u = parsed.usage
            const usage: LLMUsage = {
              input_tokens: u.prompt_tokens || u.input_tokens || 0,
              output_tokens: u.completion_tokens || u.output_tokens || 0,
            }
            if (typeof u.prompt_cache_hit_tokens === 'number') usage.cache_hit_tokens = u.prompt_cache_hit_tokens
            if (typeof u.prompt_cache_miss_tokens === 'number') usage.cache_miss_tokens = u.prompt_cache_miss_tokens
            if (u.prompt_tokens_details?.cached_tokens != null) usage.cache_hit_tokens = u.prompt_tokens_details.cached_tokens
            yield { type: 'usage', usage, usage_type: finish ? 'final' : 'stream' }
          }

          const delta = hasDelta || {}
          if (delta.reasoning_content) {
            yield { type: 'delta', reasoning: delta.reasoning_content }
          }
          if (delta.content) {
            yield { type: 'delta', text: delta.content }
          }
          if (delta.tool_calls) {
            yield { type: 'delta', tool_calls: delta.tool_calls.map((tc: any) => ({
              id: tc.id || '',
              index: tc.index,
              type: 'function' as const,
              function: { name: tc.function?.name || '', arguments: tc.function?.arguments || '' },
            }))}
          }
          if (finish) {
            const u = parsed.usage
            let usage: LLMUsage | undefined
            if (u) {
              usage = {
                input_tokens: u.prompt_tokens || u.input_tokens || 0,
                output_tokens: u.completion_tokens || u.output_tokens || 0,
              }
              if (typeof u.prompt_cache_hit_tokens === 'number') {
                usage.cache_hit_tokens = u.prompt_cache_hit_tokens
              }
              if (typeof u.prompt_cache_miss_tokens === 'number') {
                usage.cache_miss_tokens = u.prompt_cache_miss_tokens
              }
              if (u.prompt_tokens_details?.cached_tokens != null) {
                usage.cache_hit_tokens = u.prompt_tokens_details.cached_tokens
              }
            }
            yield { type: 'done', finish_reason: finish, usage }
            return
          }
        } catch { /* skip malformed SSE lines */ }
      }
    }
  } catch (err: any) {
    if (err.name === 'AbortError' || signal?.aborted) return
    yield { type: 'error', text: err.message }
    return
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
  yield { type: 'done' }
}
