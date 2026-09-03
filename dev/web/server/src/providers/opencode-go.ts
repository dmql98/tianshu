import type { ProviderPlugin } from './types.js'

export const id = 'opencode-go'
export const name = 'OpenCode Go'
export const baseUrl = 'https://opencode.ai/zen/go/v1/'
export const envKey = 'OPENCODE_API_KEY'
export const desc = 'OpenCode 订阅服务'

// 价目表不再内嵌插件（避免两处数据源），统一走 provider 目录下的 pricing.json。
export const plugin: ProviderPlugin = {
  id, name, baseUrl, envKey, desc, format: 'openai',
  models: [
    { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', capabilities: { context_window: 1000000, max_output: 384000, supports_tool_call: true, supports_thinking: true } },
    { id: 'qwen3.7-plus', name: 'Qwen3.7 Plus', capabilities: { context_window: 1000000, max_output: 384000, supports_tool_call: true, supports_thinking: true } },
    { id: 'minimax-m2.5', name: 'MiniMax-M2.5', capabilities: { context_window: 204800, max_output: 65536, supports_tool_call: true, supports_thinking: true } },
  ],
  getApiKey: () => process.env[envKey] || null,
}
