/**
 * contracts/sync-contract.ts — 云同步 REST 契约（唯一权威）。
 *
 * 消费方：cloud-server（实现方）、天枢桌面端 desktop/src/cloud（调用方）。
 * 桌面端持有本文件同步副本，用 scripts/check-contract-sync.mjs 比对 hash 防漂移。
 *
 * 设计要点（docs/cloud-sync-development-plan.md §2.2/§3）：
 * - 全手动同步：无任何自动触发，同步回合 = 一次 manifest 对账 + 增量上传/下载。
 * - 冲突 = LWW 按最新时间（服务端时间为裁决时钟）。
 * - 删除 = 墓碑（tombstone），防「旧机器把删掉的东西传回来」。
 */

// ── 实体类型与路径前缀 ──

export const ENTITY_TYPES = ['character', 'skill-package', 'config'] as const
export type EntityType = (typeof ENTITY_TYPES)[number]

/** 实体类型 → dataDir 相对路径前缀（POSIX 风格）。config 实体 id 恒为 '-'。 */
export const ENTITY_PREFIX: Record<EntityType, (id: string) => string> = {
  character: id => `characters/${id}/`,
  'skill-package': id => `skills/${id}/`, // id = "<category>/<pkgId>"
  config: () => 'config/',
}

// ── 文件条目 ──

/** manifest 中的单个文件条目（本地与云端共用）。 */
export interface FileEntry {
  /** dataDir 相对路径，POSIX 风格（'/' 分隔），含实体前缀。 */
  path: string
  /** sha256（hex 小写）。 */
  hash: string
  size: number
  /** 本地 mtime（客户端扫描时）；服务端忽略此字段，LWW 用服务端 updated_at。 */
  mtime: number
}

/** 服务端权威清单条目 = FileEntry + 服务端元数据。 */
export interface RemoteFileEntry extends FileEntry {
  /** 最后写入设备 id。 */
  originDevice: string | null
  /** 服务端接收时间（ms epoch）= LWW 依据。 */
  updatedAt: number
  /** 非空 = 已删除（墓碑），不应再下载、本地同名文件应删除。 */
  deletedAt: number | null
}

// ── 同步回合 ──

/** diff 结果分类。 */
export type FileOpKind = 'upsert' | 'delete'

/** 客户端向服务端提交的单个操作。 */
export interface FileOp {
  kind: FileOpKind
  path: string
  /** upsert 必填；delete 时省略。 */
  hash?: string
  size?: number
  /** 客户端文件 mtime（ms）= LWW 裁决依据（upsert/delete 均必填）。 */
  mtime: number
}

/** begin-upload 响应：服务端缺失、需要客户端实际上传的 hash 列表（去重后）。 */
export interface BeginUploadResult {
  missingHashes: string[]
}

/** commit 响应中单个路径的裁决结果。 */
export interface CommitOpResult {
  path: string
  kind: FileOpKind
  /** accepted = 本次操作生效；superseded = 云端较新被拒绝（LWW，冲突清单用）。 */
  outcome: 'accepted' | 'superseded'
  /** 被覆盖的云端版本（superseded 时回传，供客户端了解现状）。 */
  cloudEntry?: RemoteFileEntry
}

/** 一次同步回合 = GET manifest → diff → begin-upload → PUT blobs → commit。 */
export interface SyncRoundResult {
  applied: CommitOpResult[]
  conflicts: CommitOpResult[] // outcome === 'superseded' 的子集
  serverTime: number
}

// ── 设备 ──

export interface SyncDevice {
  id: string
  name: string
  os: string
  machineId: string
  createdAt: number
  lastSyncAt: number | null
}

// ── 错误码（body.error 统一用这些字符串）──

export type SyncErrorCode =
  | 'unauthorized' // 401
  | 'forbidden_path' // 400 路径不在白名单/越界
  | 'quota_exceeded' // 413
  | 'file_too_large' // 413
  | 'device_offline'
  | 'not_found' // 404
  | 'conflict' // 409
  | 'internal' // 500
