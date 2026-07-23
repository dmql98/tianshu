import type { ProviderPlugin } from './types.js'

export const id = 'mistral'
export const name = 'Mistral'
export const baseUrl = 'https://api.mistral.ai/v1/'
export const envKey = 'MISTRAL_API_KEY'
export const desc = 'Mistral 系列模型'

export const plugin: ProviderPlugin = {
  id, name, baseUrl, envKey, desc, format: 'openai',
  models: [
    { id: 'mistral-large-latest', name: 'Mistral Large', capabilities: { context_window: 128000, max_output: 8192, supports_tool_call: true, supports_vision: true } },
    { id: 'mistral-small-latest', name: 'Mistral Small', capabilities: { context_window: 32000, max_output: 8192, supports_tool_call: true } },
    { id: 'codestral-latest', name: 'Codestral', capabilities: { context_window: 256000, max_output: 8192, supports_tool_call: true } },
    { id: 'pixtral-large-latest', name: 'Pixtral Large', capabilities: { context_window: 131072, max_output: 8192, supports_vision: true, supports_tool_call: true } },
  ],
  getApiKey: () => process.env[envKey] || null,
}
