import { getDb } from '../db/schema.js'
import type { CharacterMotion } from './visual-store.js'

export interface CharacterPresence {
  characterId: string
  characterRevisionId: string | null
  sessionId: string | null
  runId: string | null
  motion: CharacterMotion
  source: 'agent' | 'interaction' | 'autopilot'
  priority: number
  since: number
  interruptible: boolean
}

const MOTIONS: Array<[RegExp, CharacterMotion, number]> = [
  [/^run\.cancelled$/, 'idle', 110],
  [/^run\.failed$|^run\.interrupted$|^run\.max_turns$|^run\.budget_exhausted$/, 'error', 100],
  [/^run\.completed$/, 'success', 90],
  [/^tool\./, 'working', 80],
  [/^message\.delta$/, 'speaking', 70],
  [/^run\.started$|^run\.retrying$|^run\.queued$|^run\.continuation_queued$/, 'thinking', 60],
  [/^approval\.requested$|^ask_user$/, 'listening', 40],
]

const TERMINAL_MOTION_TTL_MS = 8_000

// Hardening: even if a run somehow lacks a durable terminal event (defensive —
// the stall watchdog and startup recovery normally guarantee one), the
// presence must reflect the run's ACTUAL terminal status rather than the last
// stream event, otherwise the UI stays stuck in thinking/speaking forever.
const TERMINAL_MOTION_BY_STATUS: Record<string, { motion: CharacterMotion; priority: number }> = {
  completed: { motion: 'success', priority: 90 },
  failed: { motion: 'error', priority: 100 },
  interrupted: { motion: 'error', priority: 100 },
  max_turns: { motion: 'error', priority: 100 },
  budget_exhausted: { motion: 'error', priority: 100 },
  cancelled: { motion: 'idle', priority: 110 },
}

function terminalMotionForRun(runId: string): { motion: CharacterMotion; priority: number } | null {
  const row = getDb().prepare('SELECT status FROM runs WHERE id = ?').get(runId) as { status?: string } | undefined
  if (!row?.status) return null
  return TERMINAL_MOTION_BY_STATUS[row.status] ?? null
}

function mapEvent(type: string): { motion: CharacterMotion; priority: number } | null {
  const match = MOTIONS.find(([pattern]) => pattern.test(type))
  return match ? { motion: match[1], priority: match[2] } : null
}

function settleTerminalMotion(motion: CharacterMotion, since: number, now = Date.now()): CharacterMotion {
  return (motion === 'success' || motion === 'error') && now - since >= TERMINAL_MOTION_TTL_MS
    ? 'idle'
    : motion
}

export interface SessionPresence {
  sessionId: string
  runId: string
  motion: CharacterMotion
  since: number
}

export const characterPresenceProjector = {
  mapEvent,

  listBySession(): SessionPresence[] {
    const rows = getDb().prepare(`
      WITH ranked AS (
        SELECT re.type, re.created_at, re.run_id, re.session_id,
               r.status AS run_status,
               ROW_NUMBER() OVER (
                 PARTITION BY re.session_id
                 ORDER BY re.created_at DESC, re.seq DESC
               ) AS rank
        FROM run_events re
        JOIN runs r ON r.id = re.run_id
        WHERE re.session_id IS NOT NULL
          AND re.type IN (
            'run.cancelled', 'run.failed', 'run.interrupted', 'run.max_turns',
            'run.budget_exhausted', 'run.completed', 'tool.started', 'tool.output',
            'tool.completed', 'message.delta', 'run.started', 'run.retrying',
            'run.queued', 'run.continuation_queued', 'approval.requested', 'ask_user'
          )
      )
      SELECT type, created_at, run_id, session_id, run_status
      FROM ranked
      WHERE rank = 1
    `).all() as Array<{
      type: string
      created_at: number
      run_id: string
      session_id: string
      run_status: string
    }>

    const presences: SessionPresence[] = []
    for (const event of rows) {
      const terminal = event.run_status ? TERMINAL_MOTION_BY_STATUS[event.run_status] ?? null : null
      const mapped = terminal ?? mapEvent(event.type)
      if (!mapped) continue
      presences.push({
        sessionId: event.session_id,
        runId: event.run_id,
        motion: settleTerminalMotion(mapped.motion, event.created_at),
        since: event.created_at,
      })
    }
    return presences
  },

  get(characterId: string): CharacterPresence {
    const row = getDb().prepare(`
      SELECT re.type, re.created_at, re.run_id, re.session_id,
             r.character_revision_id
      FROM run_events re
      JOIN runs r ON r.id = re.run_id
      WHERE r.character_id = ?
      ORDER BY re.created_at DESC, re.seq DESC
      LIMIT 100
    `).all(characterId) as Array<{
      type: string
      created_at: number
      run_id: string
      session_id: string
      character_revision_id: string
    }>
    for (const event of row) {
      const terminal = terminalMotionForRun(event.run_id)
      const mapped = terminal ?? mapEvent(event.type)
      if (!mapped) continue
      return {
        characterId,
        characterRevisionId: event.character_revision_id,
        sessionId: event.session_id,
        runId: event.run_id,
        motion: settleTerminalMotion(mapped.motion, event.created_at),
        source: 'agent',
        priority: mapped.priority,
        since: event.created_at,
        interruptible: mapped.motion !== 'error',
      }
    }
    return {
      characterId,
      characterRevisionId: null,
      sessionId: null,
      runId: null,
      motion: 'idle',
      source: 'autopilot',
      priority: 10,
      since: Date.now(),
      interruptible: true,
    }
  },
}
