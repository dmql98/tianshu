import { apiGet, apiPost, apiPut, apiDelete } from './client'
import type { SessionSummary } from '@/types'

export const fetchSessions = () => apiGet<SessionSummary[]>('/api/sessions')

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
