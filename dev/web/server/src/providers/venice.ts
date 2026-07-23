import type { ProviderPlugin } from './types.js'

export const id = 'venice'
export const name = 'Venice AI'
export const baseUrl = 'https://api.venice.ai/v1/'
export const envKey = 'VENICE_API_KEY'
export const desc = 'Venice AI 去中心化推理'

export const plugin: ProviderPlugin = {
  id, name, baseUrl, envKey, desc, format: 'openai',
  models: [
    { id: 'z-ai-glm-5-turbo', name: 'GLM 5 Turbo', capabilities: { context_window: 200000, max_output: 8192, supports_tool_call: true, supports_thinking: true } },
    { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', capabilities: { context_window: 1000000, max_output: 384000, supports_tool_call: true, supports_thinking: true } },
  ],
  getApiKey: () => process.env[envKey] || null,
}
