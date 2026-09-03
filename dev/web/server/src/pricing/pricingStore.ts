/**
 * pricing/pricingStore.ts — 价目表存储（独立于 providers.json）。
 *
 * 数据落盘：<dataDir>/providers/<id>/pricing.json，与 provider.json / icon.svg 平级。
 * 只读内置层 content/builtin/providers/<id>/pricing.json 由 materializeProviderCatalog()
 * 整目录复制进用户层（无需额外改动）。
 *
 * 写路径（Statistics Feature）：
 * - 写入 <dataDir>/providers/<id>/pricing.json；目录不存在时自动创建。
 * - pricing.json 不存在时（如旧部署/未 seed）视为「无价目表」→ 全部模型免费兜底。
 *
 * 读取：遍历 <dataDir>/providers 下每个子目录的 pricing.json，构建 providerId → 规则索引。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname, resolve } from 'path'
import { providersRoot } from '../data-paths.js'
import type { ModelPricing, ProviderPricing, ProviderPricingFile } from './types.js'

export interface ProviderPricingRules {
  /** provider 目录名（== provider id）。 */
  providerId: string
  /** provider 级默认定价（可能 undefined）。 */
  defaultPricing?: ProviderPricing
  /** modelId → model 级 pricing。 */
  modelPricing: Map<string, ModelPricing>
}

/** <dataDir>/providers/<id>/pricing.json */
function pricingFileFor(providerId: string): string {
  return resolve(providersRoot(), providerId, 'pricing.json')
}

/** 读取单个 provider 的 pricing.json；文件不存在/损坏 → undefined。 */
export function readProviderPricing(providerId: string): ProviderPricingFile | undefined {
  const file = pricingFileFor(providerId)
  if (!existsSync(file)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as ProviderPricingFile
    return parsed
  } catch {
    return undefined
  }
}

/** 写入单个 provider 的 pricing.json（原子写：tmp + rename）。 */
export function writeProviderPricing(providerId: string, data: ProviderPricingFile): string {
  const file = pricingFileFor(providerId)
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8')
  renameSync(tmp, file)
  return file
}

/** 遍历 <dataDir>/providers 下每个子目录的 pricing.json，加载所有价目表规则。 */
export function loadAll(): ProviderPricingRules[] {
  const root = providersRoot()
  if (!existsSync(root)) return []
  const result: ProviderPricingRules[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const file = readProviderPricing(entry.name)
    if (!file) continue
    const modelPricing = new Map<string, ModelPricing>()
    for (const [id, pricing] of Object.entries(file.models || {})) {
      if (pricing) modelPricing.set(id, pricing)
    }
    result.push({
      providerId: entry.name,
      defaultPricing: file.default_pricing,
      modelPricing,
    })
  }
  return result
}

export const pricingStore = {
  loadAll,
  read: readProviderPricing,
  write: writeProviderPricing,
  /** 判断某 provider 目录是否已有 pricing.json。 */
  has(providerId: string): boolean {
    return existsSync(pricingFileFor(providerId))
  },
}
