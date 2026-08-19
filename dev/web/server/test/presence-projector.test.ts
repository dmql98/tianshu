import { describe, expect, it } from 'vitest'
import { characterPresenceProjector } from '../src/character/presence-projector.js'

describe('character presence event mapping', () => {
  it.each([
    ['run.started', 'thinking'],
    ['run.continuation_queued', 'thinking'],
    ['tool.completed', 'working'],
    ['message.metrics', 'speaking'],
    ['ask_user', 'listening'],
    ['run.completed', 'success'],
    ['run.max_turns', 'error'],
    ['run.budget_exhausted', 'error'],
    ['run.cancelled', 'idle'],
  ])('maps %s to %s', (event, expected) => {
    expect(characterPresenceProjector.mapEvent(event)?.motion).toBe(expected)
  })
})
