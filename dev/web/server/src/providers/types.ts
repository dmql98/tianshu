export interface ModelCapabilities {
  context_window: number
  max_output?: number
  supports_vision?: boolean
  supports_tool_call?: boolean
  supports_thinking?: boolean
  cost_input?: number
  cost_output?: number
}

export interface ModelDefinition {
  id: string
  name: string
  capabilities: ModelCapabilities
}

export type ProviderFormat = 'openai' | 'anthropic' | 'gemini'

export interface ProviderPlugin {
  id: string
  name: string
  baseUrl: string
  envKey: string
  desc: string
  format: ProviderFormat
  models: ModelDefinition[]
  getApiKey: () => string | null
}
