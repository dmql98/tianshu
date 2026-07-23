import type { ProviderPlugin } from './types.js'

export const id = 'xai'
export const name = 'xAI'
export const baseUrl = 'https://api.x.ai/v1/'
export const envKey = 'XAI_API_KEY'
export const desc = 'Grok 系列模型'

export const plugin: ProviderPlugin = {
  id, name, baseUrl, envKey, desc, format: 'openai',
  models: [
    { id: 'grok-3', name: 'Grok 3', capabilities: { context_window: 131072, max_output: 8192, supports_tool_call: true, supports_thinking: true } },
    { id: 'grok-3-mini', name: 'Grok 3 Mini', capabilities: { context_window: 131072, max_output: 8192, supports_tool_call: true, supports_thinking: true } },
    { id: 'grok-2', name: 'Grok 2', capabilities: { context_window: 131072, max_output: 8192, supports_tool_call: true } },
  ],
  getApiKey: () => process.env[envKey] || null,
}
