import type { ProviderPlugin } from './types.js'

export const id = 'openai-compatible'
export const name = 'OpenAI 兼容'
export const baseUrl = ''
export const envKey = 'OPENAI_COMPATIBLE_API_KEY'
export const desc = '通用 OpenAI 兼容接口'

export const plugin: ProviderPlugin = {
  id, name, baseUrl, envKey, desc, format: 'openai',
  models: [
    { id: 'default', name: '默认模型', capabilities: { context_window: 128000, max_output: 4096, supports_tool_call: true } },
  ],
  getApiKey: () => null,
}
