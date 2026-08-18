import { getDb } from '../../db/schema.js'
import { withTransaction } from '../../db/sqlite-db.js'
import { runStore, type ResumeTrigger, type RunRow } from './run-store.js'
import { sessionStore, type SessionRow } from '../../db/sessionStore.js'
import { turnStore } from '../../db/turnStore.js'
import { messageStore } from '../../db/messageStore.js'
import { checkpointStore } from './checkpoint-store.js'
import { planStore } from '../plan/plan-store.js'
import { goalStore } from '../plan/plan-store.js'
import { getSystemRunPolicy } from '../../config.js'
import { resolveRunPolicy, mergeStricterSystemCaps } from '../loop/run-policy-resolver.js'
import type { RunPolicySnapshot } from '../loop/run-policy.js'
import { resolveCharacterBinding } from '../../character/binding-resolver.js'

/**
 * Shared resume service (RUN_LIMIT_POLICY_PLAN §10). Both HTTP routes and the
 * auto-continuation engine create resumed Runs through here so trigger semantics
 * (continuation root / index / user-turn) stay consistent.
 */

export type ResumeTriggerValue = 'manual' | 'user_input' | 'auto_limit'

export interface ResumeRunRequest {
  previousRunId: string
  trigger: ResumeTriggerValue
  instruction: string
  createUserTurn: boolean
}

export interface ResumeRunResult {
  run: RunRow
  session: SessionRow
  supersededAuto: RunRow[]
  userMessageId?: number | null
}

export type ContinuationEligibility =
  | { eligible: true; finalizeOnly: boolean }
  | { eligible: false; reason: string }

/**
 * Decide whether an auto continuation may follow a max_turns run (§10.3).
 * Pure decision — no side effects. Callers still re-check under the creation
 * transaction to close cancellation / user-input races.
 */
export function evaluateAutoContinuation(previousRun: RunRow): ContinuationEligibility {
  if (previousRun.status !== 'max_turns') {
    return { eligible: false, reason: 'previous_run_not_max_turns' }
  }
  const rawMode = previousRun.execution_mode
  // Goal mode is the default execution semantics; no degradation.
  const mode = rawMode === 'plan_first' ? 'plan_first' : rawMode === 'goal' ? 'goal' : rawMode
  if (mode !== 'plan_first' && mode !== 'goal') {
    return { eligible: false, reason: 'mode_not_continuable' }
  }
  const policy = runStore.policySnapshot(previousRun.id)
  if (!policy) return { eligible: false, reason: 'no_policy_snapshot' }
  if (!policy.effective.autoContinuation) {
    return { eligible: false, reason: 'auto_continuation_disabled' }
  }
  const session = sessionStore.getById(previousRun.session_id)
  if (!session) return { eligible: false, reason: 'session_missing' }

  // Chain root / budgets.
  const rootId = runStore.chainRootId(previousRun.id)
  const chain = runStore.listChain(rootId)
  const rootPolicy = runStore.policySnapshot(rootId) || policy

  // User-cancellation marker on the chain root's result.
  const root = runStore.get(rootId)
  if (root?.result) {
    try {
      const res = JSON.parse(root.result) as { cancelled?: boolean }
      if (res.cancelled) return { eligible: false, reason: 'chain_cancelled' }
    } catch { /* ignore */ }
  }

  // Ask-user / approval / pause checkpoints block auto continuation.
  const liveCheckpoints = chain.some(run => {
    const cps = checkpointStore.listForRun(run.id)
    return cps.some(cp => cp.reason === 'ask_user' || cp.reason === 'approval.requested')
  })
  if (liveCheckpoints) return { eligible: false, reason: 'parked_checkpoint' }

  // A newer manual / user_input run supersedes the auto chain.
  const newerUserRun = getDb().prepare(`
    SELECT * FROM runs WHERE session_id = ?
      AND resumed_from_run_id IS NOT NULL
      AND resume_trigger IN ('manual', 'user_input')
      AND queued_at > ?
    ORDER BY queued_at DESC LIMIT 1
  `).get(session.id, previousRun.queued_at) as RunRow | undefined
  if (newerUserRun) return { eligible: false, reason: 'superseded_by_user_run' }

  // Plan / goal state.
  const plan = planStore.getDisplayPlan(session.id)
  const planUnfinished = !!plan && !planStore.allCompleted(plan.id)
  if (mode === 'goal') {
    const activeGoal = goalStore.listForSession(session.id).find(g => g.status === 'active')
    if (!activeGoal) return { eligible: false, reason: 'goal_not_active' }
    if (activeGoal.budget_tokens && goalStore.usedTokens(activeGoal) >= activeGoal.budget_tokens) {
      return { eligible: false, reason: 'goal_budget_exhausted' }
    }
  }
  // Finalize-only: all plan steps done but no successful submit_result yet.
  const finalizeOnly = planUnfinished ? false
    : !!plan && planStore.allCompleted(plan.id)
  if (!planUnfinished && !finalizeOnly) {
    return { eligible: false, reason: 'nothing_to_continue' }
  }

  // Chain budget checks (§10.4).
  const usage = runStore.chainUsage(rootId)
  const autoCount = chain.filter(r => r.resume_trigger === 'auto_limit' && r.status !== 'cancelled').length
  const eff = rootPolicy.effective
  if (autoCount >= eff.maxAutoContinuations) return { eligible: false, reason: 'continuation_count_exceeded' }
  if (usage.turns >= eff.maxChainTurns) return { eligible: false, reason: 'chain_turns_exceeded' }
  if (usage.tokens >= eff.maxChainTokens) return { eligible: false, reason: 'chain_tokens_exceeded' }
  if (usage.wallMs >= eff.maxChainWallTimeMs) return { eligible: false, reason: 'chain_time_exceeded' }

  // A running / queued auto successor already exists for the same predecessor.
  if (runStore.autoContinuationOf(previousRun.id)) {
    return { eligible: false, reason: 'successor_already_exists' }
  }

  return { eligible: true, finalizeOnly }
}

