import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { normalizeSystemRunPolicy, normalizeCharacterRunPolicy, migrateCharacterRunPolicy, DEFAULT_SYSTEM_RUN_POLICY } from '../src/agent/loop/run-policy.js'
import { resolveRunPolicy, mergeStricterSystemCaps } from '../src/agent/loop/run-policy-resolver.js'
import { assessProgress, stableArgsHash } from '../src/agent/loop/loop-policy.js'

describe('SystemRunPolicy normalization', () => {
  it('missing runPolicy falls back to defaults', () => {
    expect(normalizeSystemRunPolicy(undefined)).toEqual(DEFAULT_SYSTEM_RUN_POLICY)
    expect(normalizeSystemRunPolicy({})).toEqual(DEFAULT_SYSTEM_RUN_POLICY)
  })

  it('normalizes non-numeric / NaN / fractional / negative / out-of-range fields', () => {
    const p = normalizeSystemRunPolicy({
      maxAbsoluteTurnsPerRun: '999', // string
      defaultSoftTurns: NaN,
      defaultGraceTurns: -5,
      noProgressThreshold: 2.5,
      repeatedToolLoopThreshold: 99999,
    })
    expect(p.maxAbsoluteTurnsPerRun).toBe(DEFAULT_SYSTEM_RUN_POLICY.maxAbsoluteTurnsPerRun)
    expect(p.defaultSoftTurns).toBe(DEFAULT_SYSTEM_RUN_POLICY.defaultSoftTurns)
    expect(p.defaultGraceTurns).toBe(0)
    expect(p.noProgressThreshold).toBe(DEFAULT_SYSTEM_RUN_POLICY.noProgressThreshold)
    expect(p.repeatedToolLoopThreshold).toBe(100)
  })

  it('enforces invariants: soft <= absolute, grace <= absolute - 1, grace <= maxGrace', () => {
    const p = normalizeSystemRunPolicy({ maxAbsoluteTurnsPerRun: 5, defaultSoftTurns: 9, maxGraceTurns: 9, defaultGraceTurns: 9 })
    expect(p.maxAbsoluteTurnsPerRun).toBe(5)
    expect(p.defaultSoftTurns).toBe(5)
    expect(p.maxGraceTurns).toBe(4)
    expect(p.defaultGraceTurns).toBe(4)
  })

  it('forces grace to 0 when absolute == 1', () => {
    const p = normalizeSystemRunPolicy({ maxAbsoluteTurnsPerRun: 1, maxGraceTurns: 10 })
    expect(p.maxGraceTurns).toBe(0)
    expect(p.defaultGraceTurns).toBe(0)
  })
})

describe('CharacterRunPolicy normalization', () => {
  it('returns undefined for empty / malformed input', () => {
    expect(normalizeCharacterRunPolicy(undefined)).toBeUndefined()
    expect(normalizeCharacterRunPolicy(null)).toBeUndefined()
    expect(normalizeCharacterRunPolicy({ version: 2 })).toBeUndefined()
  })

  it('keeps valid fields, drops invalid ones', () => {
    const p = normalizeCharacterRunPolicy({ version: 1, softTurns: 80, graceTurns: 15, autoContinuation: 'enabled', maxAutoContinuations: 1 })!
    expect(p.softTurns).toBe(80)
    expect(p.graceTurns).toBe(15)
    expect(p.autoContinuation).toBe('enabled')
    expect(p.maxAutoContinuations).toBe(1)
  })
})

describe('maxSteps migration', () => {
  it('maps 1..998 to softTurns', () => {
    const p = migrateCharacterRunPolicy(80, 999)!
    expect(p.softTurns).toBe(80)
    expect(p.graceTurns).toBeUndefined()
  })

  it('maps >= 999 to system absolute with zero grace', () => {
    const p = migrateCharacterRunPolicy(999, 120)!
    expect(p.softTurns).toBe(120)
    expect(p.graceTurns).toBe(0)
  })

  it('returns undefined when absent / out of range', () => {
    expect(migrateCharacterRunPolicy(undefined, 999)).toBeUndefined()
    expect(migrateCharacterRunPolicy(0, 999)).toBeUndefined()
  })
})

