export interface InsightEvent {
  type: 'high_frequency' | 'self_correction' | 'repeated_pattern'
  confidence: number
  description: string
  session_id: string
  agent_id: string
}

export interface ToolCallRecord {
  toolName: string
  hasError: boolean
  error?: string
  args?: string
}

export interface DetectOptions {
  window: number
  errorRateThreshold: number
  repetitionCount: number
  highFreqMinCalls: number
  highFreqMaxUnique: number
}

const defaultOptions: DetectOptions = {
  window: 8,
  errorRateThreshold: 0.5,
  repetitionCount: 3,
  highFreqMinCalls: 6,
  highFreqMaxUnique: 2,
}

export function detectInsight(toolCallHistory: ToolCallRecord[], sessionId: string, agentId: string, opts?: Partial<DetectOptions>): InsightEvent | null {
  const { window, errorRateThreshold, repetitionCount, highFreqMinCalls, highFreqMaxUnique } = { ...defaultOptions, ...opts }

  if (toolCallHistory.length < 4) return null

  const recent = toolCallHistory.slice(-window)
  const names = recent.map(r => r.toolName)

  const errorRate = recent.filter(r => r.hasError).length / recent.length
  if (errorRate > errorRateThreshold) {
    return {
      type: 'self_correction',
      confidence: Math.min(errorRate, 0.95),
      description: `High error rate (${(errorRate * 100).toFixed(0)}%) in recent tool calls, suggesting exploratory behavior`,
      session_id: sessionId,
      agent_id: agentId,
    }
  }

  if (detectRepeatingPattern(names, repetitionCount)) {
    return {
      type: 'repeated_pattern',
      confidence: 0.7,
      description: `Repeating tool pattern detected: ${names.slice(0, 4).join(' -> ')}`,
      session_id: sessionId,
      agent_id: agentId,
    }
  }

  if (names.length >= highFreqMinCalls) {
    const set = new Set(names)
    if (set.size <= highFreqMaxUnique) {
      return {
        type: 'high_frequency',
        confidence: 0.6,
        description: `High frequency usage of ${[...set].join(', ')} (${names.length} calls)`,
        session_id: sessionId,
        agent_id: agentId,
      }
    }
  }

  return null
}

function detectRepeatingPattern(names: string[], minRepeat: number): boolean {
  for (let len = 2; len <= Math.floor(names.length / 2); len++) {
    const pattern = names.slice(0, len)
    let matches = 0
    for (let i = 0; i <= names.length - len; i += len) {
      if (names.slice(i, i + len).every((n, j) => n === pattern[j])) {
        matches++
      }
    }
    if (matches >= minRepeat) return true
  }
  return false
}
