import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { resolve } from 'path'
import { plugins as builtinProviders, getPlugin, getModels } from '../providers'

const DATA_DIR = process.env.DATA_DIR || resolve('C:/.Tianshu/data')
const FILE = resolve(DATA_DIR, 'providers.json')
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })

export interface ProviderRecord {
  id: string
  name: string
  base_url: string
  api_key: string
  models: Array<{ id: string; name: string; context_window?: number; supports_vision?: boolean }>
  is_builtin?: boolean
}

export interface ModelInfo {
  id: string
  name: string
  context_window?: number
  supports_vision?: boolean
}

function readAll(): ProviderRecord[] {
  if (!existsSync(FILE)) return []
  const saved = JSON.parse(readFileSync(FILE, 'utf-8'))
  // 合并预设的内置provider
  const savedIds = new Set(saved.map((p: ProviderRecord) => p.id))
  const builtins: ProviderRecord[] = builtinProviders
    .filter(b => !savedIds.has(b.id))
    .map(b => ({
      id: b.id,
      name: b.name,
      base_url: b.baseUrl,
      api_key: getPlugin(b.id)?.getApiKey() ?? '',
      models: getModels(b.id).map(m => ({
        id: m.id,
        name: m.name,
        context_window: m.capabilities.context_window,
        supports_vision: m.capabilities.supports_vision,
      })),
      is_builtin: true,
    }))
  // 给已保存的内置provider补上模型目录（如果还没存）
  for (const record of saved) {
    const plugin = getPlugin(record.id)
    if (plugin && (record.models.length === 0)) {
      record.models = getModels(record.id).map(m => ({
        id: m.id,
        name: m.name,
        context_window: m.capabilities.context_window,
        supports_vision: m.capabilities.supports_vision,
      }))
    }
    // 如果没存 api_key 但 env 里有，自动补上
    if (plugin && !record.api_key) {
      const envKey = plugin.getApiKey()
      if (envKey) record.api_key = envKey
    }
  }
  return [...builtins, ...saved]
}

function writeAll(items: ProviderRecord[]) {
  // 只保存非内置的provider
  const toSave = items.filter(p => !p.is_builtin)
  writeFileSync(FILE, JSON.stringify(toSave, null, 2), 'utf-8')
}

// migrate existing records that lack an id
function ensureIds() {
  if (!existsSync(FILE)) return
  const all = JSON.parse(readFileSync(FILE, 'utf-8'))
  let changed = false
  all.forEach((p: ProviderRecord) => { if (!p.id) { p.id = crypto.randomUUID(); changed = true } })
  if (changed) writeFileSync(FILE, JSON.stringify(all, null, 2), 'utf-8')
}
ensureIds()

export const providerStore = {
  getAll: () => readAll(),
  getById: (id: string) => readAll().find(p => p.id === id) || null,
  getBuiltin: () => builtinProviders.map(b => ({
    id: b.id,
    name: b.name,
    base_url: b.baseUrl,
    api_key: getPlugin(b.id)?.getApiKey() ?? '',
    models: getModels(b.id).map(m => ({
      id: m.id,
      name: m.name,
      context_window: m.capabilities.context_window,
      supports_vision: m.capabilities.supports_vision,
    })),
    is_builtin: true,
  })),
  getCustom: () => readAll().filter(p => !p.is_builtin),

  create: (data: ProviderRecord) => {
    const all = readAll()
    const existing = all.find(p => p.id === data.id || p.name === data.name)
    if (existing) {
      if (existing.is_builtin && data.api_key) {
        existing.api_key = data.api_key
        writeAll(all)
        return existing
      }
      return existing
    }
    const record = { ...data, id: data.id || crypto.randomUUID(), is_builtin: false }
    all.push(record)
    writeAll(all)
    return record
  },

  update: (id: string, patch: Partial<ProviderRecord>) => {
    const all = readAll()
    const idx = all.findIndex(p => p.id === id)
    if (idx < 0) return null
    all[idx] = { ...all[idx], ...patch, id }
    writeAll(all)
    return all[idx]
  },

  delete: (id: string) => {
    const all = readAll()
    const provider = all.find(p => p.id === id)
    if (provider?.is_builtin) return false
    const filtered = all.filter(p => p.id !== id)
    if (filtered.length === all.length) return false
    writeAll(filtered)
    return true
  },
}
