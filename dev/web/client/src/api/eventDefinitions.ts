import { apiGet, apiPost, apiDelete } from './client'

export interface EventDefinition {
  id: string
  name: string
  type: 'once' | 'cron'
  cron_expr: string | null
  timezone: string
  instruction: string
  character_id: string
  revision_policy: 'follow_latest' | 'pinned'
  pinned_character_revision_id: string | null
  assigned_group: string | null
  provider_id: string | null
  model: string | null
  workspace: string | null
  approval_mode: string
  execution_mode: string
  overlap_policy: 'skip' | 'queue'
  status: 'active' | 'paused' | 'archived'
  next_fire_at: number | null
  created_at: number
  updated_at: number
}

export interface EventOccurrence {
  id: string
  definition_id: string
  trigger_type: 'scheduled' | 'manual' | 'retry'
  scheduled_for: number
  resolved_revision_id: string
  session_id: string | null
  current_run_id: string | null
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'skipped'
  result: string | null
  error: string | null
  created_at: number
  updated_at: number
}

export interface CreateEventDefinitionInput {
  name: string
  type: 'once' | 'cron'
  cron_expr?: string
  timezone?: string
  instruction: string
  character_id: string
  revision_policy?: 'follow_latest' | 'pinned'
  pinned_character_revision_id?: string | null
  assigned_group?: string | null
  provider_id?: string | null
  model?: string | null
  workspace?: string | null
  approval_mode?: string
  execution_mode?: string
  overlap_policy?: 'skip' | 'queue'
}

export const fetchEventDefinitions = () =>
  apiGet<EventDefinition[]>('/api/event-definitions')

export const createEventDefinition = (data: CreateEventDefinitionInput) =>
  apiPost<EventDefinition>('/api/event-definitions', data)

export const fetchEventOccurrences = (definitionId: string) =>
  apiGet<EventOccurrence[]>(`/api/event-definitions/${definitionId}/occurrences`)

export const fireEventDefinition = (definitionId: string) =>
  apiPost<EventOccurrence>(`/api/event-definitions/${definitionId}/fire`)

export const retryEventOccurrence = (occurrenceId: string) =>
  apiPost<EventOccurrence>(`/api/event-definitions/occurrences/${occurrenceId}/retry`)

export const archiveEventDefinition = (definitionId: string) =>
  apiPost<EventDefinition>(`/api/event-definitions/${definitionId}/archive`)

export const restoreEventDefinition = (definitionId: string) =>
  apiPost<EventDefinition>(`/api/event-definitions/${definitionId}/restore`)

export const deleteEventDefinition = (definitionId: string) =>
  apiDelete(`/api/event-definitions/${definitionId}`)
