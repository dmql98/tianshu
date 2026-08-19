import { apiGet, apiPost, apiPut, apiDelete } from './client'
import type { SessionStats, SessionSummary } from '@/types'
import type { CharacterMotion } from './characters'
import type { RunRow } from './runs'
import type { TrajectoryMessage, TrajectoryEvent, LLMCallTrace } from '@/types'

export const fetchSessions = () => apiGet<SessionSummary[]>('/api/sessions')

/** Aggregated run statistics for the input-bar stats strip. */
export const fetchSessionStats = (sessionId: string) =>
  apiGet<SessionStats>(`/api/sessions/${encodeURIComponent(sessionId)}/stats`)

export interface SessionPresence {
  sessionId: string
  runId: string | null
  motion: CharacterMotion
  since: number
}

export const fetchSessionPresences = () =>
  apiGet<SessionPresence[]>('/api/sessions/presences')

/** 最近普通对话摘要（HOME_PAGE_DEVELOPMENT_PLAN §4.2）：服务端已清洗截断最后消息。 */
export interface RecentSessionSummary extends SessionSummary {
  last_message_preview: string | null
}

/** 拉取最近 N（1..10，默认 3）个普通对话及最后消息摘要。 */
export const fetchRecentSessions = (limit = 3) =>
  apiGet<RecentSessionSummary[]>(`/api/sessions/recent?limit=${limit}`)

export const createSession = (data: Partial<SessionSummary> & { id: string }) =>
  apiPost<SessionSummary>('/api/sessions', data)

export const updateSession = (id: string, data: Partial<SessionSummary>) =>
  apiPut<SessionSummary>(`/api/sessions/${id}`, data)

export const renameSession = (id: string, title: string) =>
  apiPut<SessionSummary>(`/api/sessions/${id}`, { title })

export const generateSessionTitle = (id: string, content: string) =>
  apiPost<{ title: string; applied: boolean }>(`/api/sessions/${id}/generate-title`, { content })

export const deleteSession = (id: string) =>
  apiDelete(`/api/sessions/${id}`)

export const fetchSessionMessages = (id: string) =>
  apiGet<{ session: SessionSummary; messages: any[]; total: number }>(`/api/sessions/${id}/messages`)

/** 丰富会话导出：basic = 会话+消息；full = 追加每次 LLM 调用完整轨迹（llm_calls）。 */
export interface SessionExportData {
  exportedAt: number
  schemaVersion: number
  scope: 'basic' | 'full'
  session: SessionSummary
  messages: any[]
  llmCalls?: Array<{
    sessionId: string
    runId: string | null
    turn: number
    fp: string | null
    request: { model: string; messages: any[]; tools?: any[] }
    response: { text: string; reasoning: string; toolCalls: any[]; usage: any }
    error?: string
  }>
}

export const fetchSessionExport = (id: string, scope: 'basic' | 'full' = 'full') =>
  apiGet<SessionExportData>(`/api/sessions/${encodeURIComponent(id)}/export?scope=${scope}`)

/**
 * 会话级轨迹（对标 deepseek-harness trajectory）：一个会话的完整执行过程——
 * 全部 run、消息时间线、非流式事件日志、每次 LLM 调用的完整请求/响应。
 * 轨迹页直接按会话渲染，不再需要选择 run。
 */
export interface SessionTrajectoryData {
  session: {
    id: string
    title: string
    character_id: string
  }
  runs: RunRow[]
  messages: TrajectoryMessage[]
  events: TrajectoryEvent[]
  llmCalls?: LLMCallTrace[]
}

export const fetchSessionTrajectory = (id: string) =>
  apiGet<SessionTrajectoryData>(`/api/sessions/${encodeURIComponent(id)}/trajectory`)

/** 手动压缩会话上下文：返回压缩前后的 token 估算，didCompact=false 表示无需压缩。 */
export interface CompactSessionResult {
  ok: boolean
  didCompact: boolean
  reason?: string
  summary?: string
  compactedUntilId?: number | null
  tokensBefore?: number
  tokensAfter?: number
  messageCount?: number
}

export const compactSession = (id: string) =>
  apiPost<CompactSessionResult>(`/api/sessions/${id}/compact`)

export const keepMessages = (sessionId: string, count: number) =>
  apiDelete(`/api/sessions/${sessionId}/messages?keep=${count}`)

export const forkSession = (
  sessionId: string,
  data: { id: string; message_id?: number; message_count: number },
) => apiPost<{ session: SessionSummary; messages: any[] }>(`/api/sessions/${sessionId}/fork`, data)

export const fetchChildSessions = (id: string) =>
  apiGet<SessionSummary[]>(`/api/sessions/${id}/children`)

export const reviseMessage = (messageId: number, content: string) =>
  apiPost<{ session_id: string; supersedes_message_id: number; content: string }>(
    `/api/messages/${messageId}/revise`,
    { content },
  )
