import { useEffect, useState } from 'react'
import { useChatStore } from '@/stores/chatStore'
import { fetchSessionStats } from '@/api/sessions'
import type { SessionStats } from '@/types'

const POLL_INTERVAL_MS = 3_000

/**
 * Poll the durable per-session run aggregate (GET /api/sessions/:id/stats).
 * Fetches on session activation and every few seconds while the active session
 * is streaming; returns the latest value (null until the first fetch settles).
 */
export function useSessionStats(sessionId: string | null): SessionStats | null {
  const isStreaming = useChatStore(s => s.isStreaming)
  const [stats, setStats] = useState<SessionStats | null>(null)

  useEffect(() => {
    if (!sessionId) {
      setStats(null)
      return
    }
    let disposed = false
    let timer: ReturnType<typeof setInterval> | undefined
    const load = async () => {
      try {
        const next = await fetchSessionStats(sessionId)
        if (!disposed) setStats(next)
      } catch {
        // Keep the last known value; the next poll retries.
      }
    }
    void load()
    if (isStreaming) timer = setInterval(() => { void load() }, POLL_INTERVAL_MS)
    return () => {
      disposed = true
      if (timer) clearInterval(timer)
    }
  }, [sessionId, isStreaming])

  return stats
}
