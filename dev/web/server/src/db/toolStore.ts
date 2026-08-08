import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, readdirSync, renameSync } from 'fs'
import { resolve, join } from 'path'
import { getDataDir } from '../config.js'

const MCP_DIR = () => resolve(getDataDir(), 'mcpservers')
const OLD_FILE = () => resolve(getDataDir(), 'mcpservers.json')

function ensureMcpDir() {
  const dir = MCP_DIR()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export interface MCPServerRecord {
  id: string
  name: string
  command: string
  args: string[]
  env: Record<string, string>
  cwd?: string
  timeout?: number
}

function configPath(name: string): string {
  ensureMcpDir()
  return join(MCP_DIR(), name, 'config.json')
}

function readByName(name: string): MCPServerRecord | null {
  const p = configPath(name)
  if (!existsSync(p)) return null
  return JSON.parse(readFileSync(p, 'utf-8'))
}

function writeByName(name: string, record: MCPServerRecord) {
  const dir = join(MCP_DIR(), name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'config.json'), JSON.stringify(record, null, 2), 'utf-8')
}

function scanAll(): MCPServerRecord[] {
  const dir = MCP_DIR()
  if (!existsSync(dir)) return []
  const entries = readdirSync(dir, { withFileTypes: true })
  const results: MCPServerRecord[] = []
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const p = join(dir, e.name, 'config.json')
    if (!existsSync(p)) continue
    try {
      results.push(JSON.parse(readFileSync(p, 'utf-8')))
    } catch { /* skip invalid */ }
  }
  return results
}

function findById(id: string): MCPServerRecord | null {
  const dir = MCP_DIR()
  if (!existsSync(dir)) return null
  const entries = readdirSync(dir, { withFileTypes: true })
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const p = join(dir, e.name, 'config.json')
    if (!existsSync(p)) continue
    try {
      const record = JSON.parse(readFileSync(p, 'utf-8'))
      if (record.id === id) return record
    } catch { /* skip */ }
  }
  return null
}

function findDirById(id: string): string | null {
  const dir = MCP_DIR()
  if (!existsSync(dir)) return null
  const entries = readdirSync(dir, { withFileTypes: true })
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const p = join(dir, e.name, 'config.json')
    if (!existsSync(p)) continue
    try {
      const record = JSON.parse(readFileSync(p, 'utf-8'))
      if (record.id === id) return join(dir, e.name)
    } catch { /* skip */ }
  }
  return null
}

function migrateFromOldFile() {
  if (!existsSync(OLD_FILE())) return
  try {
    const data = JSON.parse(readFileSync(OLD_FILE(), 'utf-8'))
    if (!Array.isArray(data)) return
    for (const record of data) {
      if (record.name) writeByName(record.name, record)
    }
    rmSync(OLD_FILE(), { force: true })
    console.log(`[toolStore] Migrated ${data.length} MCP server(s) from mcpservers.json`)
  } catch (err: any) {
    console.error('[toolStore] Failed to migrate mcpservers.json:', err.message)
  }
}

migrateFromOldFile()

export const mcpServerStore = {
  getAll: scanAll,
  getById: (id: string) => findById(id),
  getByName: (name: string) => readByName(name),
  create: (data: Partial<MCPServerRecord>) => {
    const record: MCPServerRecord = {
      id: data.id || crypto.randomUUID(),
      name: data.name || '',
      command: data.command || '',
      args: data.args || [],
      env: data.env || {},
      ...(data.cwd !== undefined ? { cwd: data.cwd } : {}),
      ...(data.timeout !== undefined ? { timeout: data.timeout } : {}),
    }
    if (!record.name) throw new Error('name is required')
    writeByName(record.name, record)
    return record
  },
  update: (id: string, patch: Partial<MCPServerRecord>) => {
    const mcpDir = MCP_DIR()
    if (!existsSync(mcpDir)) return null
    const entries = readdirSync(mcpDir, { withFileTypes: true })
    for (const e of entries) {
      if (!e.isDirectory()) continue
      const p = join(mcpDir, e.name, 'config.json')
      if (!existsSync(p)) continue
      try {
        const record = JSON.parse(readFileSync(p, 'utf-8'))
        if (record.id !== id) continue
        const updated = { ...record, ...patch, id }
        if (patch.name && patch.name !== e.name) {
          const newDir = join(mcpDir, patch.name)
          mkdirSync(newDir, { recursive: true })
          writeFileSync(join(newDir, 'config.json'), JSON.stringify(updated, null, 2), 'utf-8')
          rmSync(join(mcpDir, e.name), { recursive: true, force: true })
        } else {
          writeFileSync(p, JSON.stringify(updated, null, 2), 'utf-8')
        }
        return updated
      } catch { /* skip */ }
    }
    return null
  },
  delete: (id: string) => {
    const dir = findDirById(id)
    if (!dir) return false
    rmSync(dir, { recursive: true, force: true })
    return true
  },
}
