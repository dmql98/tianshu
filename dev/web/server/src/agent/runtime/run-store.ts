import { randomUUID } from 'crypto'
import { getDb } from '../../db/schema.js'
import { resolveCharacterBinding } from '../../character/binding-resolver.js'
import { registerAssetRefs } from '../../character/asset-refs.js'
import type { SessionRow } from '../../db/sessionStore.js'

export type RunStatus =
  | 'queued' | 'preparing' | 'running' | 'cancelling'
  | 'awaiting_approval' | 'awaiting_input' | 'paused'
  | 'completed' | 'failed' | 'cancelled' | 'max_turns'
  | 'budget_exhausted' | 'interrupted'
export type RunPhase = 'context' | 'model' | 'tools' | 'delegate' | 'verify' | 'finalize'

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
  } = {}): RunRow {
    const resolved = resolveCharacterBinding(session)
    const now = Date.now()
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
      max_turns: input.maxTurns || 50,
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
        usage, result, error, queued_at, started_at, finished_at, updated_at
      ) VALUES (
        @id, @session_id, @turn_id, @parent_run_id, @resumed_from_run_id,
        @character_id, @character_revision_id, @character_snapshot_hash, @source,
        @status, @phase, @approval_mode, @execution_mode, @turn_no, @max_turns,
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
}
