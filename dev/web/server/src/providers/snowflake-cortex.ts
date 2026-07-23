import type { ProviderPlugin } from './types.js'

export const id = 'snowflake-cortex'
export const name = 'Snowflake Cortex'
export const baseUrl = 'https://{account}.snowflakecomputing.com/api/v2/cortex/v1/'
export const envKey = 'SNOWFLAKE_CORTEX_PAT'
export const desc = 'Snowflake Cortex 模型'

export const plugin: ProviderPlugin = {
  id, name, baseUrl, envKey, desc, format: 'openai',
  models: [
    { id: 'openai-gpt-5.1', name: 'GPT-5.1', capabilities: { context_window: 400000, max_output: 16384, supports_vision: true, supports_tool_call: true, supports_thinking: true } },
    { id: 'snowflake-llama3.3-70b', name: 'Llama 3.3 70B', capabilities: { context_window: 128000, max_output: 4096, supports_tool_call: true } },
  ],
  getApiKey: () => process.env[envKey] || null,
}
