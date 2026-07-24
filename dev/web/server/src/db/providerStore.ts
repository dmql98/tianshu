import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { resolve } from 'path'

const DATA_DIR = process.env.DATA_DIR || resolve(import.meta.dirname, '../../../../data')
const FILE = resolve(DATA_DIR, 'providers.json')
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })

export interface ProviderRecord {
  id: string; name: string; base_url: string; api_key: string
  models: Array<{ id: string; name: string; context_window?: number; supports_vision?: boolean }>
  enabled_models?: string[]
  is_builtin?: boolean
  envKey?: string
  has_api_key?: boolean
}

export interface ModelInfo {
  id: string; name: string; context_window?: number; supports_vision?: boolean
}

function readAll(): ProviderRecord[] {
  if (!existsSync(FILE)) return []
  return JSON.parse(readFileSync(FILE, 'utf-8'))
}
function writeAll(items: ProviderRecord[]) {
  writeFileSync(FILE, JSON.stringify(items, null, 2), 'utf-8')
}

// migrate existing records that lack an id
function ensureIds() {
  if (!existsSync(FILE)) return
  const all = readAll()
  let changed = false
  all.forEach(p => { if (!p.id) { p.id = crypto.randomUUID(); changed = true } })
  if (changed) writeAll(all)
}
ensureIds()

export const providerStore = {
  getAll: () => readAll(),
  getById: (id: string) => readAll().find(p => p.id === id) || null,
  create: (data: ProviderRecord) => { const all = readAll(); const record = { ...data, id: data.id || crypto.randomUUID() }; all.push(record); writeAll(all); return record },
  update: (id: string, patch: Partial<ProviderRecord>) => {
    const all = readAll(); const idx = all.findIndex(p => p.id === id)
    if (idx < 0) return null
    all[idx] = { ...all[idx], ...patch, id }; writeAll(all); return all[idx]
  },
  delete: (id: string) => { const all = readAll(); const filtered = all.filter(p => p.id !== id); if (filtered.length === all.length) return false; writeAll(filtered); return true },
}
