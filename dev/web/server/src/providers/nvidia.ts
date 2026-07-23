import type { ProviderPlugin } from './types.js'

export const id = 'nvidia'
export const name = 'NVIDIA'
export const baseUrl = 'https://integrate.api.nvidia.com/v1/'
export const envKey = 'NVIDIA_API_KEY'
export const desc = 'NVIDIA NIM 推理'

export const plugin: ProviderPlugin = {
  id, name, baseUrl, envKey, desc, format: 'openai',
  models: [
    { id: 'moonshotai/kimi-k2.6', name: 'Kimi K2.6', capabilities: { context_window: 262144, max_output: 16384, supports_vision: true, supports_tool_call: true, supports_thinking: true } },
    { id: 'meta/llama-4-maverick-17b', name: 'Llama 4 Maverick 17B', capabilities: { context_window: 131072, max_output: 4096, supports_vision: true, supports_tool_call: true } },
    { id: 'baai/bge-m3', name: 'BGE M3', capabilities: { context_window: 8192, max_output: 1024 } },
  ],
  getApiKey: () => process.env[envKey] || null,
}
