export const STRATEGIES = [
  'Read Only',
  'Ask Every Change',
  'Ask Risky',
  'Auto in Workspace',
  'Auto Approve',
] as const

export type Strategy = typeof STRATEGIES[number]
export type LegacyStrategy = 'Plan' | 'Ask' | 'Bypass'
export type StrategyInput = Strategy | LegacyStrategy

const LEGACY_STRATEGY_MAP: Record<LegacyStrategy, Strategy> = {
  Plan: 'Read Only',
  Ask: 'Ask Risky',
  Bypass: 'Auto Approve',
}

export function normalizeStrategy(
  value: string | null | undefined,
  fallback: Strategy = 'Read Only',
): Strategy {
  if (STRATEGIES.includes(value as Strategy)) return value as Strategy
  if (value && value in LEGACY_STRATEGY_MAP) return LEGACY_STRATEGY_MAP[value as LegacyStrategy]
  return fallback
}

export function isStrategyInput(value: unknown): value is StrategyInput {
  return typeof value === 'string'
    && (STRATEGIES.includes(value as Strategy) || value in LEGACY_STRATEGY_MAP)
}

export type ToolApprovalDecision = 'allow' | 'ask' | 'deny'

/** Pure policy matrix for ordinary (non-control) tool calls. */
export function decideToolApproval(
  strategy: Strategy,
  tool: { dangerous: boolean; readOnly: boolean },
): ToolApprovalDecision {
  if (strategy === 'Read Only') return tool.readOnly ? 'allow' : 'deny'
  if (strategy === 'Ask Every Change') return tool.readOnly ? 'allow' : 'ask'
  if (strategy === 'Ask Risky') return tool.dangerous ? 'ask' : 'allow'
  return 'allow'
}
