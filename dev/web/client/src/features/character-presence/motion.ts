import type { CharacterMotion } from '@/api/characters'

/** Canonical run-event projection shared by avatars and session-list dots. */
export function motionForRunEvent(type: string): CharacterMotion | null {
  if (type === 'run.cancelled') return 'idle'
  if (type === 'run.failed' || type === 'run.interrupted'
    || type === 'run.max_turns' || type === 'run.budget_exhausted') return 'error'
  if (type === 'run.completed') return 'success'
  if (type.startsWith('tool.')) return 'working'
  if (type === 'message.delta') return 'speaking'
  if (type === 'run.started' || type === 'run.retrying' || type === 'run.queued'
    || type === 'run.continuation_queued') return 'thinking'
  if (type === 'approval.requested' || type === 'ask_user') return 'listening'
  return null
}

export function motionLabelKey(motion: CharacterMotion): string {
  switch (motion) {
    case 'thinking': return '思考中'
    case 'working':
    case 'toolCalling': return '执行工具中'
    case 'speaking': return '回复中'
    case 'listening': return '等待确认'
    case 'success': return '已完成'
    case 'error': return '运行出错'
    default: return '等待中'
  }
}
