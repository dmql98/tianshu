import { apiGet, apiPut, apiPost } from './client'
import type { SystemRunPolicy } from '@/features/run-policy/types'

export interface SystemRunPolicyResponse {
  policy: SystemRunPolicy
  defaults: SystemRunPolicy
}

export const fetchRunPolicy = () =>
  apiGet<SystemRunPolicyResponse>('/api/config/run-policy')

export const saveRunPolicy = (policy: SystemRunPolicy) =>
  apiPut<SystemRunPolicyResponse>('/api/config/run-policy', { policy })

export const resetRunPolicy = () =>
  apiPost<SystemRunPolicyResponse>('/api/config/run-policy/reset')
