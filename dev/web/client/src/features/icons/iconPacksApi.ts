/**
 * 图标包客户端 API（ICON_PACK_PLAN §6）。
 *
 * 与服务端 /api/iconpacks 路由对齐：
 * GET    /api/iconpacks                       → 列表 + 覆盖层
 * POST   /api/iconpacks                        → 创建空图标库
 * PUT    /api/iconpacks/:id                    → 重命名
 * DELETE /api/iconpacks/:id                    → 删除
 * PUT    /api/iconpacks/:id/slots/:slotKey     → 上传/替换单槽位（multipart）
 * DELETE /api/iconpacks/:id/slots/:slotKey     → 移除槽位
 *
 * 服务端 <dataDir>/iconpacks 是用户包的唯一事实来源；客户端只拉取视图。
 */
import { apiDelete, apiGet, apiPost, apiPut, apiUrl } from '@/api/client'

/** 槽位资产引用（服务端视图：url 为 API 相对路径）。 */
export interface IconSlotRef {
  url: string
  tint: boolean
}

/** 图标包来源：内置只读层 or 用户层。 */
export type IconPackSource = 'builtin' | 'user'

/** 用户/内置图标包（服务端视图；内置与用户同构，读法一致）。 */
export interface CustomIconPack {
  id: string
  name: string
  /** 来源：builtin（content/builtin 只读）or user（<dataDir> 可写）。 */
  source: IconPackSource
  /** 内置包只读：禁止上传/重命名/删除。 */
  readOnly: boolean
  /** 槽位 key → 资产引用。 */
  slots: Record<string, IconSlotRef>
  createdAt: string
  updatedAt: string
  slotCount: number
}

/** 全局覆盖层：槽位 key → 资产引用。 */
export type IconOverrideRef = IconSlotRef

export interface IconPacksResponse {
  packs: CustomIconPack[]
  overrides: Record<string, IconOverrideRef>
}

/** 拉取用户包列表 + 覆盖层（url 转绝对地址）。 */
export async function fetchCustomIconPacks(): Promise<IconPacksResponse> {
  const data = await apiGet<IconPacksResponse>('/api/iconpacks')
  const packs = (data.packs ?? []).map(pack => ({
    ...pack,
    slots: Object.fromEntries(
      Object.entries(pack.slots).map(([key, ref]) => [key, { ...ref, url: apiUrl(ref.url) }]),
    ),
  }))
  const overrides: Record<string, IconOverrideRef> = {}
  for (const [key, ref] of Object.entries(data.overrides ?? {})) {
    overrides[key] = { ...ref, url: apiUrl(ref.url) }
  }
  return { packs, overrides }
}

/** 创建空图标库。 */
export async function createIconPack(name: string): Promise<CustomIconPack> {
  const dto = await apiPost<CustomIconPack>('/api/iconpacks', { name })
  return dto
}

/** 重命名图标库。 */
export async function renameIconPack(id: string, name: string): Promise<CustomIconPack> {
  const dto = await apiPut<CustomIconPack>(`/api/iconpacks/${encodeURIComponent(id)}`, { name })
  return dto
}

/** 删除图标库。 */
export async function deleteIconPack(id: string): Promise<void> {
  await apiDelete(`/api/iconpacks/${encodeURIComponent(id)}`)
}

async function apiMultipart(path: string, form: FormData): Promise<CustomIconPack> {
  const res = await fetch(apiUrl(path), { method: 'PUT', body: form })
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text().catch(() => '')}`)
  return res.json()
}

/**
 * 上传/替换单槽位图标。
 * @param id 包 id（内置包不可写；覆盖层用服务端保留 id）
 * @param slotKey 语义槽位 key
 * @param file 图标文件（SVG/PNG/WebP）
 * @param tint 是否随主题着色（单色 SVG）
 */
export async function uploadIconSlot(
  id: string,
  slotKey: string,
  file: File | Blob,
  tint: boolean,
): Promise<CustomIconPack> {
  const form = new FormData()
  form.append('file', file, (file as File).name || `icon.${extFromBlob(file)}`)
  form.append('tint', String(tint))
  return apiMultipart(`/api/iconpacks/${encodeURIComponent(id)}/slots/${encodeURIComponent(slotKey)}`, form)
}

/** 移除槽位（还原为内置样式）。 */
export async function removeIconSlot(id: string, slotKey: string): Promise<void> {
  await apiDelete(`/api/iconpacks/${encodeURIComponent(id)}/slots/${encodeURIComponent(slotKey)}`)
}

function extFromBlob(file: File | Blob): string {
  const mime = file.type || ''
  if (mime.includes('svg')) return 'svg'
  if (mime.includes('png')) return 'png'
  if (mime.includes('webp')) return 'webp'
  return 'svg'
}

/** 资产 URL（供 <img>/CSS mask 引用）。 */
export function iconAssetUrl(id: string, file: string): string {
  return apiUrl(`/api/iconpacks/${encodeURIComponent(id)}/assets/${encodeURIComponent(file)}`)
}
