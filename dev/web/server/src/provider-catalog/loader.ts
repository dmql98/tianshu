import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { isAbsolute, join, relative, resolve, sep } from 'path'
import { providerPresetSchema, type ProviderPreset } from './schema.js'
import { getPlugin } from '../providers/index.js'
import { providersRoot } from '../data-paths.js'

/**
 * Catalog 根目录定位（BUILTIN_CONTENT_DEVELOPMENT_PLAN §2 / §11）：
 * - 默认：content/builtin/providers（随应用发布的只读预设层）
 * - 测试 / 高级用户可用 TIANSHU_PROVIDER_CATALOG_DIR 显式覆盖
 *   （兼容旧 provider-catalog 测试与自定义目录）。
 */
export function getCatalogRoot(): string {
  const override = process.env.TIANSHU_PROVIDER_CATALOG_DIR
  if (override) return resolve(override)
  // 单层化：出厂服务商预设已 seed 到 <dataDir>/providers（仍可读 TIANSHU_PROVIDER_CATALOG_DIR 覆盖）。
  return providersRoot()
}

export interface CatalogIssue {
  /** 出问题的 Provider 目录名。 */
  dir: string
  /** 定位用的人类可读信息。 */
  message: string
}

export interface CatalogLoadResult {
  /** 标准化、已排序、可对外返回的预设列表（不含 enabled: false）。 */
  presets: ProviderPreset[]
  /** 被跳过或损坏的条目，供日志排查；不影响其他 Provider 加载。 */
  issues: CatalogIssue[]
}

/** 图标路径必须是相对路径，禁止绝对路径与 `..` / 空段逃逸。 */
export function isSafeRelativePath(p: string): boolean {
  if (!p || isAbsolute(p)) return false
  const parts = p.split(/[\\/]/)
  return !parts.includes('..') && !parts.includes('')
}

/** 校验 icon 是否解析到 Provider 目录内部。 */
function isIconInsideDir(dir: string, icon: string): boolean {
  if (!isSafeRelativePath(icon)) return false
  const abs = resolve(dir, icon)
  const rel = relative(dir, abs)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

function latestMtime(root: string): number {
  let latest = 0
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry)
      const st = statSync(p)
      latest = Math.max(latest, st.mtimeMs)
      if (st.isDirectory()) walk(p)
    }
  }
  walk(root)
  return latest
}

interface CacheEntry {
  root: string
  mtimeMs: number
  result: CatalogLoadResult
  byId: Map<string, ProviderPreset>
  iconPaths: Map<string, string>
}

let cache: CacheEntry | null = null

/**
 * 扫描并校验 provider catalog 目录。
 * 生产/开发均按目录树 mtime 缓存，文件变化后自动重扫。
 */
export function loadCatalog(): CatalogLoadResult {
  const root = getCatalogRoot()
  if (!existsSync(root)) {
    return {
      presets: [],
      issues: [{ dir: '<root>', message: `provider-catalog 目录不存在: ${root}` }],
    }
  }

  const mtimeMs = latestMtime(root)
  if (cache && cache.root === root && cache.mtimeMs === mtimeMs) return cache.result

  const presets: ProviderPreset[] = []
  const issues: CatalogIssue[] = []
  const byId = new Map<string, ProviderPreset>()
  const iconPaths = new Map<string, string>()

  const report = (dir: string, message: string) => {
    issues.push({ dir, message })
    console.error(`[provider-catalog] ${dir}: ${message}`)
  }

  for (const entry of readdirSync(root)) {
    const dir = join(root, entry)
    let st: ReturnType<typeof statSync>
    try {
      st = statSync(dir)
    } catch {
      continue
    }
    // 只处理一级子目录，忽略散落文件（README.md、LICENSES.md 等）。
    if (!st.isDirectory()) continue

    const configPath = join(dir, 'provider.json')
    if (!existsSync(configPath)) {
      report(entry, '缺少 provider.json，跳过')
      continue
    }

    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(configPath, 'utf-8'))
    } catch (err) {
      report(entry, `provider.json 不是合法 JSON: ${(err as Error).message}`)
      continue
    }

    const parsed = providerPresetSchema.safeParse(raw)
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map(i => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ')
      report(entry, `provider.json 校验失败: ${detail}`)
      continue
    }

    const preset = parsed.data

    if (preset.id !== entry) {
      report(entry, `provider.id "${preset.id}" 与目录名不一致，跳过`)
      continue
    }
    if (byId.has(preset.id)) {
      report(entry, `Provider ID "${preset.id}" 重复，跳过`)
      continue
    }
    if (!getPlugin(preset.runtime.plugin)) {
      report(entry, `runtime.plugin "${preset.runtime.plugin}" 不存在于 provider registry，跳过`)
      continue
    }
    if (!isIconInsideDir(dir, preset.icon)) {
      report(entry, `icon "${preset.icon}" 非法（必须为目录内相对路径），跳过`)
      continue
    }
    const iconAbs = resolve(dir, preset.icon)
    if (!existsSync(iconAbs) || !statSync(iconAbs).isFile()) {
      report(entry, `icon 文件不存在: ${preset.icon}`)
      continue
    }

    byId.set(preset.id, preset)
    iconPaths.set(preset.id, iconAbs)
    if (preset.enabled !== false) presets.push(preset)
  }

  // 排序：popular 优先 → sortOrder 升序 → name 升序。
  presets.sort((a, b) => {
    const pa = a.popular ? 1 : 0
    const pb = b.popular ? 1 : 0
    if (pa !== pb) return pb - pa
    const oa = a.sortOrder ?? Number.MAX_SAFE_INTEGER
    const ob = b.sortOrder ?? Number.MAX_SAFE_INTEGER
    if (oa !== ob) return oa - ob
    return a.name.localeCompare(b.name)
  })

  cache = { root, mtimeMs, result: { presets, issues }, byId, iconPaths }
  return cache.result
}

/** 按 ID 查找启用中的预设。 */
export function getPreset(id: string): ProviderPreset | undefined {
  const { byId } = refresh()
  const preset = byId.get(id)
  return preset && preset.enabled !== false ? preset : undefined
}

/** 按 ID 返回已注册图标的绝对路径；未知 / 禁用 Provider 返回 undefined。 */
export function getIconPath(id: string): string | undefined {
  const { byId, iconPaths } = refresh()
  const preset = byId.get(id)
  if (!preset || preset.enabled === false) return undefined
  return iconPaths.get(id)
}

function refresh(): CacheEntry {
  loadCatalog()
  return cache!
}
