import { apiGet, apiPost, apiPut, apiDelete } from './client'

export interface SessionSummary {
  id: string; character_id: string; title: string
  model: string | null; provider_id: string | null; workspace: string | null
  workspaces: string | null
  parent_id: string | null; active_group: string | null
  session_type?: 'chat' | 'event'; event_id?: string | null
  current_strategy?: 'Plan' | 'Ask' | 'Bypass'
  context_window?: number | null
  created_at: number; updated_at: number
}

export interface SessionDetail {
  id: string; character_id: string; title: string
  model: string | null; provider_id: string | null; workspace: string | null
  workspaces: string | null
  parent_id: string | null; active_group: string | null
  session_type?: 'chat' | 'event'; event_id?: string | null
  input_tokens: number; output_tokens: number
  created_at: number; updated_at: number
}
export interface MessageDetail {
  id: number; session_id: string; role: string; content: string
  tool_name: string | null; tool_input: string | null
  tool_output: string | null; tool_status: string | null
  created_at: number
}

export const fetchSessions = () => apiGet<SessionSummary[]>('/api/sessions')
export const createSession = (data: Partial<SessionSummary> & { id: string }) => apiPost<SessionSummary>('/api/sessions', data)
export const updateSession = (id: string, data: Partial<SessionSummary>) => apiPut<SessionSummary>(`/api/sessions/${id}`, data)
export const renameSession = (id: string, title: string) => apiPut<SessionSummary>(`/api/sessions/${id}`, { title })
export const deleteSession = (id: string) => apiDelete(`/api/sessions/${id}`)
export const fetchSessionMessages = (id: string) => apiGet<{ session: SessionSummary; messages: any[]; total: number }>(`/api/sessions/${id}/messages`)
export const keepMessages = (sessionId: string, count: number) => apiDelete(`/api/sessions/${sessionId}/messages?keep=${count}`)
export const fetchChildSessions = (id: string) => apiGet<SessionSummary[]>(`/api/sessions/${id}/children`)
