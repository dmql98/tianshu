import type { ProviderPlugin } from './types.js'

export const id = 'anthropic'
export const name = 'Anthropic'
export const baseUrl = 'https://api.anthropic.com/v1/'
export const envKey = 'ANTHROPIC_API_KEY'
export const desc = 'Claude 系列模型'

export const plugin: ProviderPlugin = {
  id, name, baseUrl, envKey, desc, format: 'anthropic',
  models: [
    { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', capabilities: { context_window: 200000, max_output: 8192, supports_vision: true, supports_tool_call: true, supports_thinking: true } },
    { id: 'claude-3-5-sonnet-latest', name: 'Claude 3.5 Sonnet', capabilities: { context_window: 200000, max_output: 8192, supports_vision: true, supports_tool_call: true, supports_thinking: true } },
    { id: 'claude-3-5-haiku-latest', name: 'Claude 3.5 Haiku', capabilities: { context_window: 200000, max_output: 8192, supports_vision: true, supports_tool_call: true } },
    { id: 'claude-3-opus-latest', name: 'Claude 3 Opus', capabilities: { context_window: 200000, max_output: 4096, supports_vision: true, supports_tool_call: true } },
  ],
  getApiKey: () => process.env[envKey] || null,
}
