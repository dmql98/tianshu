import type { ProviderPlugin } from './types.js'

export const id = 'togetherai'
export const name = 'Together AI'
export const baseUrl = 'https://api.together.xyz/v1/'
export const envKey = 'TOGETHER_API_KEY'
export const desc = '开源模型托管'

export const plugin: ProviderPlugin = {
  id, name, baseUrl, envKey, desc, format: 'openai',
  models: [
    { id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', name: 'Llama 3.3 70B', capabilities: { context_window: 131072, max_output: 4096, supports_tool_call: true } },
    { id: 'deepseek-ai/DeepSeek-R1', name: 'DeepSeek R1', capabilities: { context_window: 128000, max_output: 8192, supports_thinking: true } },
    { id: 'Qwen/Qwen2.5-72B-Instruct-Turbo', name: 'Qwen 2.5 72B', capabilities: { context_window: 131072, max_output: 4096, supports_tool_call: true } },
    { id: 'mistralai/Mixtral-8x22B-Instruct-v0.1', name: 'Mixtral 8x22B', capabilities: { context_window: 65536, max_output: 4096, supports_tool_call: true } },
  ],
  getApiKey: () => process.env[envKey] || null,
}
