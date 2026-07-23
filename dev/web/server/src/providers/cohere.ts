import type { ProviderPlugin } from './types.js'

export const id = 'cohere'
export const name = 'Cohere'
export const baseUrl = 'https://api.cohere.ai/v1/'
export const envKey = 'COHERE_API_KEY'
export const desc = 'Cohere 系列模型'

export const plugin: ProviderPlugin = {
  id, name, baseUrl, envKey, desc, format: 'openai',
  models: [
    { id: 'command-r-plus-08-2024', name: 'Command R+', capabilities: { context_window: 128000, max_output: 4096, supports_tool_call: true } },
    { id: 'command-r-08-2024', name: 'Command R', capabilities: { context_window: 128000, max_output: 4096, supports_tool_call: true } },
    { id: 'command-a-03-2025', name: 'Command A', capabilities: { context_window: 256000, max_output: 8192, supports_tool_call: true, supports_vision: true } },
  ],
  getApiKey: () => process.env[envKey] || null,
}
