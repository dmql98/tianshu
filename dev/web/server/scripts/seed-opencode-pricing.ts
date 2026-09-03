/**
 * scripts/seed-opencode-pricing.ts — 为 opencode-go / opencode-free 生成 provider 目录下的
 * pricing.json（<dataDir>/providers/<id>/pricing.json，与 provider.json / icon.svg 平级）。
 *
 * 用法：node dist/scripts/seed-opencode-pricing.js
 *       （或 TIANSHU_DATA_DIR=<dataDir> node ...）
 *
 * 幂等：已有 pricing.json 的 provider 跳过（不覆盖用户修改）。
 * 生成内容：
 *   - opencode-go：价目表有值的模型按真实价计费；真·免费模型 is_free=true + ref 参考价
 *   - opencode-free：全部模型 is_free=true，ref_hourly_prices = 真实价格（算节省）
 */
import { existsSync } from 'fs'
import { resolve } from 'path'
import { getDataDir } from '../src/config.js'
import { providersRoot } from '../src/data-paths.js'
import { buildModelPricing, OPENCODE_PRICING } from '../src/providers/opencode-pricing.js'
import { writeProviderPricing } from '../src/pricing/pricingStore.js'

function buildProviderFile(providerId: string): Record<string, unknown> | null {
  const file = resolve(providersRoot(), providerId, 'pricing.json')
  if (existsSync(file)) return null // 已有 pricing.json，跳过（不覆盖用户修改）

  const forceFree = providerId === 'opencode-free'
  const models: Record<string, unknown> = {}

  // 免费档：MODELS 快照里全部 forceFree；go 档：价目表有值的模型。
  let modelIds: string[]
  if (providerId === 'opencode-free') {
    modelIds = [
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
      'big-pickle', 'deepseek-v4-flash-free', 'muse-spark-1.2-contributor-free',
      'mimo-v2.5-free', 'ling-3.0-flash-fin-free', 'nemotron-3-ultra-free', 'nemotron-3.5-lightning-free', 'laguna-s-2.1-free',
    ]
  } else if (providerId === 'opencode-go') {
    modelIds = Object.keys(OPENCODE_PRICING)
  } else {
    return null
  }

  let count = 0
  for (const id of modelIds) {
    const pricing = buildModelPricing(id, forceFree)
    if (!pricing) continue
    models[id] = pricing
    count++
  }

  if (count === 0) return null
  return { schemaVersion: 1, currency: 'USD', models }
}

function main(): void {
  if (!existsSync(getDataDir())) {
    console.error(`[seed-opencode-pricing] dataDir 不存在: ${getDataDir()}`)
    process.exit(1)
  }
  for (const providerId of ['opencode-go', 'opencode-free']) {
    const file = buildProviderFile(providerId)
    if (!file) {
      console.log(`[seed-opencode-pricing] ${providerId}: 已存在 pricing.json 或无模型，跳过`)
      continue
    }
    const written = writeProviderPricing(providerId, file)
    const n = Object.keys(file.models as Record<string, unknown>).length
    console.log(`[seed-opencode-pricing] ${providerId}: 写入 ${n} 个模型价目表 → ${written}`)
  }
}

main()