describe('resolveRunPolicy', () => {
  const system = normalizeSystemRunPolicy({
    dynamicLimitEnabled: true,
    maxAbsoluteTurnsPerRun: 120,
    maxGraceTurns: 50,
    defaultSoftTurns: 50,
    defaultGraceTurns: 10,
  })

  it('inherits system defaults when no character override', () => {
    const snap = resolveRunPolicy(system, undefined)
    expect(snap.effective.softTurns).toBe(50)
    expect(snap.effective.graceTurns).toBe(10)
    expect(snap.effective.absoluteTurns).toBe(60)
  })

  it('clamps character values against the system boundary', () => {
    const snap = resolveRunPolicy(system, normalizeCharacterRunPolicy({ version: 1, softTurns: 300, graceTurns: 100 })!)
    expect(snap.effective.softTurns).toBe(120)
    expect(snap.effective.graceTurns).toBe(0)
    expect(snap.effective.absoluteTurns).toBe(120)
  })

  it('caps grace so soft + grace never exceeds the absolute limit', () => {
    const snap = resolveRunPolicy(system, normalizeCharacterRunPolicy({ version: 1, softTurns: 100, graceTurns: 50 })!)
    expect(snap.effective.graceTurns).toBe(20)
    expect(snap.effective.absoluteTurns).toBe(120)
  })

  it('dynamic disabled degrades to a plain fixed cap', () => {
    const sys = normalizeSystemRunPolicy({ ...system, dynamicLimitEnabled: false })
    const snap = resolveRunPolicy(sys, normalizeCharacterRunPolicy({ version: 1, softTurns: 10 })!)
    expect(snap.effective.softTurns).toBe(120)
    expect(snap.effective.graceTurns).toBe(0)
    expect(snap.effective.absoluteTurns).toBe(120)
  })

  it('autoContinuation requires both system switch and character pref', () => {
    const enabledSys = normalizeSystemRunPolicy({ ...system, autoContinuationEnabled: true })
    const disabled = normalizeSystemRunPolicy({ ...system, autoContinuationEnabled: false })
    expect(resolveRunPolicy(disabled, undefined).effective.autoContinuation).toBe(false)
    expect(resolveRunPolicy(enabledSys, normalizeCharacterRunPolicy({ version: 1, autoContinuation: 'disabled' })!).effective.autoContinuation).toBe(false)
    expect(resolveRunPolicy(enabledSys, normalizeCharacterRunPolicy({ version: 1, autoContinuation: 'enabled' })!).effective.autoContinuation).toBe(true)
  })

  it('character maxAutoContinuations only shrinks the system value', () => {
    expect(resolveRunPolicy(system, undefined).effective.maxAutoContinuations).toBe(system.maxAutoContinuations)
    expect(resolveRunPolicy(system, normalizeCharacterRunPolicy({ version: 1, maxAutoContinuations: 1 })!).effective.maxAutoContinuations).toBe(1)
    expect(resolveRunPolicy(system, normalizeCharacterRunPolicy({ version: 1, maxAutoContinuations: 99 })!).effective.maxAutoContinuations).toBe(system.maxAutoContinuations)
  })
})

describe('mergeStricterSystemCaps', () => {
  it('takes the stricter (smaller) cap and ANDs the switches', () => {
    const root = resolveRunPolicy(normalizeSystemRunPolicy({ maxAbsoluteTurnsPerRun: 50, autoContinuationEnabled: true }), undefined)
    const current = normalizeSystemRunPolicy({ maxAbsoluteTurnsPerRun: 120, autoContinuationEnabled: true })
    const merged = mergeStricterSystemCaps(root, current)
    expect(merged.maxAbsoluteTurnsPerRun).toBe(50)
    expect(merged.autoContinuationEnabled).toBe(true)
  })

  it('a stricter current config also wins', () => {
    const root = resolveRunPolicy(normalizeSystemRunPolicy({ maxAbsoluteTurnsPerRun: 120, autoContinuationEnabled: true }), undefined)
    const current = normalizeSystemRunPolicy({ maxAbsoluteTurnsPerRun: 40, autoContinuationEnabled: false })
    const merged = mergeStricterSystemCaps(root, current)
    expect(merged.maxAbsoluteTurnsPerRun).toBe(40)
    expect(merged.autoContinuationEnabled).toBe(false)
  })
})

describe('progress assessment', () => {
  const rec = (toolName: string, extra: Partial<Parameters<typeof assessProgress>[0]['toolCalls'][0]> = {}) => ({ toolName, hasError: false, args: '{}', normalizedArgsHash: stableArgsHash({ path: 'a/b.ts' }), ...extra })

  it('write that changed state is strong progress', () => {
    const a = assessProgress({ toolCalls: [rec('write', { changed: true, outcomeKind: 'write' })], planStepChanged: false, verificationEvidenceAdded: false, databaseObjectChanged: false, testFailuresReduced: false, firstEvidence: false, submitSucceeded: false, firstNewRead: false, newErrorCategory: false, toolCategorySwitched: false, compactionSucceeded: false, textGrowthOnly: false })
    expect(a.level).toBe('strong')
  })

  it('repeated identical calls with no change are not progress', () => {
    const call = rec('read', { outcomeKind: 'read' })
    const facts = { toolCalls: [call], planStepChanged: false, verificationEvidenceAdded: false, databaseObjectChanged: false, testFailuresReduced: false, firstEvidence: false, submitSucceeded: false, firstNewRead: false, newErrorCategory: false, toolCategorySwitched: false, compactionSucceeded: false, textGrowthOnly: false }
    const first = assessProgress(facts)
    const second = assessProgress(facts, first.fingerprint)
    expect(first.level).toBe('none')
    expect(second.repeatedFingerprint).toBe(true)
  })

  it('text growth alone is not progress', () => {
    const a = assessProgress({ toolCalls: [], planStepChanged: false, verificationEvidenceAdded: false, databaseObjectChanged: false, testFailuresReduced: false, firstEvidence: false, submitSucceeded: false, firstNewRead: false, newErrorCategory: false, toolCategorySwitched: false, compactionSucceeded: false, textGrowthOnly: true })
    expect(a.level).toBe('none')
  })

  it('plan step change is strong progress', () => {
    const a = assessProgress({ toolCalls: [], planStepChanged: true, verificationEvidenceAdded: true, databaseObjectChanged: true, testFailuresReduced: false, firstEvidence: false, submitSucceeded: false, firstNewRead: false, newErrorCategory: false, toolCategorySwitched: false, compactionSucceeded: false, textGrowthOnly: false })
    expect(a.level).toBe('strong')
  })

  it('first new read is weak progress', () => {
    const a = assessProgress({ toolCalls: [], planStepChanged: false, verificationEvidenceAdded: false, databaseObjectChanged: false, testFailuresReduced: false, firstEvidence: false, submitSucceeded: false, firstNewRead: true, newErrorCategory: false, toolCategorySwitched: false, compactionSucceeded: false, textGrowthOnly: false })
    expect(a.level).toBe('weak')
  })
})
