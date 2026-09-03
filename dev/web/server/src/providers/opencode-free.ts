import type { ProviderPlugin } from './types.js'

export const id = 'opencode-free'
export const name = 'OpenCode Free'
export const baseUrl = 'https://opencode.ai/zen/v1'
export const envKey = 'OPENCODE_API_KEY'
export const desc = 'OpenCode 官方 Zen 网关免费档（匿名公开 token，模型列表会浮动）'

// 免费档无需真实密钥：匿名公开 token。
// 注意：上下文长度为保守估计值，实际以 models.dev 目录校准为准；
// 免费模型列表由官方 /zen/v1/models 动态调整，此处为当前可用快照。
// 价目表（含免费标记与 ref 参考价）统一走 provider 目录下的 pricing.json，不内嵌插件。
const MODELS = [
  'claude-fable-5', 'claude-opus-5', 'claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6', 'claude-opus-4-5',
  'claude-sonnet-5', 'claude-sonnet-4-6', 'claude-sonnet-4-5', 'claude-sonnet-4', 'claude-haiku-4-5',
  'gemini-3.6-flash', 'gemini-3.7-flash', 'gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-3.1-pro', 'gemini-3-flash',
  'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.5-pro', 'gpt-5.4', 'gpt-5.4-pro', 'gpt-5.4-mini', 'gpt-5.4-nano',
  'gpt-5.3-codex-spark', 'gpt-5.3-codex', 'gpt-5.2', 'gpt-5.2-codex', 'gpt-5.1', 'gpt-5.1-codex-max', 'gpt-5.1-codex', 'gpt-5.1-codex-mini',
  'gpt-5', 'gpt-5-codex', 'gpt-5-nano',
  'grok-build-0.1', 'grok-4.6', 'grok-4.5',
  'muse-spark-1.2',
  'deepseek-v4-pro', 'deepseek-v4-flash',
  'glm-5.2', 'glm-5.1', 'glm-5',
  'minimax-m3', 'minimax-m2.7', 'minimax-m2.5',
  'kimi-k3', 'kimi-k2.7-code', 'kimi-k2.6', 'kimi-k2.5',
  'qwen3.6-plus', 'qwen3.5-plus',
  // 真·免费模型
  'big-pickle', 'deepseek-v4-flash-free', 'muse-spark-1.2-contributor-free',
  'mimo-v2.5-free', 'ling-3.0-flash-fin-free', 'nemotron-3-ultra-free', 'nemotron-3.5-lightning-free', 'laguna-s-2.1-free',
]

export const plugin: ProviderPlugin = {
  id, name, baseUrl, envKey, desc, format: 'openai',
  models: MODELS.map(id => ({
    id,
    name: id,
    capabilities: { context_window: 200000, supports_tool_call: true },
  })),
  getApiKey: () => 'public',
}
