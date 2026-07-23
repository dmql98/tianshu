import type { ProviderPlugin } from './types.js'

export const id = 'llmgateway'
export const name = 'LLM Gateway'
export const baseUrl = 'https://api.llmgateway.io/v1/'
export const envKey = 'LLMGATEWAY_API_KEY'
export const desc = 'LLM Gateway 聚合服务'

export const plugin: ProviderPlugin = {
  id, name, baseUrl, envKey, desc, format: 'openai',
  models: [
    { id: 'qwen-coder-plus', name: 'Qwen Coder Plus', capabilities: { context_window: 131072, max_output: 8192, supports_tool_call: true } },
    { id: 'mistral-large-latest', name: 'Mistral Large', capabilities: { context_window: 128000, max_output: 8192, supports_vision: true, supports_tool_call: true } },
    { id: 'qwen3-vl-235b-a22b-thinking', name: 'Qwen3 VL 235B', capabilities: { context_window: 131072, max_output: 8192, supports_vision: true, supports_tool_call: true, supports_thinking: true } },
  ],
  getApiKey: () => process.env[envKey] || null,
}
