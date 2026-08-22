import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import { configModelUsageFile } from '../data-paths.js'
import { type ModelUsage, EMPTY_MODEL_USAGE } from './types.js'

function isValidModelKey(key: string): boolean {
  return key.includes('::') && key.length > 2
}

export function normalizeModelUsage(value: unknown): ModelUsage {
  if (!value || typeof value !== 'object') return { ...EMPTY_MODEL_USAGE }
  const candidate = value as Partial<ModelUsage>
  if (candidate.version !== undefined && candidate.version !== 1) return { ...EMPTY_MODEL_USAGE }
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

function readModelUsage(): ModelUsage {
  const file = configModelUsageFile()
  if (!existsSync(file)) return { ...EMPTY_MODEL_USAGE }
  try {
    return normalizeModelUsage(JSON.parse(readFileSync(file, 'utf-8')))
  } catch {
    return { ...EMPTY_MODEL_USAGE }
  }
}

function persist(usage: ModelUsage): void {
  const file = configModelUsageFile()
  mkdirSync(dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(temp, JSON.stringify(usage, null, 2), 'utf-8')
  renameSync(temp, file)
}

export function getModelUsage(): ModelUsage {
  return readModelUsage()
}

export function saveModelUsage(usage: ModelUsage): void {
  persist(usage)
}
