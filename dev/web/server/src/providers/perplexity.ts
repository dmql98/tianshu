import type { ProviderPlugin } from './types.js'

export const id = 'perplexity'
export const name = 'Perplexity'
export const baseUrl = 'https://api.perplexity.ai/v1/'
export const envKey = 'PERPLEXITY_API_KEY'
export const desc = 'Perplexity 搜索增强模型'

export const plugin: ProviderPlugin = {
  id, name, baseUrl, envKey, desc, format: 'openai',
  models: [
    { id: 'sonar-reasoning-pro', name: 'Sonar Reasoning Pro', capabilities: { context_window: 128000, max_output: 8192, supports_vision: true, supports_thinking: true } },
    { id: 'sonar-pro', name: 'Sonar Pro', capabilities: { context_window: 128000, max_output: 8192, supports_vision: true } },
    { id: 'sonar', name: 'Sonar', capabilities: { context_window: 128000, max_output: 4096 } },
  ],
  getApiKey: () => process.env[envKey] || null,
}
