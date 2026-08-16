import { describe, expect, it } from 'vitest'
import { decideToolApproval, normalizeStrategy, STRATEGIES } from '../src/agent/strategy.js'

describe('approval strategy matrix', () => {
  const read = { readOnly: true, dangerous: false }
  const change = { readOnly: false, dangerous: false }
  const risky = { readOnly: false, dangerous: true }

  it('exposes the five ordered levels', () => {
    expect(STRATEGIES).toEqual([
      'Read Only', 'Ask Every Change', 'Ask Risky', 'Auto in Workspace', 'Auto Approve',
    ])
  })

  it.each([
    ['Read Only', 'allow', 'deny', 'deny'],
    ['Ask Every Change', 'allow', 'ask', 'ask'],
    ['Ask Risky', 'allow', 'allow', 'ask'],
    ['Auto in Workspace', 'allow', 'allow', 'allow'],
    ['Auto Approve', 'allow', 'allow', 'allow'],
  ] as const)('%s applies the expected tool policy', (strategy, readDecision, changeDecision, riskyDecision) => {
    expect(decideToolApproval(strategy, read)).toBe(readDecision)
    expect(decideToolApproval(strategy, change)).toBe(changeDecision)
    expect(decideToolApproval(strategy, risky)).toBe(riskyDecision)
  })

  it('keeps legacy strategy values compatible', () => {
    expect(normalizeStrategy('Plan')).toBe('Read Only')
    expect(normalizeStrategy('Ask')).toBe('Ask Risky')
    expect(normalizeStrategy('Bypass')).toBe('Auto Approve')
  })
})
