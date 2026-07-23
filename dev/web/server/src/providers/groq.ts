import type { ProviderPlugin } from './types.js'

export const id = 'groq'
export const name = 'Groq'
export const baseUrl = 'https://api.groq.com/openai/v1/'
export const envKey = 'GROQ_API_KEY'
export const desc = '高速推理服务'

export const plugin: ProviderPlugin = {
  id, name, baseUrl, envKey, desc, format: 'openai',
  models: [
    { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B', capabilities: { context_window: 128000, max_output: 32768, supports_tool_call: true } },
    { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B', capabilities: { context_window: 128000, max_output: 8192, supports_tool_call: true } },
    { id: 'deepseek-r1-distill-llama-70b', name: 'DeepSeek R1 Distill 70B', capabilities: { context_window: 128000, max_output: 16384, supports_thinking: true } },
    { id: 'mixtral-8x7b-32768', name: 'Mixtral 8x7B', capabilities: { context_window: 32768, max_output: 4096, supports_tool_call: true } },
    { id: 'gemma2-9b-it', name: 'Gemma 2 9B', capabilities: { context_window: 8192, max_output: 4096 } },
  ],
  getApiKey: () => process.env[envKey] || null,
}
