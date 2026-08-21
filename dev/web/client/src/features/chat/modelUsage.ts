/**
 * 模型使用频次（会话模型选择下拉"常用置顶"的依据）。
 *
 * 存储键 `tianshu:modelUsage`（versioned JSON）。只保存轻量计数：
 * `{ [modelKey]: count }`，modelKey 与会话模型选择键一致（`providerId::modelName`）。
 * 损坏/未知格式一律回退空计数；localStorage 不可用时静默降级（仅失去置顶能力）。
 */
export interface ModelUsage {
  version: 1
  counts: Record<string, number>
}

export const MODEL_USAGE_STORAGE_KEY = 'tianshu:modelUsage'
export const TOP_MODELS_LIMIT = 3

/** 每次调用生成全新对象（counts 必须深拷贝，避免调用方原地累加污染模块级默认值）。 */
export function emptyModelUsage(): ModelUsage {
  return { version: 1, counts: {} }
}

export function getDefaultStorage(): Storage | null {
  return typeof window === 'undefined' ? null : window.localStorage
}

/** 合法模型键：`providerId::modelName`。 */
export function isValidModelKey(key: string): boolean {
  return key.includes('::') && key.length > 2
}

// ── 规范化 ──

/** 校验并规范化：未知版本回退默认；非法键与非正整数计数丢弃。 */
export function normalizeModelUsage(value: unknown): ModelUsage {
  if (!value || typeof value !== 'object') return emptyModelUsage()
  const candidate = value as Partial<ModelUsage>
  if (candidate.version !== undefined && candidate.version !== 1) {
    return emptyModelUsage()
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

// ── 存储 ──

export function loadModelUsage(storage: Storage | null = getDefaultStorage()): ModelUsage {
  if (!storage) return emptyModelUsage()
  try {
    const raw = storage.getItem(MODEL_USAGE_STORAGE_KEY)
    if (raw) return normalizeModelUsage(JSON.parse(raw))
  } catch {
    /* 损坏数据回退默认 */
  }
  return emptyModelUsage()
}

export function saveModelUsage(usage: ModelUsage, storage: Storage | null = getDefaultStorage()): void {
  if (!storage) return
  try {
    storage.setItem(MODEL_USAGE_STORAGE_KEY, JSON.stringify(normalizeModelUsage(usage)))
  } catch {
    /* 配额/隐私模式失败静默降级 */
  }
}

/** 记一次使用（count +1）。非法键忽略。 */
export function recordModelUse(modelKey: string, storage: Storage | null = getDefaultStorage()): void {
  if (!isValidModelKey(modelKey)) return
  const usage = loadModelUsage(storage)
  usage.counts[modelKey] = (usage.counts[modelKey] || 0) + 1
  saveModelUsage(usage, storage)
}

/** 使用次数最高的前 n 个模型键（次数降序，同次数按键名稳定排序）。 */
export function topModelKeys(n: number = TOP_MODELS_LIMIT, storage: Storage | null = getDefaultStorage()): string[] {
  const entries = Object.entries(loadModelUsage(storage).counts)
  entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  return entries.slice(0, n).map(([key]) => key)
}
