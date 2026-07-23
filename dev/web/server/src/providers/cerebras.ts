import type { ProviderPlugin } from './types.js'

export const id = 'cerebras'
export const name = 'Cerebras'
export const baseUrl = 'https://api.cerebras.ai/v1/'
export const envKey = 'CEREBRAS_API_KEY'
export const desc = 'Cerebras 推理服务'

export const plugin: ProviderPlugin = {
  id, name, baseUrl, envKey, desc, format: 'openai',
  models: [
    { id: 'gemma-4-31b', name: 'Gemma 4 31B', capabilities: { context_window: 131072, max_output: 8192, supports_vision: true, supports_tool_call: true, supports_thinking: true } },
    { id: 'gpt-oss-120b', name: 'GPT OSS 120B', capabilities: { context_window: 131072, max_output: 8192, supports_tool_call: true, supports_thinking: true } },
  ],
  getApiKey: () => process.env[envKey] || null,
}
