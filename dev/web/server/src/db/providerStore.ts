import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { resolve } from 'path'
import { getDataDir } from '../config.js'

const FILE = () => resolve(getDataDir(), 'providers.json')
const DATA_DIR = () => getDataDir()

export interface ProviderRecord {
  id: string; name: string; base_url: string; api_key: string
  models: Array<{ id: string; name: string; context_window?: number; supports_vision?: boolean }>
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
}

export interface ModelInfo {
  id: string; name: string; context_window?: number; supports_vision?: boolean
}

function readAll(): ProviderRecord[] {
  ensureDataDir()
  const f = FILE()
  if (!existsSync(f)) return []
  return JSON.parse(readFileSync(f, 'utf-8'))
}
function writeAll(items: ProviderRecord[]) {
  ensureDataDir()
  writeFileSync(FILE(), JSON.stringify(items, null, 2), 'utf-8')
}

function ensureDataDir() {
  if (!existsSync(DATA_DIR())) mkdirSync(DATA_DIR(), { recursive: true })
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
  getByPresetId: (presetId: string) => readAll().find(p => p.preset_id === presetId) || null,
  /**
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
