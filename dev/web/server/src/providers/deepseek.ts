import type { ProviderPlugin } from './types.js'

export const id = 'deepseek'
export const name = 'DeepSeek'
export const baseUrl = 'https://api.deepseek.com/v1/'
export const envKey = 'DEEPSEEK_API_KEY'
export const desc = 'DeepSeek 系列模型'

export const plugin: ProviderPlugin = {
  id, name, baseUrl, envKey, desc, format: 'openai',
  models: [
    { id: 'deepseek-chat', name: 'DeepSeek V3', capabilities: { context_window: 64000, max_output: 8192, supports_tool_call: true } },
    { id: 'deepseek-reasoner', name: 'DeepSeek R1', capabilities: { context_window: 64000, max_output: 8192, supports_tool_call: true, supports_thinking: true } },
  ],
  getApiKey: () => process.env[envKey] || null,
}
