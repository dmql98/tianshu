import type { ProviderPlugin } from './types.js'

export const id = 'openrouter'
export const name = 'OpenRouter'
export const baseUrl = 'https://openrouter.ai/api/v1/'
export const envKey = 'OPENROUTER_API_KEY'
export const desc = '多模型聚合平台'

export const plugin: ProviderPlugin = {
  id, name, baseUrl, envKey, desc, format: 'openai',
  models: [
    { id: 'openrouter/auto', name: 'Auto (best available)', capabilities: { context_window: 128000, supports_tool_call: true } },
  ],
  getApiKey: () => process.env[envKey] || null,
}
