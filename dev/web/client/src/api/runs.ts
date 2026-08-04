import { apiGet, apiPost } from './client'
import type { RunEvent } from '@/types'

export interface RunRow {
  id: string
  session_id: string
  turn_id: string | null
  parent_run_id: string | null
  resumed_from_run_id: string | null
  character_id: string
  character_revision_id: string
  source: string
  status: string
  phase: string
  approval_mode: string
  execution_mode: string
  turn_no: number
  max_turns: number
  queued_at: number
  started_at: number | null
  finished_at: number | null
  updated_at: number
}

export const fetchRecentRuns = (sessionId: string, limit = 10) =>
  apiGet<RunRow[]>(`/api/runs?session_id=${encodeURIComponent(sessionId)}&limit=${limit}`)

export const fetchRunEvents = (runId: string, afterSeq: number) =>
  apiGet<RunEvent[]>(`/api/runs/${runId}/events?after_seq=${afterSeq}`)

export const submitRunInput = (runId: string, answer: string) =>
  apiPost<{ run_id: string; status: string }>(`/api/runs/${runId}/inputs`, { answer })

export const cancelRun = (runId: string) =>
  apiPost<{ cancelled: boolean }>(`/api/runs/${runId}/cancel`)
