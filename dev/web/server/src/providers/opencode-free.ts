import type { ProviderPlugin } from './types.js'

export const id = 'opencode-free'
export const name = 'OpenCode Free'
export const baseUrl = 'https://opencode.ai/zen/v1'
export const envKey = 'OPENCODE_API_KEY'
export const desc = 'OpenCode 官方 Zen 网关免费档（匿名公开 token，模型列表会浮动）'

// 免费档无需真实密钥：匿名公开 token。
// 注意：上下文长度为保守估计值，实际以 models.dev 目录校准为准；
// 免费模型列表由官方 /zen/v1/models 动态调整，此处为当前可用快照。
export const plugin: ProviderPlugin = {
  id, name, baseUrl, envKey, desc, format: 'openai',
  models: [
    { id: 'big-pickle', name: 'big-pickle', capabilities: { context_window: 200000, supports_tool_call: true } },
    { id: 'mimo-v2.5-free', name: 'mimo-v2.5-free', capabilities: { context_window: 200000, supports_tool_call: true } },
    { id: 'ling-3.0-flash-fin-free', name: 'ling-3.0-flash-fin-free', capabilities: { context_window: 200000, supports_tool_call: true } },
    { id: 'nemotron-3.5-lightning-free', name: 'nemotron-3.5-lightning-free', capabilities: { context_window: 200000, supports_tool_call: true } },
    { id: 'laguna-s-2.1-free', name: 'laguna-s-2.1-free', capabilities: { context_window: 200000, supports_tool_call: true } },
  ],
  getApiKey: () => 'public',
}