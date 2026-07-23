import type { ProviderPlugin } from './types.js'

export const id = 'google-vertex'
export const name = 'Google Vertex AI'
export const baseUrl = ''
export const envKey = 'GOOGLE_VERTEX_PROJECT'
export const desc = 'Google Vertex AI 模型'

export const plugin: ProviderPlugin = {
  id, name, baseUrl, envKey, desc, format: 'gemini',
  models: [
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', capabilities: { context_window: 1048576, max_output: 65536, supports_vision: true, supports_tool_call: true, supports_thinking: true } },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', capabilities: { context_window: 1048576, max_output: 8192, supports_vision: true, supports_tool_call: true, supports_thinking: true } },
    { id: 'claude-sonnet-4@20250514', name: 'Claude Sonnet 4 (Vertex)', capabilities: { context_window: 200000, max_output: 8192, supports_vision: true, supports_tool_call: true, supports_thinking: true } },
  ],
  getApiKey: () => process.env[envKey] || null,
}
