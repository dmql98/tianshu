import { resolve, dirname } from 'path'
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'fs'
import { fileURLToPath } from 'url'
import {
  DEFAULT_SYSTEM_RUN_POLICY,
  normalizeSystemRunPolicy,
  type SystemRunPolicy,
} from './agent/loop/run-policy.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * 读取非负整数环境变量，缺失/非法时回退默认值。
 * 供上下文阈值类配置使用（P2-2：配置化）。
 */
export function envInt(name: string, def: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return def
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n >= 0 ? n : def
}

interface Config {
  dataDir: string
  runPolicy?: SystemRunPolicy
  /** dataDir 来源标记，见 DataDirSource。 */
  dataDirSource?: DataDirSource
  /** RTK（Rust Token Killer）集成开关：开启后 bash/pwsh 命令经 rtk 压缩输出。 */
  rtk?: RtkConfig
}

/** RTK 集成配置。目前仅有启用开关，后续可扩展压缩级别等。 */
export interface RtkConfig {
  enabled: boolean
}

/**
 * dataDir 的来源标记，写入 config.json（`dataDirSource` 字段）：
 * - 'user'：用户在设置页主动选择/修改 → 永远尊重，不回退。
 * - 'default'：自动采用的默认（外壳传入）→ 若该目录已不存在（如重装/清理后
 *   残留的 config.json），启动时回退到新的默认目录，避免沿用失效路径。
 */
type DataDirSource = 'user' | 'default'

let cached: Config | null = null
let explicitlySet = false

/**
 * 配置文件位置：
 * - 默认：程序自身路径下 <server>/config.json（紧邻 dist）。
 *   dev = web/server/config.json；打包 = resources/server/config.json。
 *   随程序目录一同清除，重装/卸载不会残留旧 dataDir。
 * - TIANSHU_CONFIG_DIR：仅测试 / CI 用它把 config 隔离到临时目录，避免污染
 *   真实配置；生产（desktop 外壳）不再设置该变量。
 */
function configFilePath(): string {
  const configDir = process.env.TIANSHU_CONFIG_DIR
  if (configDir) return resolve(configDir, 'config.json')
  return resolve(__dirname, '../config.json')
}

/**
 * Atomically persist config to <config dir>/config.json. Reads the current file,
 * merges the update over it, and renames a temp file into place so a crash never
 * leaves a half-written config. Unknown-but-supported system fields are preserved.
 */
function writeConfig(config: Config): void {
  const file = configFilePath()
  const dir = dirname(file)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const existing = readCurrentConfigFile()
  const merged = { ...existing, ...config }
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(temp, JSON.stringify(merged, null, 2), 'utf-8')
  renameSync(temp, file)
}

