import { useEffect, useState } from 'react'
import { connectSocket } from '@/api/socket'
import { fetchCharacterPresence, type CharacterMotion } from '@/api/characters'

interface SemanticEvent {
  session_id?: string
  run_id?: string
  character_id?: string
}

function eventMotion(type: string): CharacterMotion | null {
  if (type === 'run.cancelled') return 'idle'
  if (type === 'run.failed' || type === 'run.interrupted') return 'error'
  if (type === 'run.completed') return 'success'
  if (type.startsWith('tool.')) return 'working'
  if (type === 'message.delta') return 'speaking'
  if (type === 'run.started' || type === 'run.retrying' || type === 'run.queued') return 'thinking'
  if (type === 'approval.requested') return 'listening'
  return null
}

const EVENT_TYPES = [
  'run.queued', 'run.started', 'run.retrying', 'run.completed', 'run.failed',
  'run.cancelled', 'run.interrupted', 'message.delta', 'tool.started', 'tool.output',
  'tool.completed', 'approval.requested',
]

export function useCharacterPresence(characterId: string, sessionId?: string, enabled = true): CharacterMotion {
  const [motion, setMotion] = useState<CharacterMotion>('idle')

  useEffect(() => {
    if (!characterId || !enabled) return
    let disposed = false
    let resetTimer: ReturnType<typeof setTimeout> | null = null
    fetchCharacterPresence(characterId)
      .then(presence => { if (!disposed) setMotion(presence.motion) })
      .catch(() => { /* visual presence must never block chat */ })

    const socket = connectSocket()
    const listeners = EVENT_TYPES.map(type => {
      const listener = (event: SemanticEvent) => {
        if (sessionId && event.session_id !== sessionId) return
        if (!sessionId && event.character_id && event.character_id !== characterId) return
        const next = eventMotion(type)
        if (!next) return
        setMotion(next)
        if (resetTimer) clearTimeout(resetTimer)
        if (next === 'success' || next === 'error') {
          resetTimer = setTimeout(() => setMotion('idle'), 2200)
        }
      }
      socket.on(type, listener)
      return [type, listener] as const
    })
    return () => {
      disposed = true
      if (resetTimer) clearTimeout(resetTimer)
      for (const [type, listener] of listeners) socket.off(type, listener)
    }
  }, [characterId, sessionId, enabled])

  return motion
}
