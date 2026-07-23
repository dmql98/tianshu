import type { ProviderPlugin } from './types.js'

export const id = 'github-copilot'
export const name = 'GitHub Copilot'
export const baseUrl = 'https://api.githubcopilot.com/'
export const envKey = 'GITHUB_TOKEN'
export const desc = 'GitHub AI 模型'

export const plugin: ProviderPlugin = {
  id, name, baseUrl, envKey, desc, format: 'openai',
  models: [
    { id: 'gpt-4o-copilot', name: 'GPT-4o (Copilot)', capabilities: { context_window: 128000, max_output: 16384, supports_vision: true, supports_tool_call: true } },
    { id: 'claude-sonnet-copilot', name: 'Claude Sonnet (Copilot)', capabilities: { context_window: 200000, max_output: 8192, supports_vision: true, supports_tool_call: true } },
  ],
  getApiKey: () => process.env[envKey] || null,
}
