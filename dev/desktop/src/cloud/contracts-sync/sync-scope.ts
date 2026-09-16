/**
 * contracts/sync-scope.ts — 同步范围与安全边界（两端共用，hash 校验防漂移）。
 *
 * 同步模式 = 按需逐个实体（角色/技能包/配置），没有整库同步；
 * 本清单是「允许出现在云端路径里的前缀」硬边界 + 排除规则。
 */

/** 允许上传/下载的顶层前缀（白名单，超出即 400 forbidden_path）。 */
export const ALLOWED_TOP_PREFIXES = [
  'characters/',
  'skills/',
  'config/',
] as const

/** 即使命中白名单也强制排除的相对路径模式（防呆：运行时数据/备份/临时文件）。 */
export const ALWAYS_EXCLUDED = [
  /^config\/model-usage\.json$/, // 运行统计数据，非配置
  /\.sync-backup\//, // 同步备份目录自身
  /(^|\/)\.git(\/|$)/,
  /(^|\/)node_modules(\/|$)/,
  /\.(tmp|log|bak-)\d*$/i,
  /~$/,
] as const

/** 单文件上限（字节）= 50MB。 */
export const MAX_FILE_SIZE = 50 * 1024 * 1024

/** 每账号配额：500MB / 5000 文件。 */
export const QUOTA_MAX_BYTES = 500 * 1024 * 1024
export const QUOTA_MAX_FILES = 5000

/** 墓碑保留天数。 */
export const TOMBSTONE_RETENTION_DAYS = 90

/** 被覆盖版本（冲突备份）保留天数。 */
export const CONFLICT_BACKUP_DAYS = 30

/**
 * 路径合法性校验：POSIX 风格、禁止穿越、必须在白名单前缀内且不被排除。
 * 返回 null = 合法；否则返回错误说明。
 */
export function validatePath(path: string): string | null {
  if (!path || typeof path !== 'string') return 'path is required'
  if (path.includes('\\')) return 'path must use POSIX separators'
  if (path.startsWith('/') || /^[a-zA-Z]:/.test(path)) return 'absolute path not allowed'
  if (path.includes('..')) return 'path traversal not allowed'
  if (path.includes('\0')) return 'invalid characters'
  const allowed = (ALLOWED_TOP_PREFIXES as readonly string[]).some(p => path.startsWith(p))
  if (!allowed) return `path prefix not in sync scope: ${path}`
  for (const rule of ALWAYS_EXCLUDED) {
    if (rule.test(path)) return `path excluded from sync: ${path}`
  }
  return null
}
