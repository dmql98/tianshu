import { createHash } from 'crypto'
import { getDb } from '../db/schema.js'

/**
 * Per-LLM-call trace store (replaces the file-based debug/merged_N.json logs).
 *
 * One row per LLM call with the complete request snapshot (model + messages +
 * tools as actually sent), the full response, usage, the system-prompt
 * fingerprint and error. This is the single source of truth for the
 * DSH-style "full session trace": the conversation lives in `messages`, the
 * live timeline lives in `run_events`, and `llm_calls` holds the exact
 * input/output of every model request.
 */

function systemPromptFingerprint(messages: unknown[]): string {
  const sysMsg = (messages || []).find(m => (m as any)?.role === 'system')
  if (!sysMsg || typeof (sysMsg as any).content !== 'string') return ''
  const content = (sysMsg as any).content
  // Only hash first 500 chars — enough to detect agent/tool changes
  return createHash('sha256').update(content.slice(0, 500)).digest('hex').slice(0, 12)
}

// Per-session FIFO queue: logLLMCall is fire-and-forget from the run loop. The
// DB insert is async and serialized per session so turn order is preserved and
// the event loop is never blocked (the old synchronous file rewrites stalled
// socket.io heartbeats and caused ping-timeout disconnects).
const queues = new Map<string, Promise<void>>()

function enqueue(sessionId: string, task: () => Promise<void>): void {
  const prev = queues.get(sessionId) || Promise.resolve()
  const next = prev.then(task).catch(() => { /* best-effort: never throw */ })
  queues.set(sessionId, next.then(() => undefined).catch(() => undefined))
}

export interface LLMCallRecord {
  sessionId: string | null
  runId: string | null
  turn: number
  fp: string | null
  request: { model: string; messages: unknown[]; tools?: unknown[] }
  response: {
    text: string
    reasoning: string
    toolCalls: unknown[]
    usage: { input: number; output: number; cacheHit?: number; cacheMiss?: number } | null
  }
  error?: string
}

export function logLLMCall(input: {
  sessionId?: string | null
  runId?: string
  turn: number
  request: LLMCallRecord['request']
  response: LLMCallRecord['response']
  error?: string
}): void {
  const id = input.sessionId || 'unknown'
  const ts = Date.now()
  const fp = systemPromptFingerprint(input.request.messages)
  enqueue(id, async () => {
    try {
      getDb().prepare(`
        INSERT INTO llm_calls (
          session_id, run_id, turn_no, fp,
          request_model, request_messages, request_tools,
          response_text, response_reasoning, response_tool_calls,
          usage_input, usage_output, usage_cache_hit, usage_cache_miss,
          error, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.sessionId || null,
        input.runId || null,
        input.turn,
        fp,
        input.request.model,
        JSON.stringify(input.request.messages),
        input.request.tools ? JSON.stringify(input.request.tools) : null,
        input.response.text,
        input.response.reasoning,
        input.response.toolCalls ? JSON.stringify(input.response.toolCalls) : null,
        input.response.usage?.input ?? 0,
        input.response.usage?.output ?? 0,
        input.response.usage?.cacheHit ?? 0,
        input.response.usage?.cacheMiss ?? 0,
        input.error || null,
        ts,
      )
    } catch { /* best-effort tracing: never throw into the run loop */ }
  })
}

export interface LLMCallRow {
  id: number
  session_id: string
  run_id: string | null
  turn_no: number
  fp: string | null
  request_model: string | null
  request_messages: string
  request_tools: string | null
  response_text: string | null
  response_reasoning: string | null
  response_tool_calls: string | null
  usage_input: number
  usage_output: number
  usage_cache_hit: number
  usage_cache_miss: number
  error: string | null
  created_at: number
}

export function llmCallsForSession(sessionId: string): LLMCallRow[] {
  return getDb().prepare(
    'SELECT * FROM llm_calls WHERE session_id = ? ORDER BY id ASC',
  ).all(sessionId) as LLMCallRow[]
}

export function llmCallsForRun(runId: string): LLMCallRow[] {
  return getDb().prepare(
    'SELECT * FROM llm_calls WHERE run_id = ? ORDER BY id ASC',
  ).all(runId) as LLMCallRow[]
}

/** Session ids that have at least one recorded LLM call. */
export function sessionsWithLLMCalls(): string[] {
  return (getDb().prepare(
    'SELECT DISTINCT session_id FROM llm_calls ORDER BY session_id',
  ).all() as Array<{ session_id: string }>).map(r => r.session_id)
}

/** Decode a stored row back into the structured record shape. */
export function rowToLLMCall(row: LLMCallRow): LLMCallRecord {
  return {
    sessionId: row.session_id,
    runId: row.run_id,
    turn: row.turn_no,
    fp: row.fp,
    request: {
      model: row.request_model || '',
      messages: JSON.parse(row.request_messages || '[]'),
      tools: row.request_tools ? JSON.parse(row.request_tools) : undefined,
    },
    response: {
      text: row.response_text || '',
      reasoning: row.response_reasoning || '',
      toolCalls: row.response_tool_calls ? JSON.parse(row.response_tool_calls) : [],
      usage: {
        input: row.usage_input,
        output: row.usage_output,
        cacheHit: row.usage_cache_hit,
        cacheMiss: row.usage_cache_miss,
      },
    },
    error: row.error || undefined,
  }
}
