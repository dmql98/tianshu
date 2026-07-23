import type { ProviderPlugin } from './types.js'

export const id = 'openai'
export const name = 'OpenAI'
export const baseUrl = 'https://api.openai.com/v1/'
export const envKey = 'OPENAI_API_KEY'
export const desc = 'GPT 系列模型'

export const plugin: ProviderPlugin = {
  id, name, baseUrl, envKey, desc, format: 'openai',
  models: [
    { id: 'gpt-4o', name: 'GPT-4o', capabilities: { context_window: 128000, max_output: 16384, supports_vision: true, supports_tool_call: true } },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini', capabilities: { context_window: 128000, max_output: 16384, supports_vision: true, supports_tool_call: true } },
    { id: 'o3', name: 'o3', capabilities: { context_window: 200000, max_output: 100000, supports_vision: true, supports_tool_call: true, supports_thinking: true } },
    { id: 'o4-mini', name: 'o4 Mini', capabilities: { context_window: 200000, max_output: 100000, supports_vision: true, supports_tool_call: true, supports_thinking: true } },
    { id: 'gpt-4.1', name: 'GPT-4.1', capabilities: { context_window: 1047000, max_output: 16384, supports_vision: true, supports_tool_call: true } },
    { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini', capabilities: { context_window: 1047000, max_output: 16384, supports_vision: true, supports_tool_call: true } },
    { id: 'gpt-4.1-nano', name: 'GPT-4.1 Nano', capabilities: { context_window: 1047000, max_output: 16384, supports_tool_call: true } },
  ],
  getApiKey: () => process.env[envKey] || null,
}
