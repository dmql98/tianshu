import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { resolve } from 'path'

const DATA_DIR = process.env.DATA_DIR || resolve(import.meta.dirname, '../../../../data')
const FILE = resolve(DATA_DIR, 'evolution-config.json')
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })

export interface EvolutionConfig {
  character_id: string
  group_id: string
  provider_id: string
  model: string
  workspace: string
  content: string
  detect_window: number
  error_rate_threshold: number
  repetition_count: number
  high_freq_min_calls: number
  high_freq_max_unique: number
  notify_enabled: boolean
  notify_timeout: number
}

const defaults: EvolutionConfig = {
  character_id: '',
  group_id: '',
  provider_id: '',
  model: '',
  workspace: '',
  content: '',
  detect_window: 8,
  error_rate_threshold: 0.5,
  repetition_count: 3,
  high_freq_min_calls: 6,
  high_freq_max_unique: 2,
  notify_enabled: true,
  notify_timeout: 2,
}

function read(): EvolutionConfig {
  if (!existsSync(FILE)) return { ...defaults }
  try {
    return { ...defaults, ...JSON.parse(readFileSync(FILE, 'utf-8')) }
  } catch {
    return { ...defaults }
  }
}

function write(config: EvolutionConfig) {
  writeFileSync(FILE, JSON.stringify(config, null, 2), 'utf-8')
}

export const evolutionConfig = {
  get(): EvolutionConfig {
    return read()
  },
  set(patch: Partial<EvolutionConfig>): EvolutionConfig {
    const current = read()
    const updated = { ...current, ...patch }
    write(updated)
    return updated
  },
  clear(): EvolutionConfig {
    write({ ...defaults })
    return { ...defaults }
  },
}
