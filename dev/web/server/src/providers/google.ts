import type { ProviderPlugin } from './types.js'

export const id = 'google'
export const name = 'Google'
export const baseUrl = 'https://generativelanguage.googleapis.com/v1/'
export const envKey = 'GOOGLE_GENERATIVE_AI_API_KEY'
export const desc = 'Gemini 系列模型'

export const plugin: ProviderPlugin = {
  id, name, baseUrl, envKey, desc, format: 'gemini',
  models: [
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', capabilities: { context_window: 1048576, max_output: 8192, supports_vision: true, supports_tool_call: true, supports_thinking: true } },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', capabilities: { context_window: 1048576, max_output: 65536, supports_vision: true, supports_tool_call: true, supports_thinking: true } },
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', capabilities: { context_window: 1048576, max_output: 8192, supports_vision: true, supports_tool_call: true } },
  ],
  getApiKey: () => process.env[envKey] || null,
}
