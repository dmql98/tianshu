import type { ProviderPlugin } from './types.js'

export const id = 'siliconflow'
export const name = 'SiliconFlow'
export const baseUrl = 'https://api.siliconflow.cn/v1/'
export const envKey = 'SILICONFLOW_API_KEY'
export const desc = '国内模型聚合'

export const plugin: ProviderPlugin = {
  id, name, baseUrl, envKey, desc, format: 'openai',
  models: [
    { id: 'deepseek-ai/DeepSeek-V3', name: 'DeepSeek V3', capabilities: { context_window: 64000, max_output: 8192, supports_tool_call: true } },
    { id: 'deepseek-ai/DeepSeek-R1', name: 'DeepSeek R1', capabilities: { context_window: 64000, max_output: 8192, supports_tool_call: true, supports_thinking: true } },
    { id: 'Qwen/Qwen2.5-72B-Instruct', name: 'Qwen 2.5 72B', capabilities: { context_window: 131072, max_output: 8192, supports_tool_call: true } },
    { id: 'THUDM/glm-4-9b-chat', name: 'GLM-4 9B', capabilities: { context_window: 131072, max_output: 4096, supports_tool_call: true } },
    { id: 'Pro/Qwen/Qwen2.5-VL-72B-Instruct', name: 'Qwen 2.5 VL 72B', capabilities: { context_window: 131072, max_output: 8192, supports_vision: true, supports_tool_call: true } },
  ],
  getApiKey: () => process.env[envKey] || null,
}
