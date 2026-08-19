import { useEffect, useState } from 'react'
import { getEventBus } from '@/api/eventBus'
import { fetchCharacterPresence, type CharacterMotion } from '@/api/characters'
import { motionForRunEvent } from './motion'

export const MOTION_END_EVENT = 'tianshu:motion-ended'

interface SemanticEvent {
  session_id?: string
  run_id?: string
  character_id?: string
}

const EVENT_TYPES = [
  'run.queued', 'run.started', 'run.retrying', 'run.completed', 'run.failed',
  'run.cancelled', 'run.interrupted', 'run.max_turns', 'run.budget_exhausted',
  'run.continuation_queued', 'message.delta', 'tool.started', 'tool.output',
  'tool.completed', 'approval.requested', 'ask_user',
]

export function useCharacterPresence(characterId: string, sessionId?: string, enabled = true): CharacterMotion {
  const [motion, setMotion] = useState<CharacterMotion>('idle')

  useEffect(() => {
    if (!characterId || !enabled) return
    let disposed = false
    let resetTimer: ReturnType<typeof setTimeout> | null = null

    // Idle reset for one-shot motions (success/error): wait for the animation
    // to finish (motion-ended event) or a safety timeout, whichever first.
    const scheduleIdle = (after: number) => {
      if (resetTimer) clearTimeout(resetTimer)
      resetTimer = setTimeout(() => { if (!disposed) setMotion('idle') }, after)
    }
    const onMotionEnd = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== characterId) return
      scheduleIdle(0)
    }
    window.addEventListener(MOTION_END_EVENT, onMotionEnd)

    fetchCharacterPresence(characterId)
      .then(presence => {
        if (disposed) return
        setMotion(presence.motion)
        if (presence.motion === 'success' || presence.motion === 'error') scheduleIdle(8000)
      })
      .catch(() => { /* visual presence must never block chat */ })

    const bus = getEventBus()
    const listeners = EVENT_TYPES.map(type => {
      const listener = (event: SemanticEvent) => {
        if (sessionId && event.session_id !== sessionId) return
        if (!sessionId && event.character_id && event.character_id !== characterId) return
        const next = motionForRunEvent(type)
        if (!next) return
        setMotion(next)
        if (next === 'success' || next === 'error') scheduleIdle(8000)
        else if (resetTimer) clearTimeout(resetTimer)
      }
      bus.on(type, listener)
      return [type, listener] as const
    })
    return () => {
      disposed = true
      if (resetTimer) clearTimeout(resetTimer)
      window.removeEventListener(MOTION_END_EVENT, onMotionEnd)
      for (const [type, listener] of listeners) bus.off(type, listener)
    }
  }, [characterId, sessionId, enabled])

  return motion
}
