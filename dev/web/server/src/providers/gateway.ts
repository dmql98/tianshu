import type { ProviderPlugin } from './types.js'

export const id = 'gateway'
export const name = 'Vercel AI Gateway'
export const baseUrl = ''
export const envKey = 'AI_GATEWAY_API_KEY'
export const desc = 'Vercel AI 网关'

export const plugin: ProviderPlugin = {
  id, name, baseUrl, envKey, desc, format: 'openai',
  models: [
    { id: 'xai/grok-4.1-fast-reasoning', name: 'Grok 4.1 Fast Reasoning', capabilities: { context_window: 1000000, max_output: 131072, supports_vision: true, supports_tool_call: true, supports_thinking: true } },
    { id: 'openai/gpt-5.2', name: 'GPT-5.2', capabilities: { context_window: 400000, max_output: 16384, supports_vision: true, supports_tool_call: true, supports_thinking: true } },
  ],
  getApiKey: () => process.env[envKey] || null,
}
