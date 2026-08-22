import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'fs'
import { resolve } from 'path'
import { getDataDir } from '../config.js'
import { configProvidersFile, configDir } from '../data-paths.js'

const FILE = () => configProvidersFile()

// 启动迁移：旧 <dataDir>/providers.json → <dataDir>/config/providers.json（仅当新文件不存在时）。
function migrateProviders() {
  const oldPath = resolve(getDataDir(), 'providers.json')
  const newPath = FILE()
  if (oldPath !== newPath && existsSync(oldPath) && !existsSync(newPath)) {
    mkdirSync(configDir(), { recursive: true })
    try {
      renameSync(oldPath, newPath)
    } catch {
      // 跨设备/权限失败退化为复制
      writeFileSync(newPath, readFileSync(oldPath, 'utf-8'), 'utf-8')
    }
  }
}
migrateProviders()

export interface ProviderRecord {
  id: string; name: string; base_url: string; api_key: string
  models: ModelInfo[]
  enabled_models?: string[]
  is_builtin?: boolean
  envKey?: string
  has_api_key?: boolean
  /** 预设来源（catalog Provider ID），用于 UI 关联与重复添加校验；自定义 Provider 无此字段。 */
  preset_id?: string
  /** 实际执行模型请求的运行时适配器。 */
  runtime_plugin?: string
  /** 请求格式（openai | anthropic | gemini）。 */
  format?: 'openai' | 'anthropic' | 'gemini'
  /** 调用协议：chat/completions（默认）、OpenAI Responses API（/v1/responses），
   *  或 'auto'（运行时探测哪条路能拿到缓存命中；LM Studio 等本地服务自动切 responses）。 */
  api_style?: 'auto' | 'chat_completions' | 'responses'
}

export interface ModelInfo {
  id: string; name: string; context_window?: number; supports_vision?: boolean
  enabled?: boolean
  /** 该模型单独指定的调用协议；优先于 provider 级 api_style。 */
  api_style?: 'auto' | 'chat_completions' | 'responses'
  /** 上下文窗口被用户手动覆盖过；刷新模型列表时保留手动值。 */
  context_window_overridden?: boolean
  /** P1-4 模型级压缩策略（未配置回退全局默认）：触发阈值 / 保留比。 */
  compact_threshold_ratio?: number
  compact_retain_ratio?: number
  /** 独立摘要 provider id / model（P1-4/P1-5）。 */
  compact_provider?: string
  compact_model?: string
}

function readAll(): ProviderRecord[] {
  ensureConfigDir()
  const f = FILE()
  if (!existsSync(f)) return []
  return JSON.parse(readFileSync(f, 'utf-8'))
}
function writeAll(items: ProviderRecord[]) {
  ensureConfigDir()
  writeFileSync(FILE(), JSON.stringify(items, null, 2), 'utf-8')
}

function ensureConfigDir() {
  if (!existsSync(configDir())) mkdirSync(configDir(), { recursive: true })
}

// migrate existing records that lack an id
function ensureIds() {
  if (!existsSync(FILE())) return
  const all = readAll()
  let changed = false
  all.forEach(p => { if (!p.id) { p.id = crypto.randomUUID(); changed = true } })
  if (changed) writeAll(all)
}
ensureIds()

export const providerStore = {
  getAll: () => readAll(),
  getById: (id: string) => readAll().find(p => p.id === id) || null,
  getByPresetId: (presetId: string) => readAll().find(p => p.preset_id === presetId) || null,  /**
   * 每个预设只允许添加一次：preset_id 已存在时返回冲突，不重复写入。
   * 自定义 Provider 无 preset_id，继续使用独立生成的 ID。
   */
  create: (data: ProviderRecord) => {
    const all = readAll()
    if (data.preset_id && all.some(p => p.preset_id === data.preset_id)) {
      return { conflict: true, record: null as ProviderRecord | null }
    }
    const record = { ...data, id: data.id || crypto.randomUUID() }
    all.push(record); writeAll(all)
    return { conflict: false, record }
  },
  update: (id: string, patch: Partial<ProviderRecord>) => {
    const all = readAll(); const idx = all.findIndex(p => p.id === id)
    if (idx < 0) return null
    all[idx] = { ...all[idx], ...patch, id }; writeAll(all); return all[idx]
  },
  delete: (id: string) => { const all = readAll(); const filtered = all.filter(p => p.id !== id); if (filtered.length === all.length) return false; writeAll(filtered); return true },
}

/** Resolve the effective API protocol for a given model: model-level override
 *  wins, then provider-level, otherwise undefined (= auto-detect). */
export function resolveProviderApiStyle(
  provider: Pick<ProviderRecord, 'api_style' | 'models'>,
  modelId?: string | null,
): ProviderRecord['api_style'] {
  if (modelId) {
    const m = provider.models?.find(x => x.id === modelId)
    if (m?.api_style) return m.api_style
  }
  return provider.api_style
}