/**
 * Create a resumed Run. For `auto_limit` the successor inherits the chain root's
 * system safety snapshot merged with the current system policy (stricter wins),
 * and its policy is re-resolved against the current pinned character revision.
 * The successor + unique mapping are created in one transaction.
 */
export function createResumedRun(request: ResumeRunRequest): ResumeRunResult {
  const previous = runStore.get(request.previousRunId)
  if (!previous) throw new Error(`Previous run "${request.previousRunId}" not found`)
  const session = sessionStore.getById(previous.session_id)
  if (!session) throw new Error('Session not found')

  const db = getDb()
  return withTransaction(db, () => {
    let turnId: string | null = null
    let userMessageId: number | null = null
    if (request.createUserTurn) {
      const turn = turnStore.create(session.id, request.trigger === 'user_input' ? 'user' : 'event')
      const userMessage = messageStore.addMessage(session.id, {
        role: 'user',
        content: request.instruction,
        turn_id: turn.id,
      })
      turnStore.attachUserMessage(turn.id, userMessage.id)
      turnId = turn.id
      userMessageId = userMessage.id
    }

    // Continuation chain bookkeeping (§6.1, §10.2).
    const chainRootId = request.trigger === 'manual'
      ? null // manual starts a NEW chain
      : runStore.chainRootId(previous.id)
    // Index counts the chain members including the root run itself.
    const chainIndex = chainRootId
      ? runStore.listChain(chainRootId).length + 1
      : 0
    const resumeTrigger: ResumeTrigger = request.trigger

    // Policy: auto_limit inherits the root safety snapshot (stricter wins);
    // user_input/manual re-resolve against the current system boundary.
    let policy: RunPolicySnapshot
    if (request.trigger === 'auto_limit') {
      const root = runStore.get(chainRootId!)
      const rootSnapshot = root ? runStore.policySnapshot(root.id) : null
      const merged = rootSnapshot
        ? mergeStricterSystemCaps(rootSnapshot, getSystemRunPolicy())
        : getSystemRunPolicy()
      policy = resolveRunPolicy(merged, pinnedCharacterRunPolicy(session))
    } else {
      policy = resolveRunPolicy(getSystemRunPolicy(), pinnedCharacterRunPolicy(session))
    }

    const supersededAuto = runStore.supersedeQueuedAutoContinuations(chainRootId || '')

    const run = runStore.create(session, {
      turnId,
      resumedFromRunId: previous.id,
      source: previous.source === 'event' ? 'event' : 'chat',
      policy,
      continuationRootRunId: chainRootId,
      continuationIndex: chainIndex,
      resumeTrigger,
    })

    return { run, session, supersededAuto, userMessageId }
  })
}

function pinnedCharacterRunPolicy(session: SessionRow) {
  const resolved = resolveCharacterBinding(session)
  try {
    const snapshot = JSON.parse(resolved.revision.snapshot) as { meta?: { runPolicy?: unknown } }
    return snapshot.meta?.runPolicy as never
  } catch {
    return undefined
  }
}

function parseRunResult(raw: string | null): Record<string, unknown> {
  if (!raw) return {}
  try { return JSON.parse(raw) } catch { return {} }
}
