import type { ProviderPlugin } from './types.js'

export const id = 'deepinfra'
export const name = 'Deep Infra'
export const baseUrl = 'https://api.deepinfra.com/v1/openai/'
export const envKey = 'DEEPINFRA_API_KEY'
export const desc = 'Deep Infra 推理服务'

export const plugin: ProviderPlugin = {
  id, name, baseUrl, envKey, desc, format: 'openai',
  models: [
    { id: 'meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8', name: 'Llama 4 Maverick 17B FP8', capabilities: { context_window: 1048576, max_output: 8192, supports_vision: true, supports_tool_call: true } },
    { id: 'meta-llama/Llama-4-Scout-17B-16E-Instruct', name: 'Llama 4 Scout 17B', capabilities: { context_window: 327680, max_output: 8192, supports_vision: true, supports_tool_call: true } },
    { id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', name: 'Llama 3.3 70B Turbo', capabilities: { context_window: 131072, max_output: 8192, supports_tool_call: true } },
  ],
  getApiKey: () => process.env[envKey] || null,
}
