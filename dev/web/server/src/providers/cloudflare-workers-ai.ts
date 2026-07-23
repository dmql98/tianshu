import type { ProviderPlugin } from './types.js'

export const id = 'cloudflare-workers-ai'
export const name = 'Cloudflare Workers AI'
export const baseUrl = 'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1/'
export const envKey = 'CLOUDFLARE_API_KEY'
export const desc = 'Cloudflare Workers AI 模型'

export const plugin: ProviderPlugin = {
  id, name, baseUrl, envKey, desc, format: 'openai',
  models: [
    { id: '@cf/moonshotai/kimi-k2.7-code', name: 'Kimi K2.7 Code', capabilities: { context_window: 262144, max_output: 16384, supports_vision: true, supports_tool_call: true, supports_thinking: true } },
    { id: '@cf/meta/llama-4-maverick-17b', name: 'Llama 4 Maverick 17B', capabilities: { context_window: 131072, max_output: 4096, supports_vision: true, supports_tool_call: true } },
    { id: '@cf/deepseek-ai/deepseek-r1', name: 'DeepSeek R1', capabilities: { context_window: 32768, max_output: 8192, supports_thinking: true } },
  ],
  getApiKey: () => process.env[envKey] || null,
}
