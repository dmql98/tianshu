export type EventSourceType = 'user' | 'agent' | 'system'
export type EventType = 'once' | 'cron'
export type EventStatus = 'pending' | 'running' | 'completed' | 'failed' | 'archived'

export interface EventPayload {
  instruction: string
}

export interface EventRow {
  id: string
  source_type: EventSourceType
  source_id: string | null
  source_meta: string | null
  assigned_agent_id: string
  assigned_group_id: string | null
  model: string | null
  provider_id: string | null
  workspace: string | null
  type: EventType
  cron_expr: string | null
  payload: string
  status: EventStatus
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
}

export interface CreateEventInput {
  source_type: EventSourceType
  source_id?: string
  source_meta?: Record<string, any>
  assigned_agent_id: string
  assigned_group_id?: string
  model?: string
  provider_id?: string
  workspace?: string
  type: EventType
  cron_expr?: string
  payload: EventPayload
  status?: EventStatus
  priority?: number
  scheduled_at?: number
  parent_event_id?: string
  max_retries?: number
}

export interface TrajectoryRow {
  id: string
  session_id: string
  agent_id: string
  user_goal: string | null
  tool_calls: string | null
  summary: string | null
  success_rate: number | null
  created_at: number
}

export interface CreateTrajectoryInput {
  id: string
  session_id: string
  agent_id: string
  user_goal?: string
  tool_calls?: any[]
  summary?: string
  success_rate?: number
}
