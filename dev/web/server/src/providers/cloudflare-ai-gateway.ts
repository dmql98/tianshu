import type { ProviderPlugin } from './types.js'

export const id = 'cloudflare-ai-gateway'
export const name = 'Cloudflare AI Gateway'
export const baseUrl = 'https://gateway.ai.cloudflare.com/v1/{account}/{gateway}/'
export const envKey = 'CLOUDFLARE_API_TOKEN'
export const desc = 'Cloudflare AI 网关'

export const plugin: ProviderPlugin = {
  id, name, baseUrl, envKey, desc, format: 'openai',
  models: [
    { id: 'openai/gpt-4o', name: 'GPT-4o', capabilities: { context_window: 128000, max_output: 16384, supports_vision: true, supports_tool_call: true } },
    { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4', capabilities: { context_window: 200000, max_output: 8192, supports_vision: true, supports_tool_call: true, supports_thinking: true } },
    { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash', capabilities: { context_window: 1048576, max_output: 8192, supports_vision: true, supports_tool_call: true, supports_thinking: true } },
  ],
  getApiKey: () => process.env[envKey] || null,
}
