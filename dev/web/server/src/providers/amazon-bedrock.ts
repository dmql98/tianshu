import type { ProviderPlugin } from './types.js'

export const id = 'amazon-bedrock'
export const name = 'Amazon Bedrock'
export const baseUrl = ''
export const envKey = 'AWS_ACCESS_KEY_ID'
export const desc = 'AWS Bedrock 托管模型'

export const plugin: ProviderPlugin = {
  id, name, baseUrl, envKey, desc, format: 'openai',
  models: [
    { id: 'anthropic.claude-sonnet-4-5-v1', name: 'Claude Sonnet 4.5', capabilities: { context_window: 200000, max_output: 8192, supports_vision: true, supports_tool_call: true, supports_thinking: true } },
    { id: 'anthropic.claude-haiku-4-5-v1', name: 'Claude Haiku 4.5', capabilities: { context_window: 200000, max_output: 8192, supports_vision: true, supports_tool_call: true, supports_thinking: true } },
    { id: 'meta.llama4-maverick-17b', name: 'Llama 4 Maverick 17B', capabilities: { context_window: 131072, max_output: 4096, supports_vision: true, supports_tool_call: true } },
  ],
  getApiKey: () => process.env[envKey] || process.env['AWS_SECRET_ACCESS_KEY'] || null,
}
