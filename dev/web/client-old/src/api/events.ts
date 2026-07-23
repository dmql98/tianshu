import { apiGet, apiPost, apiPatch, apiDelete } from './client'

export interface EventRecord {
  id: string
  source_type: 'user' | 'agent' | 'system'
  source_id: string | null
  source_meta: string | null
  assigned_agent_id: string
  assigned_group_id: string | null
  model: string | null
  provider_id: string | null
  workspace: string | null
  type: 'once' | 'cron'
  cron_expr: string | null
  payload: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'archived'
  priority: number
  scheduled_at: number | null
  started_at: number | null
  finished_at: number | null
  result_summary: string | null
  error_log: string | null
  parent_event_id: string | null
  retry_count: number
  max_retries: number
  created_at: number
  sessionId?: string
}

export interface CreateEventInput {
  assigned_agent_id: string
  assigned_group_id?: string
  model?: string
  provider_id?: string
  workspace?: string
  type: 'once' | 'cron'
  payload: { instruction: string }
  source_type?: 'user' | 'agent' | 'system'
  cron_expr?: string
  scheduled_at?: number
  priority?: number
}

export const fetchEvents = (params?: { status?: string; source_type?: string; limit?: number; offset?: number }) => {
  const query = new URLSearchParams()
  if (params?.status) query.set('status', params.status)
  if (params?.source_type) query.set('source_type', params.source_type)
  if (params?.limit) query.set('limit', String(params.limit))
  if (params?.offset) query.set('offset', String(params.offset))
  const qs = query.toString()
  return apiGet<EventRecord[]>(`/api/events${qs ? '?' + qs : ''}`)
}

export const fetchEvent = (id: string) => apiGet<EventRecord>(`/api/events/${id}`)
export const createEvent = (data: CreateEventInput) => apiPost<EventRecord>('/api/events', data)
export const updateEventStatus = (id: string, status: string, extra?: Record<string, any>) => apiPatch<EventRecord>(`/api/events/${id}/status`, { status, ...extra })
export const deleteEvent = (id: string) => apiDelete(`/api/events/${id}`)
export const triggerEvent = (id: string) => apiPost<{ ok: true }>(`/api/events/${id}/trigger`)
export const archiveEvent = (id: string) => apiPost<{ ok: true }>(`/api/events/${id}/archive`)
export const archiveOldEvents = (hours = 24) => apiPost<{ ok: true; archived: number }>('/api/events/archive-old', { hours })
