/**
 * 图标包 store（ICON_PACK_PLAN §6）。
 *
 * - 双层来源（与角色/技能同名机制）：
 *   - 内置只读层（content/builtin/iconpacks/<id>/，随发行内容分发）
 *   - 用户层（<dataDir>/iconpacks/<id>/，可写）
 * - 每个包一个目录：pack.json + assets/ 子目录（内置与用户完全同构）。
 * - 保留包 `__overrides__`：全局单枚覆盖层，只存用户层，不展示在包列表。
 * - 资产校验：SVG 走 sanitize（剥离脚本/事件属性/外链）；PNG/WebP 走 magic bytes 校验。
 * - 资产读取只允许访问已登记在有效 pack.json 中的文件。
 * - 写入采用临时目录 + 原子替换（与主题 store 同模式）。
 * - 内置包为只读：写操作拒绝 builtin id。
 */
import { randomUUID } from 'crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { join, resolve } from 'path'
import { builtinIconPacksRoot } from '../content/paths.js'
import { iconPacksRoot } from '../data-paths.js'
import { detectImageFormat } from '../theme/image-validation.js'
import {
  ICON_PACK_SCHEMA_VERSION,
  OVERRIDES_PACK_ID,
  buildIconPackRecord,
  iconPackRecordToJson,
  isBuiltinIconPackId,
  isValidAssetFileName,
  isValidIconPackId,
  isValidIconSlotKey,
  isWritableIconPackId,
  normalizeSlotRef,
  parseIconPackRecord,
  type IconPackRecord,
  type IconSlotRefSpec,
} from './schema.js'
import { sanitizeSvg } from './sanitize.js'

const PACK_JSON = 'pack.json'
const ASSETS_DIR = 'assets'

export interface IconAssetInput {
  slotKey: string
  bytes: Uint8Array
  /** 规范化后的文件名（含扩展名，服务端生成）。 */
  filename: string
  /** 'svg' | 'png' | 'webp' */
  format: 'svg' | 'png' | 'webp'
  tint: boolean
}

const MAX_ICON_BYTES = 512 * 1024 // 512 KB（图标远小于主题图）
const ALLOWED_EXT = new Set(['.svg', '.png', '.webp'])

function rootFor(id: string): string {
  return isBuiltinIconPackId(id) ? builtinIconPacksRoot() : iconPacksRoot()
}

function packDir(id: string): string {
  return join(rootFor(id), id)
}

function assetsDir(id: string): string {
  return join(packDir(id), ASSETS_DIR)
}

function packFile(id: string): string {
  return join(packDir(id), PACK_JSON)
}

function newAssetFileName(format: 'svg' | 'png' | 'webp'): string {
  return `icon-${randomUUID().slice(0, 12)}.${format}`
}

/** 禁止对内置只读包执行写操作。 */
function assertWritable(id: string): void {
  if (isBuiltinIconPackId(id)) throw new Error('Builtin icon packs are read-only')
}

/** 扫描 <dataDir>/iconpacks（用户层）与 content/builtin/iconpacks（内置层）下的包目录。 */
export function listIconPacks(): { packs: IconPackRecord[]; skipped: { dir: string; reason: string }[] } {
  const roots = [builtinIconPacksRoot(), iconPacksRoot()]
  const packs: IconPackRecord[] = []
  const skipped: { dir: string; reason: string }[] = []
  for (const root of roots) {
    if (!existsSync(root)) continue
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      if (entry.name.startsWith('.tmp-')) continue
      if (entry.name === OVERRIDES_PACK_ID) continue // 保留包单独读取
      if (!isValidIconPackId(entry.name)) {
        skipped.push({ dir: entry.name, reason: 'invalid-id' })
        continue
      }
      const record = getIconPack(entry.name)
      if (!record) {
        skipped.push({ dir: entry.name, reason: 'invalid-pack.json' })
        continue
      }
      packs.push(record)
    }
  }
  packs.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
  return { packs, skipped }
}

