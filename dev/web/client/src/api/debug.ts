import { apiGet } from './client'

// ── debug 会话接口类型（GET /api/debug/*，见 web/server/src/routes/debug.ts）──

export interface DebugToolCallMeta {
  name: string
  args_preview: string
}

export interface DebugTurnMeta {
  turn: number
  timestamp: number
  fp: string
  model: string | null
  usage: { input: number; output: number } | null
  error: string | null
  text_len: number
  reasoning_len: number
  tool_calls: DebugToolCallMeta[]
}

export interface DebugFileMeta {
  file: string
  turns: number
  first_ts: number | null
  last_ts: number | null
  fps: string[]
  models: string[]
}

export interface DebugSessionMeta {
  session_id: string
  total_turns: number
  files: DebugFileMeta[]
}

export interface DebugToolCall {
  id?: string
  type?: string
  function?: { name: string; arguments: string }
}

export interface DebugTurnMessage {
  role: string
  content: string | null
  truncated: boolean
  tool_call_id?: string
  tool_calls?: DebugToolCall[]
}

export interface DebugTurnDetail {
  turn: number
  timestamp: number
  fp: string
  model: string | null
  system_prompts: string[]
  messages: DebugTurnMessage[]
  tools: unknown[]
  response: {
    text: string
    reasoning: string
    toolCalls: DebugToolCall[]
    usage: { input: number; output: number } | null
  } | null
  error: string | null
}

export const fetchDebugSessions = () =>
  apiGet<{ sessions: DebugSessionMeta[] }>('/api/debug/sessions')

export const fetchDebugSession = (sessionId: string) =>
  apiGet<{ session_id: string; files: DebugFileMeta[] }>(
    `/api/debug/sessions/${encodeURIComponent(sessionId)}`,
  )

export const fetchDebugTurns = (sessionId: string, file: string) =>
  apiGet<{ session_id: string; file: string; turns: DebugTurnMeta[] }>(
    `/api/debug/sessions/${encodeURIComponent(sessionId)}/turns?file=${encodeURIComponent(file)}`,
  )

export const fetchDebugTurnDetail = (sessionId: string, turn: number, file: string) =>
  apiGet<{ session_id: string; file: string; turn: DebugTurnDetail }>(
    `/api/debug/sessions/${encodeURIComponent(sessionId)}/turn/${turn}?file=${encodeURIComponent(file)}`,
  )
