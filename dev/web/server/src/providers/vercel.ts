import type { ProviderPlugin } from './types.js'

export const id = 'vercel'
export const name = 'Vercel'
export const baseUrl = 'https://api.vercel.com/v1/'
export const envKey = 'VERCEL_API_KEY'
export const desc = 'Vercel AI 模型'

export const plugin: ProviderPlugin = {
  id, name, baseUrl, envKey, desc, format: 'openai',
  models: [
    { id: 'vercel/auto', name: 'Auto', capabilities: { context_window: 128000, supports_tool_call: true } },
  ],
  getApiKey: () => process.env[envKey] || null,
}
