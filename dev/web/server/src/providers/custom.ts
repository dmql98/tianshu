import type { ProviderPlugin } from './types.js'

export const id = 'custom'
export const name = '自定义'
export const baseUrl = ''
export const envKey = 'CUSTOM_API_KEY'
export const desc = '自定义服务商（填写 base URL 和 API key）'

export const plugin: ProviderPlugin = {
  id, name, baseUrl, envKey, desc, format: 'openai',
  models: [
    { id: 'custom-model', name: '自定义模型', capabilities: { context_window: 128000, max_output: 4096, supports_tool_call: true } },
  ],
  getApiKey: () => null,
}
