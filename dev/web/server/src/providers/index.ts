import type { ProviderPlugin, ModelDefinition } from './types.js'

import * as alibaba from './alibaba.js'
import * as amazonBedrock from './amazon-bedrock.js'
import * as anthropic from './anthropic.js'
import * as azure from './azure.js'
import * as cerebras from './cerebras.js'
import * as cloudflareAIGateway from './cloudflare-ai-gateway.js'
import * as cloudflareWorkersAI from './cloudflare-workers-ai.js'
import * as cohere from './cohere.js'
import * as deepinfra from './deepinfra.js'
import * as deepseek from './deepseek.js'
import * as gateway from './gateway.js'
import * as githubCopilot from './github-copilot.js'
import * as gitlab from './gitlab.js'
import * as google from './google.js'
import * as googleVertex from './google-vertex.js'
import * as groq from './groq.js'
import * as kilo from './kilo.js'
import * as llmgateway from './llmgateway.js'
import * as mistral from './mistral.js'
import * as nvidia from './nvidia.js'
import * as openai from './openai.js'
import * as openaiCompatible from './openai-compatible.js'
import * as opencodeGo from './opencode-go.js'
import * as opencodeFree from './opencode-free.js'
import * as openrouter from './openrouter.js'
import * as perplexity from './perplexity.js'
import * as sapAICore from './sap-ai-core.js'
import * as siliconflow from './siliconflow.js'
import * as snowflakeCortex from './snowflake-cortex.js'
import * as togetherai from './togetherai.js'
import * as venice from './venice.js'
import * as vercel from './vercel.js'
import * as xai from './xai.js'
import * as xiaomi from './xiaomi.js'
import * as zenmux from './zenmux.js'

export const plugins: ProviderPlugin[] = [
  alibaba.plugin, amazonBedrock.plugin, anthropic.plugin,
  azure.plugin, cerebras.plugin, cloudflareAIGateway.plugin,
  cloudflareWorkersAI.plugin, cohere.plugin, deepinfra.plugin,
  deepseek.plugin, gateway.plugin, githubCopilot.plugin,
  gitlab.plugin, google.plugin, googleVertex.plugin,
  groq.plugin, kilo.plugin, llmgateway.plugin,
  mistral.plugin, nvidia.plugin, openai.plugin,
  openaiCompatible.plugin, opencodeGo.plugin, opencodeFree.plugin, openrouter.plugin,
  perplexity.plugin, sapAICore.plugin, siliconflow.plugin,
  snowflakeCortex.plugin, togetherai.plugin, venice.plugin,
  vercel.plugin, xai.plugin, xiaomi.plugin, zenmux.plugin,
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
