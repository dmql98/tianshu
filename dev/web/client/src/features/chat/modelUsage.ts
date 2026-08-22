/**
 * 模型使用频次（会话模型选择下拉"常用置顶"的依据）。
 *
 * 存储：服务端 <dataDir>/config/model-usage.json（versioned JSON），经由
 * /api/preferences/model-usage 读写，是跨重启权威来源（随机端口重启场景下
 * localStorage 会清空，故不再依赖 localStorage）。只保存轻量计数：
 * `{ [modelKey]: count }`，modelKey 与会话模型选择键一致（`providerId::modelName`）。
 * 损坏/未知格式一律回退空计数；服务端不可达时静默降级（仅失去置顶能力）。
 */
import { getModelUsage, setModelUsage, type ModelUsage } from '@/api/modelUsage'

export type { ModelUsage } from '@/api/modelUsage'
export const TOP_MODELS_LIMIT = 3

/** 合法模型键：`providerId::modelName`。 */
export function isValidModelKey(key: string): boolean {
  return key.includes('::') && key.length > 2
}

// ── 规范化（纯函数，便于单测） ──

/** 校验并规范化：未知版本回退默认；非法键与非正整数计数丢弃。 */
export function normalizeModelUsage(value: unknown): ModelUsage {
  if (!value || typeof value !== 'object') return { version: 1, counts: {} }
  const candidate = value as Partial<ModelUsage>
  if (candidate.version !== undefined && candidate.version !== 1) {
    return { version: 1, counts: {} }
  }
  const counts: Record<string, number> = {}
  const raw = (candidate as { counts?: unknown }).counts
  if (raw && typeof raw === 'object') {
    for (const [key, n] of Object.entries(raw as Record<string, unknown>)) {
      if (!isValidModelKey(key)) continue
      if (typeof n === 'number' && Number.isFinite(n) && n > 0) counts[key] = Math.floor(n)
    }
  }
  return { version: 1, counts }
}

// ── 服务端读写 ──

/** 加载服务端常用模型计数（失败回退空）。 */
export async function loadModelUsage(): Promise<ModelUsage> {
  try {
    return normalizeModelUsage(await getModelUsage())
  } catch {
    return { version: 1, counts: {} }
  }
}

/** 保存服务端常用模型计数（失败静默降级）。 */
export async function saveModelUsage(usage: ModelUsage): Promise<void> {
  try {
    await setModelUsage(usage)
  } catch {
    /* 服务端不可达：静默降级 */
  }
}

/** 记一次使用（count +1）并落服务端。非法键忽略。 */
export async function recordModelUse(modelKey: string): Promise<void> {
  if (!isValidModelKey(modelKey)) return
  const usage = await loadModelUsage()
  usage.counts[modelKey] = (usage.counts[modelKey] || 0) + 1
  await saveModelUsage(usage)
}

/** 纯函数：从已加载的 usage 取使用次数最高的前 n 个模型键（降序，同分按键名稳定排序）。 */
export function topModelKeys(usage: ModelUsage, n: number = TOP_MODELS_LIMIT): string[] {
  const entries = Object.entries(usage.counts)
  entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  return entries.slice(0, n).map(([key]) => key)
}
