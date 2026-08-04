import { resolve, dirname } from 'path'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CONFIG_FILE = resolve(__dirname, '../config.json')
const DEFAULT_DATA_DIR = 'C:\\.Tianshu'

interface Config {
  dataDir: string
}

let cached: Config | null = null
let explicitlySet = false

function loadConfig(): Config {
  if (cached) return cached
  // Priority: env var > config.json > default. Env first so tests and
  // container deploys can override a machine-local config.json.
  const envDir = process.env.TIANSHU_DATA_DIR || process.env.DATA_DIR
  if (envDir) {
    cached = { dataDir: envDir }
    explicitlySet = true
    return cached
  }
  if (existsSync(CONFIG_FILE)) {
    try {
      const raw = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'))
      if (raw.dataDir) {
        cached = { dataDir: raw.dataDir }
        explicitlySet = true
        return cached
      }
    } catch { /* fall through */ }
  }
  cached = { dataDir: DEFAULT_DATA_DIR }
  return cached
}

export function getDataDir(): string {
  return loadConfig().dataDir
}

export function isConfigured(): boolean {
  loadConfig()
  return explicitlySet
}

export function setDataDir(path: string): void {
  const config: Config = { dataDir: path }
  const dir = dirname(CONFIG_FILE)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8')
  cached = config
}
