import type { Strategy } from './strategy.js'
import type { ApprovalChoice } from './runtime/approval-registry.js'

/**
 * Auto Approve is intentionally non-interactive for every approval category,
 * including expanding a session's authorized workspace roots.
 */
export async function decideWorkspaceApproval(
  strategy: Strategy,
  requestApproval: () => Promise<ApprovalChoice>,
): Promise<ApprovalChoice> {
  if (strategy === 'Auto Approve') return 'always'
  return requestApproval()
}
