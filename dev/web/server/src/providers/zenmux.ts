import type { ProviderPlugin } from './types.js'

export const id = 'zenmux'
export const name = 'ZenMux'
export const baseUrl = 'https://zenmux.ai/api/v1/'
export const envKey = 'ZENMUX_API_KEY'
export const desc = 'ZenMux 模型聚合'

export const plugin: ProviderPlugin = {
  id, name, baseUrl, envKey, desc, format: 'openai',
  models: [
    { id: 'inclusionai/ring-2.6-1t', name: 'Ring 2.6 1T', capabilities: { context_window: 262144, max_output: 8192, supports_tool_call: true, supports_thinking: true } },
    { id: 'inclusionai/ling-1t', name: 'Ling 1T', capabilities: { context_window: 128000, max_output: 8192, supports_tool_call: true } },
  ],
  getApiKey: () => process.env[envKey] || null,
}
