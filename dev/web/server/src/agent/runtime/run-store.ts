import { randomUUID } from 'crypto'
import { getDb } from '../../db/schema.js'
import { resolveCharacterBinding } from '../../character/binding-resolver.js'
import { registerAssetRefs } from '../../character/asset-refs.js'
import type { SessionRow } from '../../db/sessionStore.js'
import { getSystemRunPolicy } from '../../config.js'
import { resolveRunPolicy } from '../loop/run-policy-resolver.js'
import type { RunPolicySnapshot } from '../loop/run-policy.js'

export type RunStatus =
  | 'queued' | 'preparing' | 'running' | 'cancelling'
  | 'awaiting_approval' | 'awaiting_input' | 'paused'
  | 'completed' | 'failed' | 'cancelled' | 'max_turns'
  | 'budget_exhausted' | 'interrupted'
export type RunPhase = 'context' | 'model' | 'tools' | 'delegate' | 'verify' | 'finalize'
export type ResumeTrigger = 'manual' | 'user_input' | 'auto_limit' | 'sub_agent_callback' | null

export interface RunRow {
  id: string
  session_id: string
  turn_id: string | null
  parent_run_id: string | null
  resumed_from_run_id: string | null
  character_id: string
  character_revision_id: string
  character_snapshot_hash: string
  source: 'chat' | 'event' | 'goal' | 'agent_task'
  status: RunStatus
  phase: RunPhase
  approval_mode: string
  execution_mode: string
  turn_no: number
  max_turns: number
  run_policy_snapshot: string | null
  configured_max_turns: number | null
  soft_turns: number | null
  absolute_turns: number | null
  continuation_root_run_id: string | null
  continuation_index: number
  resume_trigger: ResumeTrigger
  usage: string | null
  result: string | null
  error: string | null
  queued_at: number
  started_at: number | null
  finished_at: number | null
  updated_at: number
}

const TERMINAL = new Set<RunStatus>([
  'completed', 'failed', 'cancelled', 'max_turns', 'budget_exhausted', 'interrupted',
])

const ALLOWED_TRANSITIONS: Record<RunStatus, ReadonlySet<RunStatus>> = {
  queued: new Set(['preparing', 'cancelling', 'cancelled', 'failed']),
  preparing: new Set(['running', 'cancelling', 'cancelled', 'failed', 'interrupted']),
  running: new Set([
    'awaiting_approval', 'awaiting_input', 'paused', 'cancelling',
    'completed', 'failed', 'cancelled', 'max_turns', 'budget_exhausted', 'interrupted',
  ]),
  cancelling: new Set(['cancelled', 'failed', 'interrupted']),
  awaiting_approval: new Set([
    'queued', 'cancelling', 'cancelled', 'failed', 'interrupted',
    'completed', 'max_turns', 'budget_exhausted',
  ]),
  awaiting_input: new Set([
    'queued', 'cancelling', 'cancelled', 'failed', 'interrupted',
    'completed', 'max_turns', 'budget_exhausted',
  ]),
  paused: new Set([
    'queued', 'cancelling', 'cancelled', 'failed', 'interrupted',
    'completed', 'max_turns', 'budget_exhausted',
  ]),
  completed: new Set(),
  failed: new Set(),
  cancelled: new Set(),
  max_turns: new Set(),
  budget_exhausted: new Set(),
  interrupted: new Set(),
}

export function canTransitionRun(from: RunStatus, to: RunStatus): boolean {
  return ALLOWED_TRANSITIONS[from].has(to)
}

/** Waiting-on-human states: approval prompt, ask-user input, or manual pause. */
export function isParked(status: RunStatus): boolean {
  return status === 'awaiting_approval' || status === 'awaiting_input' || status === 'paused'
}

