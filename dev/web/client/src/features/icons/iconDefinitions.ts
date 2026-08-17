/**
 * 图标包元数据与内建常量。
 *
 * - 所有图标包（内置 + 用户）共用同一结构：pack.json + assets/*.svg。
 *   差异仅在根路径：内置只读层 content/builtin/iconpacks/<id>/，用户层
 *   <dataDir>/iconpacks/<id>/。客户端不编译任何内置 path 数据，全部经
 *   /api/iconpacks 拉取（内置包同样以 asset URL 下发，按用户包同法渲染）。
 * - 默认包 id 固定为 lucide（偏好规范化与解析兜底使用）。
 */

/** 内置图标包 id 固定清单（与服务端 schema BUILTIN_ICON_PACK_IDS 对齐）。 */
export const BUILTIN_ICON_PACK_IDS = ['lucide', 'streamline-freehand'] as const

/** 默认包 id（解析兜底）：lucide。 */
export const DEFAULT_ICON_PACK_ID = 'lucide'

export function isBuiltinIconPackId(id: string): boolean {
  return (BUILTIN_ICON_PACK_IDS as readonly string[]).includes(id)
}