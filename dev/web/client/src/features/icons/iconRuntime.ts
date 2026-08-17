/**
 * 图标包运行时：解析、应用、跨窗口同步与 React 订阅。
 *
 * 统一模型：内置包与用户包完全同构（pack.json + assets/*.svg），差异仅在服务端
 * 根目录（content/builtin/iconpacks/<id>/ 只读 vs <dataDir>/iconpacks/<id>/ 可写）。
 * 客户端不编译任何内置 path 数据：注册表 = 服务端拉取的全量包列表（含内置包，
 * 源码分支来自 builtin 层），解析只走 asset URL。
 *
 * - registry：内置包（服务端 builtin 层级）+ 用户包（服务端用户层级）+ 覆盖层。
 * - resolve：按「覆盖层 → 激活包（内置或用户）→ 默认 lucide」顺序解析槽位。
 * - 切换：持久化轻量 selection（localStorage）+ 广播 `tianshu:iconpack-changed`。
 * - 覆盖层语义：全局单枚替换，切换包时仍生效（与所选包无关）。
 */
import { DEFAULT_ICON_PACK_ID } from './iconDefinitions'
import {
  ICON_PACK_CHANGED_EVENT,
  ICON_PACK_PREFERENCES_STORAGE_KEY,
  appliedIconPackId,
  getDefaultStorage,
  loadIconPackPreferences,
  normalizeIconPackPreferences,
  saveIconPackPreferences,
  type IconPackPreferences,
} from './iconPreferences'
import {
  fetchCustomIconPacks,
  type CustomIconPack,
  type IconOverrideRef,
} from './iconPacksApi'

/** 解析结果：全部为 asset（内置与用户包共用）。 */
export type ResolvedIcon = { kind: 'asset'; url: string; tint: boolean }

export interface IconRuntimeDeps {
  storage?: Storage | null
  /** 测试注入的包列表；缺省用模块缓存。 */
  packs?: CustomIconPack[]
  overrides?: Record<string, IconOverrideRef>
  /** 是否派发事件（测试可关闭）。 */
  dispatch?: boolean
}

// ── 模块级缓存（服务端事实来源的只读副本） ──

let packsCache: CustomIconPack[] = []
let overridesCache: Record<string, IconOverrideRef> = {}
let registryLoaded = false
let registryReady: Promise<void> | null = null

/** 运行时监听器（React 订阅用）。 */
type Listener = () => void
const listeners = new Set<Listener>()

function notifyListeners(): void {
  for (const listener of listeners) listener()
}

export function subscribeIconRuntime(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// ── 注册表 ──

/** 拉取服务端全量包列表（内置 + 用户）与覆盖层并刷新缓存（启动时调用一次；变更后调用刷新）。 */
export async function refreshIconRegistry(): Promise<void> {
  try {
    const data = await fetchCustomIconPacks()
    packsCache = data.packs
    overridesCache = data.overrides ?? {}
    registryLoaded = true
  } catch {
    // 服务端不可达：保留旧缓存（首次失败则空，下一次刷新自动恢复）
    registryLoaded = false
  }
  notifyListeners()
}

export function isIconRegistryLoaded(): boolean {
  return registryLoaded
}

/**
 * 首次注册表加载完成前解析一个 Promise（App 启动时等待，避免图标兜底闪烁）。
 * 服务端不可达也 resolve（保留旧缓存/空缓存，内置包由下一次刷新恢复）。
 * 内置 5s 超时兜底，避免服务端卡死拖住整个应用首屏。
 */
export function waitForIconRegistry(): Promise<void> {
  if (!registryReady) {
    registryReady = Promise.race([
      refreshIconRegistry().catch(() => {}),
      new Promise<void>(resolve => setTimeout(resolve, 5000)),
    ])
  }
  return registryReady
}

// ── 解析 ──

function findPack(packId: string, packs: CustomIconPack[]): CustomIconPack | undefined {
  return packs.find(p => p.id === packId)
}

function resolveActivePackRef(
  slotKey: string,
  active: CustomIconPack | undefined,
  packs: CustomIconPack[],
): ResolvedIcon | null {
  const ref = active?.slots?.[slotKey]
  if (ref) return { kind: 'asset', url: ref.url, tint: ref.tint }
  // 兜底：默认 lucide（内置只读层，同样以 asset 引用解析）
  const fallback = findPack(DEFAULT_ICON_PACK_ID, packs)
  const fallbackRef = fallback?.slots?.[slotKey]
  if (fallbackRef) return { kind: 'asset', url: fallbackRef.url, tint: fallbackRef.tint }
  return null
}

/**
 * 解析槽位 → 图标。顺序：覆盖层 → 激活包（内置或用户）→ 默认 lucide。
 * 解析不到返回 null（调用方决定兜底行为，如占位图形）。
 */
export function resolveIcon(slotKey: string, deps: IconRuntimeDeps = {}): ResolvedIcon | null {
  const overrides = deps.overrides ?? overridesCache
  const packs = deps.packs ?? packsCache
  const override = overrides[slotKey]
  if (override) {
    return { kind: 'asset', url: override.url ?? '', tint: override.tint }
  }

  const storage = deps.storage !== undefined ? deps.storage : getDefaultStorage()
  const packId = appliedIconPackId(storage)
  const active = findPack(packId, packs)
  return resolveActivePackRef(slotKey, active, packs)
}

// ── 切换 ──

/** 切换激活包并持久化 + 广播。packId 需为内置包 id 或服务端用户包 id。 */
export function setActiveIconPack(
  packId: string,
  deps: IconRuntimeDeps = {},
): IconPackPreferences {
  const storage = deps.storage !== undefined ? deps.storage : getDefaultStorage()
  const normalized = normalizeIconPackPreferences({ version: 1, selection: { packId } })
  saveIconPackPreferences(normalized, storage)
  if (deps.dispatch !== false && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(ICON_PACK_CHANGED_EVENT, { detail: { packId } }))
  }
  notifyListeners()
  return normalized
}

/** 读当前激活包 id（不触发副作用）。 */
export function appliedPackId(deps: IconRuntimeDeps = {}): string {
  const storage = deps.storage !== undefined ? deps.storage : getDefaultStorage()
  return appliedIconPackId(storage)
}

// ── 初始化 ──

/** 启动前初始化：拉取注册表 + 监听跨窗口 storage。返回 cleanup。 */
export function initializeIconRuntime(deps: IconRuntimeDeps = {}): () => void {
  void refreshIconRegistry()
  if (typeof window === 'undefined') return () => {}
  const onStorage = (event: StorageEvent): void => {
    if (event.key === ICON_PACK_PREFERENCES_STORAGE_KEY) {
      // 其他窗口切换了图标包：刷新本地注册表 + 通知订阅者
      void refreshIconRegistry()
      notifyListeners()
    }
  }
  window.addEventListener('storage', onStorage)
  return () => window.removeEventListener('storage', onStorage)
}

// ── React 便捷订阅 ──

/** 兼容：当前激活包 id（组件订阅触发重渲染请 use subscribeIconPackVersion）。 */
export function subscribeIconPackVersion(callback: () => void): () => void {
  return subscribeIconRuntime(callback)
}

/** 兼容：全量包缓存（含内置包，供测试/调试）。 */
export function getPacksCache(): CustomIconPack[] {
  return packsCache
}

/** 兼容：覆盖层缓存（供测试/调试）。 */
export function getOverridesCache(): Record<string, IconOverrideRef> {
  return overridesCache
}

/** 重置缓存（测试用）。 */
export function resetIconRegistryCache(): void {
  packsCache = []
  overridesCache = {}
  registryLoaded = false
  registryReady = null
}