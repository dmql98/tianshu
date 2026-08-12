/**
 * Run policy domain types, defaults and normalization.
 *
 * Three layers, from most authoritative to least:
 *   1. SystemRunPolicy — system safety boundary, stored in <TIANSHU_CONFIG_DIR>/config.json.
 *   2. CharacterRunPolicy — per-character execution preference, pinned in a character revision.
 *   3. RunPolicySnapshot — the resolved effective policy frozen onto a Run at creation.
 *
 * A role can only request MORE conservative values than the system boundary; it can
 * never widen the system caps. The single source of default constants lives here so
 * the config loader, resolver and tests all normalize against the same values.
 */

export const RUN_POLICY_VERSION = 1

export interface SystemRunPolicy {
  version: 1
  dynamicLimitEnabled: boolean
  autoContinuationEnabled: boolean

  defaultSoftTurns: number
  defaultGraceTurns: number
  maxAbsoluteTurnsPerRun: number
  maxGraceTurns: number

  noProgressThreshold: number
  weakProgressThreshold: number
  repeatedToolLoopThreshold: number

  maxAutoContinuations: number
  maxChainTurns: number
  maxChainTokens: number
  maxChainWallTimeMs: number
}

export const DEFAULT_SYSTEM_RUN_POLICY: SystemRunPolicy = {
  version: 1,
  dynamicLimitEnabled: true,
  autoContinuationEnabled: false,

  defaultSoftTurns: 50,
  defaultGraceTurns: 10,
  maxAbsoluteTurnsPerRun: 999,
  maxGraceTurns: 50,

  noProgressThreshold: 3,
  weakProgressThreshold: 5,
  repeatedToolLoopThreshold: 2,

  maxAutoContinuations: 2,
  maxChainTurns: 180,
  maxChainTokens: 500_000,
  maxChainWallTimeMs: 30 * 60 * 1000,
}

export type AutoContinuationPref = 'inherit' | 'enabled' | 'disabled'

export interface CharacterRunPolicy {
  version: 1
  softTurns?: number
  graceTurns?: number
  autoContinuation?: AutoContinuationPref
  maxAutoContinuations?: number
}

/** Run policy frozen at run creation. */
export interface RunPolicySnapshot {
  version: 1
  policyVersion: number

  system: {
    dynamicLimitEnabled: boolean
    autoContinuationEnabled: boolean
    maxAbsoluteTurnsPerRun: number
    maxGraceTurns: number
    noProgressThreshold: number
    weakProgressThreshold: number
    repeatedToolLoopThreshold: number
    maxAutoContinuations: number
    maxChainTurns: number
    maxChainTokens: number
    maxChainWallTimeMs: number
  }

  character: {
    softTurns?: number
    graceTurns?: number
    autoContinuation: AutoContinuationPref
    maxAutoContinuations?: number
  }

  effective: {
    softTurns: number
    graceTurns: number
    absoluteTurns: number
    autoContinuation: boolean
    maxAutoContinuations: number
    maxChainTurns: number
    maxChainTokens: number
    maxChainWallTimeMs: number
    noProgressThreshold: number
    weakProgressThreshold: number
    repeatedToolLoopThreshold: number
  }
}

function toInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  if (!Number.isInteger(value)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

function toBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/**
 * Normalize an untrusted system run policy payload. Missing fields, non-numeric,
 * NaN, fractional, negative or out-of-range values fall back to defaults; a
 * corrupted/old runPolicy never throws and never loses dataDir.
 */
export function normalizeSystemRunPolicy(input: unknown): SystemRunPolicy {
  const d = DEFAULT_SYSTEM_RUN_POLICY
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>

  const maxAbs = toInt(raw.maxAbsoluteTurnsPerRun, d.maxAbsoluteTurnsPerRun, 1, 999)

  // Invariants (see RUN_LIMIT_POLICY_PLAN §4.2):
  //   defaultSoftTurns <= maxAbsoluteTurnsPerRun
  //   maxGraceTurns    <= maxAbsoluteTurnsPerRun - 1 (grace 0 when absolute == 1)
  //   defaultGraceTurns <= maxGraceTurns
  let maxGrace = toInt(raw.maxGraceTurns, d.maxGraceTurns, 0, 999)
  maxGrace = Math.min(maxGrace, maxAbs - 1)
  if (maxAbs <= 1) maxGrace = 0

  let soft = toInt(raw.defaultSoftTurns, d.defaultSoftTurns, 1, 999)
  soft = Math.min(soft, maxAbs)

  let grace = toInt(raw.defaultGraceTurns, d.defaultGraceTurns, 0, 999)
  grace = Math.min(grace, maxGrace)

  return {
    version: 1,
    dynamicLimitEnabled: toBool(raw.dynamicLimitEnabled, d.dynamicLimitEnabled),
    autoContinuationEnabled: toBool(raw.autoContinuationEnabled, d.autoContinuationEnabled),

    defaultSoftTurns: soft,
    defaultGraceTurns: grace,
    maxAbsoluteTurnsPerRun: maxAbs,
    maxGraceTurns: maxGrace,

    noProgressThreshold: toInt(raw.noProgressThreshold, d.noProgressThreshold, 1, 100),
    weakProgressThreshold: toInt(raw.weakProgressThreshold, d.weakProgressThreshold, 1, 100),
    repeatedToolLoopThreshold: toInt(raw.repeatedToolLoopThreshold, d.repeatedToolLoopThreshold, 1, 100),

    maxAutoContinuations: toInt(raw.maxAutoContinuations, d.maxAutoContinuations, 0, 50),
    maxChainTurns: toInt(raw.maxChainTurns, d.maxChainTurns, 1, 1_000_000),
    maxChainTokens: toInt(raw.maxChainTokens, d.maxChainTokens, 1, 100_000_000),
    maxChainWallTimeMs: toInt(raw.maxChainWallTimeMs, d.maxChainWallTimeMs, 1, 1000 * 60 * 60 * 24),
  }
}

/**
 * Normalize a character-level run policy override. Unknown / malformed fields are
 * dropped (treated as "inherit system"). Version mismatch falls back to inherit.
 */
export function normalizeCharacterRunPolicy(input: unknown): CharacterRunPolicy | undefined {
  if (!input || typeof input !== 'object') return undefined
  const raw = input as Record<string, unknown>
  if (raw.version !== undefined && raw.version !== RUN_POLICY_VERSION) return undefined

  const out: CharacterRunPolicy = { version: 1 }
  const soft = toInt(raw.softTurns, -1, 1, 999)
  if (soft >= 0) out.softTurns = soft
  const grace = toInt(raw.graceTurns, -1, 0, 999)
  if (grace >= 0) out.graceTurns = grace
  if (raw.autoContinuation === 'enabled' || raw.autoContinuation === 'disabled' || raw.autoContinuation === 'inherit') {
    out.autoContinuation = raw.autoContinuation
  }
  const maxAuto = toInt(raw.maxAutoContinuations, -1, 0, 50)
  if (maxAuto >= 0) out.maxAutoContinuations = maxAuto

  const hasAny = out.softTurns !== undefined || out.graceTurns !== undefined
    || out.autoContinuation !== undefined || out.maxAutoContinuations !== undefined
  return hasAny ? out : undefined
}

/**
 * Two-stage legacy migration for `maxSteps`. Returns the character run policy a
 * legacy character should be treated as. Does NOT mutate anything — callers decide
 * whether to persist the migrated value.
 */
export function migrateCharacterRunPolicy(maxSteps: number | undefined, systemAbs: number): CharacterRunPolicy | undefined {
  if (maxSteps == null || !Number.isInteger(maxSteps)) return undefined
  if (maxSteps >= 1 && maxSteps <= 998) {
    return { version: 1, softTurns: maxSteps }
  }
  if (maxSteps >= 999) {
    return { version: 1, softTurns: systemAbs, graceTurns: 0 }
  }
  return undefined
}
