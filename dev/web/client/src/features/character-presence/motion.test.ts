import { describe, expect, it } from 'vitest'
import { motionForRunEvent } from './motion'

describe('motionForRunEvent', () => {
  it.each([
    ['run.started', 'thinking'],
    ['run.continuation_queued', 'thinking'],
    ['tool.started', 'working'],
    ['tool.completed', 'working'],
    ['message.delta', 'speaking'],
    ['approval.requested', 'listening'],
    ['ask_user', 'listening'],
    ['run.completed', 'success'],
    ['run.max_turns', 'error'],
    ['run.budget_exhausted', 'error'],
    ['run.cancelled', 'idle'],
  ])('maps %s to %s', (event, expected) => {
    expect(motionForRunEvent(event)).toBe(expected)
  })

  it('ignores events that do not change presence', () => {
    expect(motionForRunEvent('usage')).toBeNull()
  })
})
