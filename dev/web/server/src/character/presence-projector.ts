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
  [/^run\.failed$|^run\.interrupted$/, 'error', 100],
  [/^run\.completed$/, 'success', 90],
  [/^tool\.started$|^tool\.output$/, 'working', 80],
  [/^message\.delta$/, 'speaking', 70],
  [/^run\.started$|^run\.retrying$|^run\.queued$/, 'thinking', 60],
  [/^approval\.requested$/, 'listening', 40],
]

function mapEvent(type: string): { motion: CharacterMotion; priority: number } | null {
  const match = MOTIONS.find(([pattern]) => pattern.test(type))
  return match ? { motion: match[1], priority: match[2] } : null
}

export const characterPresenceProjector = {
  mapEvent,

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
        motion: mapped.motion,
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