/** Read the raw config.json as an object; never throws (corrupt → {}). */
function readCurrentConfigFile(): Record<string, unknown> {
  try {
    const file = configFilePath()
    if (!existsSync(file)) return {}
    const raw = JSON.parse(readFileSync(file, 'utf-8'))
    return raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  } catch {
    return {}
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

  // 2. Persisted selection in config.json（程序路径，测试/CI 经 TIANSHU_CONFIG_DIR 隔离）。
  const file = configFilePath()
  if (existsSync(file)) {
    let raw: Record<string, unknown> | undefined
    try {
      raw = JSON.parse(readFileSync(file, 'utf-8'))
    } catch (err: any) {
      // Corrupt config must not be silently ignored — surface the real reason
      // instead of a misleading "no data directory" (e.g. unescaped backslashes
      // in a hand-edited dataDir). Fix or delete the file to proceed.
      throw new Error(`Invalid config file ${file}: ${err?.message || String(err)}`)
    }
    const persisted = raw && typeof raw === 'object'
      ? (raw.dataDir as string | undefined)
      : undefined
    const source = raw && typeof raw === 'object' ? (raw.dataDirSource as DataDirSource | undefined) : undefined
    if (persisted) {
      // 旧默认残留（dataDirSource 缺失视为 default）且目录已不存在（被卸载清理）时，
      // 不沿用失效路径：回退到外壳传入的新默认（安装路径）。用户主动选择的
      // ('user') 或目录仍存在的一律尊重。
      const staleDefault = source !== 'user' && !existsSync(persisted)
      if (!staleDefault) {
        cached = {
          dataDir: persisted,
          runPolicy: normalizeSystemRunPolicy(raw?.runPolicy),
        }
        explicitlySet = true
        return cached
      }
      console.warn(`[config] ignoring stale dataDir "${persisted}" (directory missing); falling back to default`)
    }
  }

  // 3. Default supplied by the desktop shell (<installDir>/data 或 <userData>/data)。
  const defaultDir = process.env.TIANSHU_DEFAULT_DATA_DIR
  if (defaultDir) {
    // 默认 dataDir 视为已配置：首次启动自动采用外壳传入的默认目录（安装路径下），
    // 持久化到 config.json（source='default'，重装后若旧目录消失可回退新默认）。
    cached = { dataDir: defaultDir }
    explicitlySet = true
    try {
      writeConfig({ ...cached, dataDirSource: 'default' })
    } catch (err) {
      // 安装目录可能只读：保持内存态可用，不因持久化失败而拒绝启动。
      console.error(`[config] failed to persist default dataDir (continuing in-memory): ${err instanceof Error ? err.message : err}`)
    }
    return cached
  }

  // 4. 没有任何显式配置：拒绝静默猜测数据目录。开发模式必须由
  //    Electron / dev orchestrator 显式传入 TIANSHU_DEFAULT_DATA_DIR。
  throw new Error(
    'No data directory configured. Set TIANSHU_DATA_DIR / DATA_DIR, or TIANSHU_DEFAULT_DATA_DIR ' +
    '(dev/desktop shell), or persist dataDir in <server>/config.json.',
  )
}

export function getDataDir(): string {
  return loadConfig().dataDir
}

/** Normalized system run policy (defaults fill any gaps). */
export function getSystemRunPolicy(): SystemRunPolicy {
  return normalizeSystemRunPolicy(loadConfig().runPolicy)
}

/**
 * Atomically persist a system run policy. Returns the normalized value that was
 * saved. Only affects Runs created afterwards.
 */
export function setSystemRunPolicy(input: unknown): SystemRunPolicy {
  const normalized = normalizeSystemRunPolicy(input)
  const config: Config = { dataDir: loadConfig().dataDir, runPolicy: normalized }
  writeConfig(config)
  cached = { ...config }
  return normalized
}

/** Reset the system run policy to the recommended defaults (atomic). */
export function resetSystemRunPolicy(): SystemRunPolicy {
  const config: Config = { dataDir: loadConfig().dataDir, runPolicy: DEFAULT_SYSTEM_RUN_POLICY }
  writeConfig(config)
  cached = { ...config }
  return DEFAULT_SYSTEM_RUN_POLICY
}

/** RTK 集成配置（默认禁用）。 */
export function getRtkConfig(): RtkConfig {
  const raw = loadConfig().rtk
  return { enabled: !!raw?.enabled }
}

/**
 * 持久化 RTK 集成配置，返回规范化后的值。仅更新 rtk 字段，
 * 写入时保留已有的 dataDir / runPolicy / dataDirSource，避免误覆盖。
 */
export function setRtkConfig(input: unknown): RtkConfig {
  const normalized: RtkConfig = { enabled: !!(input as { enabled?: boolean } | null)?.enabled }
  const current = loadConfig()
  const next: Config = { dataDir: current.dataDir }
  if (current.runPolicy) next.runPolicy = current.runPolicy
  if (current.dataDirSource) next.dataDirSource = current.dataDirSource
  next.rtk = normalized
  writeConfig(next)
  cached = next
  return normalized
}

export function isConfigured(): boolean {
  loadConfig()
  return explicitlySet
}

export function setDataDir(path: string): void {
  // 用户主动选择 → source='user'，重装/目录消失时也不回退（尊重用户意图）。
  const config: Config = { dataDir: path, dataDirSource: 'user', runPolicy: loadConfig().runPolicy }
  writeConfig(config)
  cached = config
  explicitlySet = true
}
