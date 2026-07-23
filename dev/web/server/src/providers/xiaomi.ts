import type { ProviderPlugin } from './types.js'

export const id = 'xiaomi'
export const name = 'Xiaomi'
export const baseUrl = 'https://api.xiaomimimo.com/v1/'
export const envKey = 'XIAOMI_API_KEY'
export const desc = '小米 MiMo 系列'

export const plugin: ProviderPlugin = {
  id, name, baseUrl, envKey, desc, format: 'openai',
  models: [
    { id: 'mimo-v2.5-pro-ultraspeed', name: 'MiMo-V2.5-Pro-UltraSpeed', capabilities: { context_window: 1048576, max_output: 131072, supports_vision: true, supports_tool_call: true, supports_thinking: true } },
    { id: 'mimo-v2.5', name: 'MiMo-V2.5', capabilities: { context_window: 1048576, max_output: 131072, supports_vision: true, supports_tool_call: true, supports_thinking: true } },
    { id: 'mimo-v2-pro', name: 'MiMo-V2-Pro', capabilities: { context_window: 1048576, max_output: 131072, supports_tool_call: true, supports_thinking: true } },
  ],
  getApiKey: () => process.env[envKey] || null,
}
