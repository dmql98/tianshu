import type { ProviderPlugin } from './types.js'

export const id = 'alibaba'
export const name = '阿里云百炼'
export const baseUrl = 'https://dashscope.aliyuncs.com/compatible-mode/v1/'
export const envKey = 'DASHSCOPE_API_KEY'
export const desc = '通义千问系列'

export const plugin: ProviderPlugin = {
  id, name, baseUrl, envKey, desc, format: 'openai',
  models: [
    { id: 'qwen-max', name: 'Qwen Max', capabilities: { context_window: 32768, max_output: 8192, supports_tool_call: true } },
    { id: 'qwen-plus', name: 'Qwen Plus', capabilities: { context_window: 131072, max_output: 8192, supports_tool_call: true } },
    { id: 'qwen-turbo', name: 'Qwen Turbo', capabilities: { context_window: 131072, max_output: 8192, supports_tool_call: true } },
    { id: 'qwq-plus', name: 'QWQ Plus', capabilities: { context_window: 131072, max_output: 8192, supports_tool_call: true, supports_thinking: true } },
    { id: 'qwen-vl-max', name: 'Qwen VL Max', capabilities: { context_window: 32768, max_output: 2048, supports_vision: true, supports_tool_call: true } },
    { id: 'qwen-vl-plus', name: 'Qwen VL Plus', capabilities: { context_window: 131072, max_output: 8192, supports_vision: true, supports_tool_call: true } },
  ],
  getApiKey: () => process.env[envKey] || null,
}
