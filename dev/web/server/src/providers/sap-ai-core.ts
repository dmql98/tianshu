import type { ProviderPlugin } from './types.js'

export const id = 'sap-ai-core'
export const name = 'SAP AI Core'
export const baseUrl = ''
export const envKey = 'AICORE_SERVICE_KEY'
export const desc = 'SAP AI Core 模型'

export const plugin: ProviderPlugin = {
  id, name, baseUrl, envKey, desc, format: 'openai',
  models: [
    { id: 'anthropic--claude-4.8-opus', name: 'Claude 4.8 Opus', capabilities: { context_window: 1000000, max_output: 8192, supports_vision: true, supports_tool_call: true, supports_thinking: true } },
    { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash Lite', capabilities: { context_window: 1048576, max_output: 8192, supports_vision: true, supports_tool_call: true, supports_thinking: true } },
  ],
  getApiKey: () => process.env[envKey] || null,
}
