import { apiGet, apiPost, apiPatch } from './client'

export interface Goal {
  id: string
  session_id: string
  outcome: string
  constraints: string | null
  verification: string | null
  budget_tokens: number | null
  used_input_tokens: number
  used_output_tokens: number
  status: 'active' | 'paused' | 'completed' | 'failed' | 'cancelled'
  wake_condition: string | null
  current_run_id: string | null
  created_at: number
  updated_at: number
}

export interface PlanStep {
  id: string
  plan_id: string
  ordinal: number
  title: string
  status: 'pending' | 'in_progress' | 'blocked' | 'completed' | 'skipped' | 'failed'
  depends_on: string | null
  verification: string | null
  evidence: string | null
  created_at: number
}

export interface Plan {
  id: string
  session_id: string
  goal_id: string | null
  version: number
  status: string
  created_at: number
  updated_at: number
  steps: PlanStep[]
}

export const fetchGoals = (sessionId: string) =>
  apiGet<Goal[]>(`/api/goals/${encodeURIComponent(sessionId)}`)

export const createGoal = (data: { session_id: string; outcome: string; constraints?: string; verification?: string; budget_tokens?: number }) =>
  apiPost<Goal>('/api/goals', data)

export const pauseGoal = (id: string) =>
  apiPost<Goal>(`/api/goals/${id}/pause`)

export const resumeGoal = (id: string) =>
  apiPost<{ goal: Goal; run_id: string }>(`/api/goals/${id}/resume`)

export const cancelGoal = (id: string) =>
  apiPost<Goal>(`/api/goals/${id}/cancel`)

export const fetchActivePlan = (sessionId: string) =>
  apiGet<Plan | null>(`/api/goals/plan/${encodeURIComponent(sessionId)}`)

export const discardActivePlan = (sessionId: string) =>
  apiPost<Plan>(`/api/goals/plan/${encodeURIComponent(sessionId)}/discard`)

export const patchGoal = (id: string, patch: Partial<Goal>) =>
  apiPatch<Goal>(`/api/goals/${id}`, patch)
