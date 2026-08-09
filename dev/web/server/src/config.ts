import { resolve, dirname } from 'path'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * Legacy default data directory used by non-Electron/dev setups. Production
 * config MUST NOT be written next to the server dist; it lives in
 * <TIANSHU_CONFIG_DIR>/config.json (Electron userData).
 */
const LEGACY_DATA_DIR = 'C:\\.Tianshu'

interface Config {
  dataDir: string
}

let cached: Config | null = null
let explicitlySet = false

/**
 * Where the persisted dataDir selection lives:
 * - Electron production: <TIANSHU_CONFIG_DIR>/config.json (userData)
 * - dev / non-Electron: web/server/config.json (back-compat, next to dist)
 */
function configFilePath(): string {
  const configDir = process.env.TIANSHU_CONFIG_DIR
  if (configDir) return resolve(configDir, 'config.json')
  return resolve(__dirname, '../config.json')
}

function writeConfig(config: Config): void {
  const file = configFilePath()
  const dir = dirname(file)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(file, JSON.stringify(config, null, 2), 'utf-8')
}

/** Legacy C:\.Tianshu is only adopted when it already holds real data. */
function legacyHasData(): boolean {
  try {
    if (!existsSync(LEGACY_DATA_DIR)) return false
    return (
      existsSync(resolve(LEGACY_DATA_DIR, 'sessions.db')) ||
      existsSync(resolve(LEGACY_DATA_DIR, 'providers.json')) ||
      existsSync(resolve(LEGACY_DATA_DIR, 'characters'))
    )
  } catch {
    return false
  }
}

function loadConfig(): Config {
  if (cached) return cached

  // 1. Explicit env override (tests / containers / power users).
  const envDir = process.env.TIANSHU_DATA_DIR || process.env.DATA_DIR
  if (envDir) {
    cached = { dataDir: envDir }
    explicitlySet = true
    return cached
  }

  // 2. Persisted selection in <TIANSHU_CONFIG_DIR>/config.json.
  const file = configFilePath()
  if (existsSync(file)) {
    try {
      const raw = JSON.parse(readFileSync(file, 'utf-8'))
      if (raw.dataDir) {
        cached = { dataDir: raw.dataDir }
        explicitlySet = true
        return cached
      }
    } catch {
      /* corrupt config — fall through */
    }
  }

  // 3. Default supplied by the desktop shell (<userData>/data).
  const defaultDir = process.env.TIANSHU_DEFAULT_DATA_DIR
  if (defaultDir) {
    // First-launch compatibility: if the legacy C:\.Tianshu already has data,
    // keep using it (no bulk migration) and persist that decision to the new
    // config location. Otherwise default to the fresh userData/data dir.
    if (legacyHasData()) {
      cached = { dataDir: LEGACY_DATA_DIR }
      explicitlySet = true
      writeConfig(cached)
      return cached
    }
    cached = { dataDir: defaultDir }
    return cached
  }

  // 4. Dev fallback: legacy default.
  cached = { dataDir: LEGACY_DATA_DIR }
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
  writeConfig(config)
  cached = config
  explicitlySet = true
}
