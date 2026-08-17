/**
 * 图标包 schema（ICON_PACK_PLAN §6）。
 *
 * pack.json 结构（与主题 theme.json 同构：schemaVersion + id + 元数据 + 槽位映射）：
 * {
 *   "schemaVersion": 1,
 *   "id": "custom-abc123",
 *   "name": "我的图标库",
 *   "slots": { "nav-chat": { "file": "chat.svg", "tint": true } },
 *   "createdAt": "...",
 *   "updatedAt": "..."
 * }
 *
 * 特殊保留包 `__overrides__`：全局单枚覆盖层（不展示在包列表，仅提供槽位映射）。
 */
import { ICON_SLOT_KEYS } from './slot-keys.js'

export const ICON_PACK_SCHEMA_VERSION = 1

/** 保留包 id：全局覆盖层。 */
export const OVERRIDES_PACK_ID = '__overrides__'

/** 内置图标包 id（只读层；与用户包共用 pack.json + assets 结构，仅根目录不同）。 */
export const BUILTIN_ICON_PACK_IDS = ['lucide', 'streamline-freehand'] as const

export function isBuiltinIconPackId(value: unknown): value is (typeof BUILTIN_ICON_PACK_IDS)[number] {
  return typeof value === 'string' && (BUILTIN_ICON_PACK_IDS as readonly string[]).includes(value)
}

export interface IconSlotRefSpec {
  /** 资产文件名（iconpacks/<id>/assets/ 内，服务端生成）。 */
  file: string
  /** 是否随主题着色（单色 SVG → currentColor 渲染）。 */
  tint: boolean
}

export interface IconPackRecord {
  schemaVersion: number
  id: string
  name: string
  /** 槽位 key → 资产引用。 */
  slots: Record<string, IconSlotRefSpec>
  /** 来源：内置只读层 or 用户层（内置包强制 readOnly）。 */
  source: 'builtin' | 'user'
  createdAt: string
  updatedAt: string
}

/** 与客户端 ICON_SLOT_KEYS 对齐的槽位校验（客户端 iconSlots.ts 是唯一事实来源）。 */
export function isValidIconSlotKey(value: unknown): value is string {
  return typeof value === 'string' && ICON_SLOT_KEYS.has(value)
}

/** 包 id 校验：custom- 前缀 + 安全字符，或内置包 id（lucide/streamline-freehand），或覆盖层。 */
export function isValidIconPackId(value: unknown): value is string {
  if (typeof value !== 'string' || !value) return false
  if (value === OVERRIDES_PACK_ID) return true
  if (isBuiltinIconPackId(value)) return true
  return /^custom-[a-z0-9][a-z0-9-]{0,63}$/i.test(value)
}

/** 可写包 id：覆盖层或用户包（内置包只读，禁止写入）。 */
export function isWritableIconPackId(value: unknown): value is string {
  return typeof value === 'string' && (value === OVERRIDES_PACK_ID || /^custom-[a-z0-9][a-z0-9-]{0,63}$/i.test(value))
}

/** 资产文件名：禁止路径分隔符、`..`、绝对路径与隐藏文件（与主题同规则）。 */
export function isValidAssetFileName(value: unknown): value is string {
  if (typeof value !== 'string' || !value) return false
  if (value.length > 128) return false
  if (value.includes('/') || value.includes('\\') || value.includes('..')) return false
  if (value.startsWith('.') || value.endsWith('.')) return false
  return /^[a-zA-Z0-9._-]+$/.test(value)
}

/** 槽位引用校验。 */
export function normalizeSlotRef(value: unknown): IconSlotRefSpec | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as { file?: unknown; tint?: unknown }
  if (!isValidAssetFileName(candidate.file)) return null
  return { file: candidate.file, tint: candidate.tint === true }
}

/** 解析并规范化 pack.json；非法返回 null。 */
export function parseIconPackRecord(raw: string, idFromDir?: string): IconPackRecord | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const candidate = parsed as Record<string, unknown>

  const id = idFromDir && isValidIconPackId(idFromDir) ? idFromDir : candidate.id
  if (!isValidIconPackId(id)) return null
  if (candidate.schemaVersion !== ICON_PACK_SCHEMA_VERSION) return null
  if (typeof candidate.name !== 'string' || !candidate.name.trim()) return null

  const slots: Record<string, IconSlotRefSpec> = {}
  if (candidate.slots && typeof candidate.slots === 'object') {
    for (const [key, ref] of Object.entries(candidate.slots as Record<string, unknown>)) {
      if (!isValidIconSlotKey(key)) continue
      const normalized = normalizeSlotRef(ref)
      if (normalized) slots[key] = normalized
    }
  }

  return {
    schemaVersion: ICON_PACK_SCHEMA_VERSION,
    id,
    name: candidate.name.trim().slice(0, 80),
    slots,
    source: isBuiltinIconPackId(id) ? 'builtin' : 'user',
    createdAt: typeof candidate.createdAt === 'string' ? candidate.createdAt : new Date().toISOString(),
    updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : new Date().toISOString(),
  }
}

/** 构建待保存的包记录。 */
export function buildIconPackRecord(input: {
  id: string
  name: string
  slots?: Record<string, IconSlotRefSpec>
}): IconPackRecord {
  const now = new Date().toISOString()
  const slots: Record<string, IconSlotRefSpec> = {}
  if (input.slots) {
    for (const [key, ref] of Object.entries(input.slots)) {
      const normalized = normalizeSlotRef(ref)
      if (normalized && isValidIconSlotKey(key)) slots[key] = normalized
    }
  }
  return {
    schemaVersion: ICON_PACK_SCHEMA_VERSION,
    id: input.id,
    name: input.name.trim().slice(0, 80),
    slots,
    source: isBuiltinIconPackId(input.id) ? 'builtin' : 'user',
    createdAt: now,
    updatedAt: now,
  }
}

export function iconPackRecordToJson(record: IconPackRecord): string {
  return JSON.stringify(record, null, 2)
}
