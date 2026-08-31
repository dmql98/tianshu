/**
 * sessionListPrefs.ts — 会话列表的本地偏好层（对齐 penguin 的 session-seen / session-order / pinned-groups 思路）。
 *
 * - 未读标记：服务端无 read receipt，纯前端用 localStorage 记录「用户最后查看每个会话的时间」，与会话 updated_at 对比。
 * - 手动拖拽排序：每个工作区组一份会话 id 顺序；不在顺序中的新会话浮动到分区最前（保 recency）。
 * - 组置顶：工作区组可置顶，置顶组排前。
 *
 * 天枢无 project 概念，全部用全局 key；localStorage 命名沿用 tianshu. 前缀。
 */
import { create } from 'zustand'

export interface SessionListPrefs {
  /** 首次写入的时间戳：早于它的会话视为已读（避免启用功能时整片点亮）。 */
  seededAt: number
  /** sessionId → 用户最后查看的 epoch ms。 */
  seen: Record<string, number>
  /** 已置顶的工作区组 key 列表（保持置顶顺序）。 */
  pinnedGroups: string[]
  /** groupKey → 手动排序的会话 id 顺序。 */
  order: Record<string, string[]>
}

const STORAGE_KEY = 'tianshu.sessionListPrefs.v1'

const EMPTY: SessionListPrefs = { seededAt: 0, seen: {}, pinnedGroups: [], order: {} }

export function parsePrefs(raw: string | null): SessionListPrefs {
  if (!raw) return EMPTY
  try {
    const p: unknown = JSON.parse(raw)
    if (typeof p !== 'object' || p === null) return EMPTY
    const o = p as { seededAt?: unknown; seen?: unknown; pinnedGroups?: unknown; order?: unknown }
    const out: SessionListPrefs = {
      seededAt: typeof o.seededAt === 'number' && Number.isFinite(o.seededAt) ? o.seededAt : 0,
      seen: {},
      pinnedGroups: Array.isArray(o.pinnedGroups) ? o.pinnedGroups.filter((x): x is string => typeof x === 'string') : [],
      order: {},
    }
    if (typeof o.seen === 'object' && o.seen !== null) {
      for (const [k, v] of Object.entries(o.seen as Record<string, unknown>)) {
        if (typeof v === 'number' && Number.isFinite(v)) out.seen[k] = v
      }
    }
    if (typeof o.order === 'object' && o.order !== null) {
      for (const [k, v] of Object.entries(o.order as Record<string, unknown>)) {
        if (Array.isArray(v)) out.order[k] = v.filter((x): x is string => typeof x === 'string')
      }
    }
    return out
  } catch {
    return EMPTY
  }
}

function safeLoad(): SessionListPrefs {
  try {
    return parsePrefs(localStorage.getItem(STORAGE_KEY))
  } catch {
    return EMPTY
  }
}

function safeSave(p: SessionListPrefs): SessionListPrefs {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p))
  } catch {
    /* quota / private mode：内存副本仍服务本标签页 */
  }
  return p
}

/** 会话是否未读：活动时间晚于用户最后查看（或首次启用基线）。 */
export function isSessionUnread(prefs: SessionListPrefs, sessionId: string, updatedAt: number): boolean {
  if (!Number.isFinite(updatedAt)) return false
  return updatedAt > (prefs.seen[sessionId] ?? prefs.seededAt)
}

/** 把「现在正看着这个会话」记为已读。marker 取 max(now, updatedAt)，避免本机时钟落后服务端导致未读卡住。 */
export function markSessionSeen(
  prefs: SessionListPrefs,
  sessionId: string,
  updatedAt: number,
  now: number = Date.now(),
): SessionListPrefs {
  const activeAt = Number.isFinite(updatedAt) ? updatedAt : 0
  const at = Math.max(now, activeAt)
  if (prefs.seen[sessionId] === at) return prefs
  return {
    ...prefs,
    seededAt: prefs.seededAt || now,
    seen: { ...prefs.seen, [sessionId]: at },
  }
}

