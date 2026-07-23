import { sessionStore } from '../db/sessionStore.js'

export type Strategy = 'Plan' | 'Ask' | 'Bypass'

export interface SessionState {
  current_strategy: Strategy
  strategy_modified_by: 'user' | 'system'
  approved_tools: Set<string>
}

const states = new Map<string, SessionState>()

export function getSessionState(sessionId: string): SessionState {
  let state = states.get(sessionId)
  if (!state) {
    const db = sessionStore.getById(sessionId)
    state = {
      current_strategy: (db?.current_strategy as Strategy) || 'Plan',
      strategy_modified_by: 'system',
      approved_tools: new Set(),
    }
    states.set(sessionId, state)
  }
  return state
}

export function setSessionStrategy(sessionId: string, strategy: Strategy, modifiedBy: 'user' | 'system'): SessionState {
  const state = getSessionState(sessionId)
  state.current_strategy = strategy
  state.strategy_modified_by = modifiedBy
  return state
}

export function approveToolForSession(sessionId: string, toolName: string): void {
  getSessionState(sessionId).approved_tools.add(toolName)
}

export function isToolApprovedForSession(sessionId: string, toolName: string): boolean {
  return getSessionState(sessionId).approved_tools.has(toolName)
}

export function removeSessionState(sessionId: string): void {
  states.delete(sessionId)
}
