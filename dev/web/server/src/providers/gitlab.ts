import type { ProviderPlugin } from './types.js'

export const id = 'gitlab'
export const name = 'GitLab Duo'
export const baseUrl = 'https://gitlab.com'
export const envKey = 'GITLAB_TOKEN'
export const desc = 'GitLab Duo AI 模型'

export const plugin: ProviderPlugin = {
  id, name, baseUrl, envKey, desc, format: 'openai',
  models: [
    { id: 'duo-chat-opus-4-8', name: 'Claude Opus 4.8', capabilities: { context_window: 1000000, max_output: 8192, supports_vision: true, supports_tool_call: true, supports_thinking: true } },
    { id: 'duo-chat-opus-4-5', name: 'Claude Opus 4.5', capabilities: { context_window: 200000, max_output: 8192, supports_vision: true, supports_tool_call: true, supports_thinking: true } },
  ],
  getApiKey: () => process.env[envKey] || null,
}
