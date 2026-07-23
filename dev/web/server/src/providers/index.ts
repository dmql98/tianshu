import type { ProviderPlugin, ModelDefinition } from './types.js'

import * as anthropic from './anthropic.js'
import * as openai from './openai.js'
import * as google from './google.js'
import * as githubCopilot from './github-copilot.js'
import * as openrouter from './openrouter.js'
import * as deepseek from './deepseek.js'
import * as xai from './xai.js'
import * as vercel from './vercel.js'
import * as mistral from './mistral.js'
import * as groq from './groq.js'
import * as cohere from './cohere.js'
import * as togetherai from './togetherai.js'
import * as alibaba from './alibaba.js'
import * as siliconflow from './siliconflow.js'
import * as opencodeGo from './opencode-go.js'
import * as custom from './custom.js'

export const plugins: ProviderPlugin[] = [
  anthropic.plugin, openai.plugin, google.plugin,
  githubCopilot.plugin, openrouter.plugin, deepseek.plugin,
  xai.plugin, vercel.plugin, mistral.plugin, groq.plugin,
  cohere.plugin, togetherai.plugin, alibaba.plugin, siliconflow.plugin,
  opencodeGo.plugin, custom.plugin,
]

const pluginIndex = new Map<string, ProviderPlugin>(
  plugins.map(p => [p.id, p]),
)

export type { ProviderPlugin, ModelDefinition, ProviderFormat } from './types.js'

export function getPlugin(id: string): ProviderPlugin | undefined {
  return pluginIndex.get(id)
}

export function getModels(id: string): ModelDefinition[] {
  return pluginIndex.get(id)?.models ?? []
}

export function detectAvailable(): ProviderPlugin[] {
  return plugins.filter(p => p.getApiKey() !== null)
}

export function resolveProvider(id: string): { baseUrl: string; apiKey: string } | null {
  const plugin = pluginIndex.get(id)
  if (!plugin) return null
  const apiKey = plugin.getApiKey()
  if (!apiKey) return null
  return { baseUrl: plugin.baseUrl, apiKey }
}