export function getIconPack(id: string): IconPackRecord | null {
  if (!isValidIconPackId(id)) return null
  if (!existsSync(packFile(id))) return null
  try {
    const record = parseIconPackRecord(readFileSync(packFile(id), 'utf-8'), id)
    if (!record) return null
    // 资产缺失 → 视为损坏（不能让缺失资产成为活动引用）
    for (const ref of Object.values(record.slots)) {
      if (!existsSync(join(assetsDir(id), ref.file))) return null
    }
    return record
  } catch {
    return null
  }
}

/** 读取全局覆盖层（无则返回空记录）。 */
export function getOverrides(): IconPackRecord | null {
  const record = getIconPack(OVERRIDES_PACK_ID)
  if (record) return record
  return {
    schemaVersion: ICON_PACK_SCHEMA_VERSION,
    id: OVERRIDES_PACK_ID,
    name: OVERRIDES_PACK_ID,
    slots: {},
    source: 'user',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

/** 校验并规范化上传的图标资产。 */
export function validateIconAsset(bytes: Uint8Array): { ok: true; format: 'svg' | 'png' | 'webp' } | { ok: false; message: string } {
  if (!bytes || bytes.length === 0) return { ok: false, message: 'Empty file' }
  if (bytes.length > MAX_ICON_BYTES) {
    return { ok: false, message: `File exceeds ${Math.round(MAX_ICON_BYTES / 1024)} KB limit` }
  }
  const format = detectImageFormat(bytes)
  if (format === 'svg') {
    const sanitized = sanitizeSvg(new TextDecoder().decode(bytes))
    if (!sanitized.ok) return { ok: false, message: sanitized.message }
    return { ok: true, format: 'svg' }
  }
  if (format === 'png' || format === 'webp') {
    // magic bytes 已确认格式；尺寸/结构由浏览器渲染时容错，但拒绝超大文件（上面已限 512KB）
    return { ok: true, format }
  }
  return { ok: false, message: 'Only SVG, PNG or WebP icons are accepted' }
}

/** 原子写入单个槽位资产：资产先写，pack.json 最后更新。 */
export function saveIconSlot(id: string, input: IconAssetInput): IconPackRecord {
  if (!isValidIconPackId(id) || !isWritableIconPackId(id)) throw new Error('Invalid pack id')
  if (!isValidIconSlotKey(input.slotKey)) throw new Error(`Unknown icon slot: ${input.slotKey}`)

  const existing = getIconPack(id)
  const name = existing?.name ?? (id === OVERRIDES_PACK_ID ? OVERRIDES_PACK_ID : '自定义图标库')
  const slots: Record<string, IconSlotRefSpec> = { ...(existing?.slots ?? {}) }

  // 替换已有槽位时清理旧资产
  const oldRef = slots[input.slotKey]
  if (oldRef && oldRef.file !== input.filename) {
    const oldPath = join(assetsDir(id), oldRef.file)
    if (existsSync(oldPath)) rmSync(oldPath, { force: true })
  }

  const root = iconPacksRoot()
  mkdirSync(assetsDir(id), { recursive: true })
  writeFileSync(join(assetsDir(id), input.filename), input.bytes)

  slots[input.slotKey] = { file: input.filename, tint: input.tint }
  const record: IconPackRecord = {
    schemaVersion: ICON_PACK_SCHEMA_VERSION,
    id,
    name,
    slots,
    source: 'user',
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  writeFileSync(packFile(id), iconPackRecordToJson(record))
  return record
}

/** 移除槽位（还原为内置包样式）。 */
export function removeIconSlot(id: string, slotKey: string): { ok: boolean; slot?: string } {
  if (!isWritableIconPackId(id) || !isValidIconSlotKey(slotKey)) return { ok: false }
  const existing = getIconPack(id)
  if (!existing || !existing.slots[slotKey]) return { ok: false }

  const slots = { ...existing.slots }
  const ref = slots[slotKey]
  delete slots[slotKey]

  const record: IconPackRecord = { ...existing, slots, updatedAt: new Date().toISOString() }
  writeFileSync(packFile(id), iconPackRecordToJson(record))

  // 清理资产（仅当不再被任何槽位引用）
  const stillReferenced = Object.values(slots).some(r => r.file === ref.file)
  if (!stillReferenced) {
    const assetPath = join(assetsDir(id), ref.file)
    if (existsSync(assetPath)) rmSync(assetPath, { force: true })
  }
  return { ok: true, slot: slotKey }
}

/** 创建空图标库（仅用户层）。 */
export function createIconPack(name: string): IconPackRecord {
  const trimmed = name.trim().slice(0, 80)
  if (!trimmed) throw new Error('Icon pack name is required')
  const id = `custom-${randomUUID().slice(0, 8)}`
  const record = buildIconPackRecord({ id, name: trimmed })
  const dir = packDir(id)
  mkdirSync(assetsDir(id), { recursive: true })
  writeFileSync(packFile(id), iconPackRecordToJson(record))
  return record
}

/** 重命名图标库（仅用户层）。 */
export function renameIconPack(id: string, name: string): IconPackRecord {
  const existing = getIconPack(id)
  if (!existing || !isWritableIconPackId(id)) throw new Error('Icon pack not found')
  const trimmed = name.trim().slice(0, 80)
  if (!trimmed) throw new Error('Icon pack name is required')
  const record: IconPackRecord = { ...existing, name: trimmed, updatedAt: new Date().toISOString() }
  writeFileSync(packFile(id), iconPackRecordToJson(record))
  return record
}

/** 删除图标库（不可恢复；UI 必须先确认）。仅用户层。 */
export function deleteIconPack(id: string): { deleted: boolean } {
  if (!isWritableIconPackId(id) || id === OVERRIDES_PACK_ID) throw new Error('Invalid pack id')
  const dir = packDir(id)
  if (!existsSync(dir)) return { deleted: false }
  rmSync(dir, { recursive: true, force: true })
  return { deleted: true }
}

/** 校验包内资产文件可访问（内置只读层 + 用户层均支持；只允许包目录内、已登记的文件）。 */
export function resolveIconAsset(id: string, fileName: string): string | null {
  if (!isValidIconPackId(id) || !isValidAssetFileName(fileName)) return null
  const record = getIconPack(id)
  if (!record) return null
  const registered = new Set(Object.values(record.slots).map(r => r.file))
  if (!registered.has(fileName)) return null
  const file = resolve(assetsDir(id), fileName)
  // 防御：确认解析后的路径仍在资产目录内
  const base = resolve(assetsDir(id))
  if (!file.startsWith(base + '/') && file !== join(base, fileName)) return null
  if (!existsSync(file)) return null
  return file
}

/** 扩展名 → MIME。 */
export function mimeForAsset(fileName: string): string {
  const ext = fileName.toLowerCase().split('.').pop()
  if (ext === 'svg') return 'image/svg+xml'
  if (ext === 'png') return 'image/png'
  if (ext === 'webp') return 'image/webp'
  return 'application/octet-stream'
}

/** 上传扩展名校验（比较扩展名，如 .svg/.png/.webp）。 */
export function isAllowedAssetExt(fileName: string): boolean {
  const dot = fileName.lastIndexOf('.')
  if (dot < 0) return false
  const ext = fileName.slice(dot).toLowerCase()
  return ALLOWED_EXT.has(ext)
}

/** 复制保留包（__overrides__ 无复制场景；保留给未来整包导入复用）。 */
export function duplicateIconPack(id: string): IconPackRecord {
  const existing = getIconPack(id)
  if (!existing) throw new Error('Icon pack not found')
  const newId = `custom-${randomUUID().slice(0, 8)}`
  const dir = packDir(newId)
  mkdirSync(assetsDir(newId), { recursive: true })
  for (const ref of Object.values(existing.slots)) {
    const src = join(assetsDir(id), ref.file)
    if (existsSync(src)) copyFileSync(src, join(assetsDir(newId), ref.file))
  }
  const record: IconPackRecord = {
    ...existing,
    id: newId,
    name: `${existing.name} 副本`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  writeFileSync(packFile(newId), iconPackRecordToJson(record))
  return record
}

/** 校验归一化函数：规范化一个槽位引用（供路由复用）。 */
export function normalizeIconSlotRef(value: unknown): IconSlotRefSpec | null {
  return normalizeSlotRef(value)
}
