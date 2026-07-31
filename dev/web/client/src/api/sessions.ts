import { apiGet, apiPost, apiPut, apiDelete } from './client'
import type { SessionSummary } from '@/types'

export const fetchSessions = () => apiGet<SessionSummary[]>('/api/sessions')

export const createSession = (data: Partial<SessionSummary> & { id: string }) =>
  apiPost<SessionSummary>('/api/sessions', data)

export const updateSession = (id: string, data: Partial<SessionSummary>) =>
  apiPut<SessionSummary>(`/api/sessions/${id}`, data)

export const renameSession = (id: string, title: string) =>
  apiPut<SessionSummary>(`/api/sessions/${id}`, { title })

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