export const runStore = {
  get(id: string): RunRow | null {
    return getDb().prepare('SELECT * FROM runs WHERE id = ?').get(id) as RunRow | null
  },

  listForSession(sessionId: string, limit = 50): RunRow[] {
    return getDb().prepare(
      'SELECT * FROM runs WHERE session_id = ? ORDER BY queued_at DESC LIMIT ?',
    ).all(sessionId, limit) as RunRow[]
  },

  create(session: SessionRow, input: {
    id?: string
    turnId?: string | null
    parentRunId?: string | null
    resumedFromRunId?: string | null
    source?: RunRow['source']
    maxTurns?: number
    /** Explicit policy snapshot (continuation Runs inherit a stricter root). */
    policy?: RunPolicySnapshot
    continuationRootRunId?: string | null
    continuationIndex?: number
    resumeTrigger?: ResumeTrigger
  } = {}): RunRow {
    const resolved = resolveCharacterBinding(session)
    const now = Date.now()

    // Effective policy: prefer the caller-supplied snapshot (computed from the
    // pinned revision + system boundary), otherwise resolve here from the pinned
    // revision's character runPolicy. Never re-read live config mid-run.
    const pinnedMeta = (() => {
      try {
        const snapshot = JSON.parse(resolved.revision.snapshot) as { meta?: { runPolicy?: unknown } }
        return snapshot.meta?.runPolicy
      } catch {
        return undefined
      }
    })()
    const policy = input.policy ?? resolveRunPolicy(getSystemRunPolicy(), pinnedMeta as never)

    const row: RunRow = {
      id: input.id || `run_${randomUUID()}`,
      session_id: session.id,
      turn_id: input.turnId || null,
      parent_run_id: input.parentRunId || null,
      resumed_from_run_id: input.resumedFromRunId || null,
      character_id: resolved.characterId,
      character_revision_id: resolved.revision.id,
      character_snapshot_hash: resolved.snapshotHash,
      source: input.source || 'chat',
      status: 'queued',
      phase: 'context',
      approval_mode: session.approval_mode || session.current_strategy || 'Ask Risky',
      execution_mode: session.execution_mode || 'direct',
      turn_no: 0,
      max_turns: policy.effective.absoluteTurns,
      run_policy_snapshot: JSON.stringify(policy),
      configured_max_turns: policy.effective.absoluteTurns,
      soft_turns: policy.effective.softTurns,
      absolute_turns: policy.effective.absoluteTurns,
      continuation_root_run_id: input.continuationRootRunId || null,
      continuation_index: input.continuationIndex || 0,
      resume_trigger: input.resumeTrigger ?? null,
      usage: null,
      result: null,
      error: null,
      queued_at: now,
      started_at: null,
      finished_at: null,
      updated_at: now,
    }
    getDb().prepare(`
      INSERT INTO runs (
        id, session_id, turn_id, parent_run_id, resumed_from_run_id,
        character_id, character_revision_id, character_snapshot_hash, source,
        status, phase, approval_mode, execution_mode, turn_no, max_turns,
        run_policy_snapshot, configured_max_turns, soft_turns, absolute_turns,
        continuation_root_run_id, continuation_index, resume_trigger,
        usage, result, error, queued_at, started_at, finished_at, updated_at
      ) VALUES (
        @id, @session_id, @turn_id, @parent_run_id, @resumed_from_run_id,
        @character_id, @character_revision_id, @character_snapshot_hash, @source,
        @status, @phase, @approval_mode, @execution_mode, @turn_no, @max_turns,
        @run_policy_snapshot, @configured_max_turns, @soft_turns, @absolute_turns,
        @continuation_root_run_id, @continuation_index, @resume_trigger,
        @usage, @result, @error, @queued_at, @started_at, @finished_at, @updated_at
      )
    `).run(row)
    // Pin the assets the run's fixed revision references so GC keeps them.
    try {
      const snapshot = JSON.parse(resolved.revision.snapshot) as { visual?: Record<string, unknown> | null }
      registerAssetRefs({
        ownerType: 'run',
        ownerId: row.id,
        characterId: row.character_id,
        visual: snapshot.visual || null,
      })
    } catch { /* snapshot parse failure must not block run creation */ }
    return row
  },

  transition(id: string, status: RunStatus, phase?: RunPhase): RunRow | null {
    const existing = this.get(id)
    if (!existing || !canTransitionRun(existing.status, status)) return null
    const now = Date.now()
    const startedAt = existing.started_at || (status === 'running' ? now : null)
    getDb().prepare(`
      UPDATE runs SET status = ?, phase = ?, started_at = ?, updated_at = ?
      WHERE id = ? AND status NOT IN
        ('completed','failed','cancelled','max_turns','budget_exhausted','interrupted')
    `).run(status, phase || existing.phase, startedAt, now, id)
    return this.get(id)
  },

  setPhase(id: string, phase: RunPhase): RunRow | null {
    const existing = this.get(id)
    if (!existing || TERMINAL.has(existing.status)) return null
    getDb().prepare('UPDATE runs SET phase = ?, updated_at = ? WHERE id = ?')
      .run(phase, Date.now(), id)
    return this.get(id)
  },

  finish(id: string, status: Extract<RunStatus,
    'completed' | 'failed' | 'cancelled' | 'max_turns' | 'budget_exhausted' | 'interrupted'
  >, data: { usage?: unknown; result?: unknown; error?: string } = {}): boolean {
    const existing = this.get(id)
    if (!existing || !canTransitionRun(existing.status, status)) return false
    const now = Date.now()
    return getDb().prepare(`
      UPDATE runs SET status = ?, phase = 'finalize', usage = ?, result = ?,
        error = ?, finished_at = ?, updated_at = ?
      WHERE id = ? AND status NOT IN
        ('completed','failed','cancelled','max_turns','budget_exhausted','interrupted')
    `).run(
      status,
      data.usage == null ? null : JSON.stringify(data.usage),
      data.result == null ? null : JSON.stringify(data.result),
      data.error || null,
      now,
      now,
      id,
    ).changes === 1
  },

  // ── Run policy & continuation helpers (§5.2, §6, §10) ──

  /** Parse a run's frozen policy snapshot (null-safe). */
  policySnapshot(id: string): RunPolicySnapshot | null {
    const run = this.get(id)
    if (!run?.run_policy_snapshot) return null
    try { return JSON.parse(run.run_policy_snapshot) as RunPolicySnapshot } catch { return null }
  },

  /** The chain root for a run (itself when the run roots its own chain). */
  chainRootId(id: string): string {
    const run = this.get(id)
    return run?.continuation_root_run_id || id
  },

  /** All runs of a continuation chain, ordered by creation. */
  listChain(continuationRootRunId: string): RunRow[] {
    return getDb().prepare(
      `SELECT * FROM runs WHERE continuation_root_run_id = ? ORDER BY continuation_index ASC, queued_at ASC`,
    ).all(continuationRootRunId) as RunRow[]
  },

  /** The unique `auto_limit` successor of a predecessor run, if any (§6.3). */
  autoContinuationOf(fromRunId: string): RunRow | null {
    return getDb().prepare(
      `SELECT * FROM runs WHERE resumed_from_run_id = ? AND resume_trigger = 'auto_limit' LIMIT 1`,
    ).get(fromRunId) as RunRow | null
  },

  /** True when any live (non-terminal) run exists in the chain. */
  hasLiveChainRun(continuationRootRunId: string): boolean {
    const live = getDb().prepare(`
      SELECT 1 FROM runs
      WHERE continuation_root_run_id = ? AND status NOT IN
        ('completed','failed','cancelled','max_turns','budget_exhausted','interrupted')
      LIMIT 1
    `).get(continuationRootRunId)
    return !!live
  },

  /** Mark a queued/unstarted auto continuation as superseded by a user run. */
  supersedeQueuedAutoContinuations(continuationRootRunId: string): RunRow[] {
    const candidates = getDb().prepare(`
      SELECT * FROM runs
      WHERE continuation_root_run_id = ? AND resume_trigger = 'auto_limit'
        AND status IN ('queued', 'preparing')
    `).all(continuationRootRunId) as RunRow[]
    for (const run of candidates) {
      this.finish(run.id, 'cancelled', { result: { reason: 'superseded_by_user_run' } })
    }
    return candidates
  },

  /** Accumulated chain budget so far (turns / tokens / started time). */
  chainUsage(continuationRootRunId: string): { turns: number; tokens: number; wallMs: number } {
    const runs = this.listChain(continuationRootRunId)
    const root = runs[0]
    let turns = 0
    let tokens = 0
    for (const run of runs) {
      turns += run.turn_no || 0
      if (run.usage) {
        try {
          const usage = JSON.parse(run.usage) as { input_tokens?: number; output_tokens?: number }
          tokens += (usage.input_tokens || 0) + (usage.output_tokens || 0)
        } catch { /* ignore corrupt usage */ }
      }
    }
    const firstStarted = root?.started_at || root?.queued_at || 0
    const wallMs = firstStarted ? Date.now() - firstStarted : 0
    return { turns, tokens, wallMs }
  },
}
