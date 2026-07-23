import { eventService } from '../event/eventService.js'
import { mergeOldDebugTurns, deleteOldDebugSessions } from '../debug/merge-turns.js'

interface CronTask {
  name: string
  handler: () => void
  hour: number
  minute: number
}

let cronTimer: ReturnType<typeof setInterval> | null = null
const tasks: CronTask[] = []
const lastRunByTask = new Map<string, string>()

export function registerCronTask(name: string, handler: () => void, hour: number, minute: number) {
  tasks.push({ name, handler, hour, minute })
}

export function startCronRegistry() {
  if (cronTimer) return
  console.log('[cron-registry] Starting (check every 60s)')

  registerCronTask('daily-review', () => {
    console.log('[cron-registry] Dispatching daily review event')
    try {
      eventService.create({
        source_type: 'system',
        source_id: 'cron_daemon',
        assigned_agent_id: 'master_yi',
        type: 'cron',
        cron_expr: '0 2 * * *',
        payload: {
          instruction: 'Scan trajectories from the last 7 days, cluster them, and extract reusable skill patterns (lookback_days: 7)',
        },
        status: 'pending',
        scheduled_at: Date.now(),
      })
    } catch (err) {
      console.error('[cron-registry] Failed to create daily review event:', err)
    }
  }, 2, 0)

  registerCronTask('merge-debug-turns', () => {
    console.log('[cron-registry] Merging old debug turns')
    mergeOldDebugTurns()
    deleteOldDebugSessions()
  }, 2, 30)

  cronTimer = setInterval(tick, 60000)
}

export function stopCronRegistry() {
  if (cronTimer) {
    clearInterval(cronTimer)
    cronTimer = null
  }
}

function tick() {
  const now = new Date()
  const h = now.getHours()
  const m = now.getMinutes()
  for (const task of tasks) {
    if (task.hour !== h || task.minute !== m) continue
    const dedup = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${h}:${m}`
    if (lastRunByTask.get(task.name) === dedup) continue
    lastRunByTask.set(task.name, dedup)
    task.handler()
  }
}
