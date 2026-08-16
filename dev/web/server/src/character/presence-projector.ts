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
               ROW_NUMBER() OVER (
                 PARTITION BY re.session_id
                 ORDER BY re.created_at DESC, re.seq DESC
               ) AS rank
        FROM run_events re
        WHERE re.session_id IS NOT NULL
          AND re.type IN (
            'run.cancelled', 'run.failed', 'run.interrupted', 'run.max_turns',
            'run.budget_exhausted', 'run.completed', 'tool.started', 'tool.output',
            'tool.completed', 'message.delta', 'run.started', 'run.retrying',
            'run.queued', 'run.continuation_queued', 'approval.requested', 'ask_user'
          )
      )
      SELECT type, created_at, run_id, session_id
      FROM ranked
      WHERE rank = 1
    `).all() as Array<{
      type: string
      created_at: number
      run_id: string
      session_id: string
    }>

    const presences: SessionPresence[] = []
    for (const event of rows) {
      const mapped = mapEvent(event.type)
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
      const mapped = mapEvent(event.type)
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
