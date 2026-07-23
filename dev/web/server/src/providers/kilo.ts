import type { ProviderPlugin } from './types.js'

export const id = 'kilo'
export const name = 'Kilo Gateway'
export const baseUrl = 'https://api.kilo.ai/api/gateway/'
export const envKey = 'KILO_API_KEY'
export const desc = 'Kilo AI 网关'

export const plugin: ProviderPlugin = {
  id, name, baseUrl, envKey, desc, format: 'openai',
  models: [
    { id: 'inclusionai/ling-2.6-1t', name: 'Ling 2.6 1T', capabilities: { context_window: 262144, max_output: 8192, supports_tool_call: true } },
    { id: 'inclusionai/ring-2.6-1t', name: 'Ring 2.6 1T', capabilities: { context_window: 262144, max_output: 8192, supports_tool_call: true, supports_thinking: true } },
  ],
  getApiKey: () => process.env[envKey] || null,
}
