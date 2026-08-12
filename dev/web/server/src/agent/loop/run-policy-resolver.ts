import {
  type CharacterRunPolicy,
  type RunPolicySnapshot,
  type SystemRunPolicy,
} from './run-policy.js'

/**
 * Pure resolver: system boundary + character preference → effective run policy.
 * The result is frozen onto a Run at creation (see RUN_LIMIT_POLICY_PLAN §5).
 *
 * Rules:
 * - Character preference is a request, never a hard limit. It is clamped by the
 *   system boundary in the conservative direction.
 * - `softTurns` is clamped to `1..maxAbsoluteTurnsPerRun`.
 * - `graceTurns` is clamped to `0..min(maxGraceTurns, maxAbsolute - softTurns)`.
 * - absolute = min(soft + grace, maxAbsolute).
 * - autoContinuation requires BOTH the system switch and the character pref.
 * - maxAutoContinuations only shrinks the system value.
 */

export function resolveRunPolicy(
  system: SystemRunPolicy,
  character: CharacterRunPolicy | undefined,
): RunPolicySnapshot {
  const maxAbs = system.maxAbsoluteTurnsPerRun

  let softTurns: number
  let graceTurns: number
  let absoluteTurns: number

  if (system.dynamicLimitEnabled) {
    const requestedSoft = character?.softTurns ?? system.defaultSoftTurns
    softTurns = clamp(requestedSoft, 1, maxAbs)
    const requestedGrace = character?.graceTurns ?? system.defaultGraceTurns
    const graceCap = Math.min(system.maxGraceTurns, Math.max(0, maxAbs - softTurns))
    graceTurns = clamp(requestedGrace, 0, graceCap)
    absoluteTurns = Math.min(softTurns + graceTurns, maxAbs)
  } else {
    // Dynamic limit off: degrade to a plain fixed hard cap.
    absoluteTurns = maxAbs
    softTurns = absoluteTurns
    graceTurns = 0
  }

  const characterAllows = character?.autoContinuation !== 'disabled'
  const autoContinuation = system.autoContinuationEnabled && characterAllows
  const maxAutoContinuations = Math.min(
    character?.maxAutoContinuations ?? system.maxAutoContinuations,
    system.maxAutoContinuations,
  )

  return {
    version: 1,
    policyVersion: system.version,
    system: {
      dynamicLimitEnabled: system.dynamicLimitEnabled,
      autoContinuationEnabled: system.autoContinuationEnabled,
      maxAbsoluteTurnsPerRun: system.maxAbsoluteTurnsPerRun,
      maxGraceTurns: system.maxGraceTurns,
      noProgressThreshold: system.noProgressThreshold,
      weakProgressThreshold: system.weakProgressThreshold,
      repeatedToolLoopThreshold: system.repeatedToolLoopThreshold,
      maxAutoContinuations: system.maxAutoContinuations,
      maxChainTurns: system.maxChainTurns,
      maxChainTokens: system.maxChainTokens,
      maxChainWallTimeMs: system.maxChainWallTimeMs,
    },
    character: {
      softTurns: character?.softTurns,
      graceTurns: character?.graceTurns,
      autoContinuation: character?.autoContinuation ?? 'inherit',
      maxAutoContinuations: character?.maxAutoContinuations,
    },
    effective: {
      softTurns,
      graceTurns,
      absoluteTurns,
      autoContinuation,
      maxAutoContinuations,
      maxChainTurns: system.maxChainTurns,
      maxChainTokens: system.maxChainTokens,
      maxChainWallTimeMs: system.maxChainWallTimeMs,
      noProgressThreshold: system.noProgressThreshold,
      weakProgressThreshold: system.weakProgressThreshold,
      repeatedToolLoopThreshold: system.repeatedToolLoopThreshold,
    },
  }
}

/**
 * When a continuation Run is created, inherit the chain root's safety boundary,
 * but never widen it: take the stricter (smaller) of the root snapshot and the
 * current system policy for every cap. Used to prevent a mid-chain config change
 * from relaxing limits on already-running work (§5.2).
 */
export function mergeStricterSystemCaps(
  root: RunPolicySnapshot,
  current: SystemRunPolicy,
): SystemRunPolicy {
  const currentNormalized: SystemRunPolicy = {
    ...current,
    dynamicLimitEnabled: root.system.dynamicLimitEnabled && current.dynamicLimitEnabled,
    autoContinuationEnabled: root.system.autoContinuationEnabled && current.autoContinuationEnabled,
    maxAbsoluteTurnsPerRun: Math.min(root.system.maxAbsoluteTurnsPerRun, current.maxAbsoluteTurnsPerRun),
    maxGraceTurns: Math.min(root.system.maxGraceTurns, current.maxGraceTurns),
    defaultSoftTurns: Math.min(root.effective.softTurns, current.defaultSoftTurns),
    defaultGraceTurns: Math.min(root.effective.graceTurns, current.defaultGraceTurns),
    noProgressThreshold: Math.min(root.system.noProgressThreshold, current.noProgressThreshold),
    weakProgressThreshold: Math.min(root.system.weakProgressThreshold, current.weakProgressThreshold),
    repeatedToolLoopThreshold: Math.min(root.system.repeatedToolLoopThreshold, current.repeatedToolLoopThreshold),
    maxAutoContinuations: Math.min(root.system.maxAutoContinuations, current.maxAutoContinuations),
    maxChainTurns: Math.min(root.system.maxChainTurns, current.maxChainTurns),
    maxChainTokens: Math.min(root.system.maxChainTokens, current.maxChainTokens),
    maxChainWallTimeMs: Math.min(root.system.maxChainWallTimeMs, current.maxChainWallTimeMs),
  }
  return currentNormalized
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
