import { describe, expect, it } from 'vitest'
import { isValidModelKey, normalizeModelUsage, topModelKeys } from './modelUsage'

describe('isValidModelKey', () => {
  it('requires providerId::modelName shape', () => {
    expect(isValidModelKey('p::m')).toBe(true)
    expect(isValidModelKey('no-separator')).toBe(false)
    expect(isValidModelKey('')).toBe(false)
  })
})

describe('normalizeModelUsage', () => {
  it('drops invalid keys and non-positive counts', () => {
    expect(
      normalizeModelUsage({ version: 1, counts: { 'a::m': 2.9, bad: 5, 'a::zero': 0, 'a::neg': -1 } }),
    ).toEqual({ version: 1, counts: { 'a::m': 2 } })
  })

  it('falls back to default on unknown version or malformed input', () => {
    expect(normalizeModelUsage({ version: 99, counts: {} })).toEqual({ version: 1, counts: {} })
    expect(normalizeModelUsage(null)).toEqual({ version: 1, counts: {} })
    expect(normalizeModelUsage('junk')).toEqual({ version: 1, counts: {} })
  })
})

describe('topModelKeys', () => {
  const usage = { version: 1 as const, counts: { 'a::a': 1, 'z::z': 1, 'b::b': 3, 'c::c': 2 } }

  it('ranks by count desc, breaks ties by key', () => {
    expect(topModelKeys(usage, 3)).toEqual(['b::b', 'c::c', 'a::a'])
  })

  it('limits to n', () => {
    expect(topModelKeys(usage, 2)).toEqual(['b::b', 'c::c'])
  })

  it('returns empty when no counts', () => {
    expect(topModelKeys({ version: 1, counts: {} }, 3)).toEqual([])
  })
})
