import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'fs'
import { resolve } from 'path'

const DATA_DIR = process.env.DATA_DIR || resolve(import.meta.dirname, '../../../../data')
const CHAR_DIR = resolve(DATA_DIR, 'characters')

mkdirSync(CHAR_DIR, { recursive: true })

export interface CharacterMemory {
  enabled: boolean
  selfEvolution?: boolean
  charLimit?: number
  maxEntries?: number
}

import type { ToolBinding, ToolConstraint } from '../tools/types.js'

export type { ToolBinding, ToolConstraint }

export interface CharacterRecord {
  id: string
  name: string
  description?: string
  avatar?: string
  color?: string
  memory?: CharacterMemory
  model?: string
  provider?: string
  tools?: ToolBinding[]
  maxSteps?: number
  role?: 'main' | 'sub' | 'both'
  groups?: string[]
  default_strategy?: 'Plan' | 'Ask' | 'Bypass'
  skills?: string[]
  enabled?: boolean
  hidden?: boolean
  createdAt?: number
  updatedAt?: number
}

function pathFor(id: string): string {
  return resolve(CHAR_DIR, id, 'character.json')
}

function readAll(): CharacterRecord[] {
  if (!existsSync(CHAR_DIR)) return []
  const items: CharacterRecord[] = []
  try {
    const entries = readdirSync(CHAR_DIR, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const f = pathFor(entry.name)
      if (!existsSync(f)) continue
      try { items.push(JSON.parse(readFileSync(f, 'utf-8'))) } catch { /* skip corrupt */ }
    }
  } catch { /* dir not found */ }
  return items
}

function writeSingle(record: CharacterRecord) {
  const dir = resolve(CHAR_DIR, record.id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(resolve(dir, 'character.json'), JSON.stringify(record, null, 2), 'utf-8')
}

function removeDir(id: string) {
  const dir = resolve(CHAR_DIR, id)
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true })
  }
}

function nextId(items: CharacterRecord[]): string {
  const max = items.reduce((m, c) => Math.max(m, parseInt(c.id) || 0), 0)
  return String(max + 1)
}

export const characterMetaStore = {
  getAll: () => readAll(),

  getById: (id: string) => {
    const f = pathFor(id)
    if (!existsSync(f)) return null
    try { return JSON.parse(readFileSync(f, 'utf-8')) } catch { return null }
  },

  create: (data: Omit<CharacterRecord, 'id' | 'createdAt' | 'updatedAt'>) => {
    const all = readAll()
    const now = Date.now()
    const record: CharacterRecord = { ...data, id: nextId(all), createdAt: now, updatedAt: now }
    writeSingle(record)
    return record
  },

  update: (id: string, data: Partial<CharacterRecord>) => {
    const record = characterMetaStore.getById(id)
    if (!record) return null
    const updated: CharacterRecord = { ...record, ...data, id, updatedAt: Date.now() }
    writeSingle(updated)
    return updated
  },

  delete: (id: string) => {
    if (!characterMetaStore.getById(id)) return false
    removeDir(id)
    return true
  },
}
