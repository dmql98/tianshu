/**
 * 图标包偏好（ICON_PACK_PLAN §4）。
 *
 * 存储键 `tianshu:iconPackPreferences`（versioned JSON）。**只保存轻量 selection：激活包 id**；
 * 用户图标包的完整定义与资产文件事实来源在服务端 <dataDir>/iconpacks，绝不写入 localStorage
 * （与主题偏好同一原则：localStorage 只放选择，不放内容）。
 *
 * selection 形状：`{ packId: string }`
 * - `'lucide'` / `'streamline-freehand'`：激活的内置包（默认 lucide）
 * - `'custom-xxx'`：激活的用户包（服务端 <dataDir>/iconpacks/<id>/）
 *
 * 覆盖层（overrides）是**全局单枚替换**，作用于任意激活包之上。覆盖资产文件本身存服务端
 * 保留包 `__overrides__`（与自定义包同一套 pack.json + assets 机制），客户端只读：
 * 解析顺序 = 覆盖层槽位 → 激活用户包槽位 → 激活内置包槽位 → 默认兜底。
 *
 * 迁移：旧键 `tianshu:iconPack`（纯字符串 packId）→ v1 selection。损坏/未知一律回退默认。
 */
import { DEFAULT_ICON_PACK_ID } from './iconDefinitions'

export interface IconPackPreferences {
  version: 1
  selection: {
    /** 激活包 id（内置或用户包）。 */
    packId: string
  }
}

export const ICON_PACK_PREFERENCES_STORAGE_KEY = 'tianshu:iconPackPreferences'
export const LEGACY_ICON_PACK_STORAGE_KEY = 'tianshu:iconPack'
export const ICON_PACK_CHANGED_EVENT = 'tianshu:iconpack-changed'

export const DEFAULT_ICON_PACK_PREFERENCES: IconPackPreferences = {
  version: 1,
  selection: { packId: DEFAULT_ICON_PACK_ID },
}

export function getDefaultStorage(): Storage | null {
  return typeof window === 'undefined' ? null : window.localStorage
}

// ── 规范化 ──

/** 校验并规范化 selection。未知/非法 pack id 回退默认包。 */
export function normalizeIconPackSelection(value: unknown): { packId: string } {
  if (!value || typeof value !== 'object') return { packId: DEFAULT_ICON_PACK_ID }
  const candidate = value as { packId?: unknown }
  if (
    typeof candidate.packId === 'string' &&
    /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(candidate.packId)
  ) {
    return { packId: candidate.packId }
  }
  return { packId: DEFAULT_ICON_PACK_ID }
}

export function normalizeIconPackPreferences(value: unknown): IconPackPreferences {
  if (value && typeof value === 'object') {
    const candidate = value as Partial<IconPackPreferences>
    if (candidate.version !== undefined && candidate.version !== 1) {
      // 未来/未知格式：安全回退默认
      return { ...DEFAULT_ICON_PACK_PREFERENCES }
    }
    return { version: 1, selection: normalizeIconPackSelection(candidate.selection) }
  }
  return { ...DEFAULT_ICON_PACK_PREFERENCES }
}

// ── 存储 ──

export function loadIconPackPreferences(storage: Storage | null = getDefaultStorage()): IconPackPreferences {
  if (!storage) return { ...DEFAULT_ICON_PACK_PREFERENCES }
  try {
    const raw = storage.getItem(ICON_PACK_PREFERENCES_STORAGE_KEY)
    if (raw) return normalizeIconPackPreferences(JSON.parse(raw))
  } catch {
    /* 损坏数据回退迁移/默认 */
  }
  const migrated = migrateLegacyIconPackSelection(storage)
  if (migrated) return migrated
  return { ...DEFAULT_ICON_PACK_PREFERENCES }
}

export function saveIconPackPreferences(
  preferences: IconPackPreferences,
  storage: Storage | null = getDefaultStorage(),
): IconPackPreferences {
  const normalized = normalizeIconPackPreferences(preferences)
  if (storage) storage.setItem(ICON_PACK_PREFERENCES_STORAGE_KEY, JSON.stringify(normalized))
  return normalized
}

/**
 * 旧键 `tianshu:iconPack`（纯字符串 packId，如 'lucide'）迁移为 v1 JSON。
 * 不删除旧键，便于回滚与审计。
 */
export function migrateLegacyIconPackSelection(storage: Storage | null = getDefaultStorage()): IconPackPreferences | null {
  if (!storage) return null
  const legacy = storage.getItem(LEGACY_ICON_PACK_STORAGE_KEY)
  if (legacy === null) return null
  const selection = normalizeIconPackSelection({ packId: legacy })
  const migrated: IconPackPreferences = { version: 1, selection }
  return saveIconPackPreferences(migrated, storage)
}

/** 读当前激活包 id（不触发副作用）。 */
export function appliedIconPackId(storage: Storage | null = getDefaultStorage()): string {
  return loadIconPackPreferences(storage).selection.packId || DEFAULT_ICON_PACK_ID
}
