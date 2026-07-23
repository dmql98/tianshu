import type { ProviderPlugin } from './types.js'

export const id = 'azure'
export const name = 'Azure'
export const baseUrl = 'https://{resource}.openai.azure.com/v1/'
export const envKey = 'AZURE_API_KEY'
export const desc = 'Azure OpenAI 服务'

export const plugin: ProviderPlugin = {
  id, name, baseUrl, envKey, desc, format: 'openai',
  models: [
    { id: 'gpt-4o', name: 'GPT-4o', capabilities: { context_window: 128000, max_output: 16384, supports_vision: true, supports_tool_call: true } },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini', capabilities: { context_window: 128000, max_output: 16384, supports_vision: true, supports_tool_call: true } },
    { id: 'o3', name: 'o3', capabilities: { context_window: 200000, max_output: 100000, supports_tool_call: true, supports_thinking: true } },
    { id: 'codex-mini', name: 'Codex Mini', capabilities: { context_window: 200000, max_output: 16384, supports_tool_call: true, supports_thinking: true } },
  ],
  getApiKey: () => process.env[envKey] || null,
}