export function forgetSessionSeen(prefs: SessionListPrefs, sessionId: string): SessionListPrefs {
  if (!(sessionId in prefs.seen)) return prefs
  const seen = { ...prefs.seen }
  delete seen[sessionId]
  return { ...prefs, seen }
}

/** 新会话（不在顺序中）保 recency 排最前；已排序会话按存储顺序。 */
export function applyManualOrder<T>(
  rows: readonly T[],
  keyOf: (row: T) => string,
  order: readonly string[],
): T[] {
  if (order.length === 0) return [...rows]
  const pos = new Map(order.map((id, i) => [id, i]))
  const unlisted: T[] = []
  const listed: T[] = []
  for (const row of rows) (pos.has(keyOf(row)) ? listed : unlisted).push(row)
  listed.sort((a, b) => (pos.get(keyOf(a)) ?? 0) - (pos.get(keyOf(b)) ?? 0))
  return [...unlisted, ...listed]
}

/** 置顶簇优先：置顶会话排前，其余在后，各自内部保输入顺序。 */
export function pinnedFirst<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  pinned: ReadonlySet<string>,
): T[] {
  if (pinned.size === 0) return [...items]
  const pin: T[] = []
  const rest: T[] = []
  for (const item of items) (pinned.has(keyOf(item)) ? pin : rest).push(item)
  return [...pin, ...rest]
}

/** 完整行排序：先按 recency（updatedAt desc）排，再置顶簇优先，最后在各自分区内套手动顺序。 */
export function orderSessionRows<T>(
  rows: readonly T[],
  keyOf: (row: T) => string,
  opts: { pinned: ReadonlySet<string>; order: readonly string[]; recencyOf: (row: T) => number },
): T[] {
  const sorted = [...rows].sort(
    (a, b) => opts.recencyOf(b) - opts.recencyOf(a) || (keyOf(b) < keyOf(a) ? -1 : keyOf(b) > keyOf(a) ? 1 : 0),
  )
  if (opts.order.length === 0) return pinnedFirst(sorted, keyOf, opts.pinned)
  const pin = sorted.filter((r) => opts.pinned.has(keyOf(r)))
  const rest = sorted.filter((r) => !opts.pinned.has(keyOf(r)))
  return [...applyManualOrder(pin, keyOf, opts.order), ...applyManualOrder(rest, keyOf, opts.order)]
}

/** 拖拽落点后：把该分组的整条显示序列写进存储（其他组保持相对顺序）。 */
export function commitOrder(
  prefs: SessionListPrefs,
  groupKey: string,
  sequence: readonly string[],
): SessionListPrefs {
  return { ...prefs, order: { ...prefs.order, [groupKey]: [...sequence] } }
}

/** 删除会话时清理各分组顺序中的 id。 */
export function removeSessionFromOrder(prefs: SessionListPrefs, sessionId: string): SessionListPrefs {
  let changed = false
  const order: Record<string, string[]> = {}
  for (const [k, ids] of Object.entries(prefs.order)) {
    if (!ids.includes(sessionId)) {
      order[k] = ids
      continue
    }
    changed = true
    order[k] = ids.filter((id) => id !== sessionId)
  }
  return changed ? { ...prefs, order } : prefs
}

/** 切换某工作区组的置顶。 */
export function toggleGroupPin(prefs: SessionListPrefs, groupKey: string): SessionListPrefs {
  const pinned = prefs.pinnedGroups.includes(groupKey)
  return {
    ...prefs,
    pinnedGroups: pinned ? prefs.pinnedGroups.filter((k) => k !== groupKey) : [...prefs.pinnedGroups, groupKey],
  }
}

// ── zustand store（响应式 + 自动持久化） ──

interface SessionListPrefsStore extends SessionListPrefs {
  setPrefs: (p: SessionListPrefs) => void
}

export const useSessionListPrefs = create<SessionListPrefsStore>((set) => ({
  ...safeLoad(),
  setPrefs: (p) => set(safeSave(p)),
}))