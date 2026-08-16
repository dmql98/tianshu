import { getDb } from './schema.js'
import { withTransaction } from './sqlite-db.js'
import { normalizeStrategy } from '../agent/strategy.js'

export interface SessionRow {
  id: string; character_id: string; title: string
  model: string | null; provider_id: string | null; workspace: string | null
  workspaces: string | null; dataspace: string | null
  parent_id: string | null; active_group: string | null
  session_type: 'chat' | 'event'; event_id: string | null
  character_binding_mode: 'follow_latest' | 'pinned'
  pinned_character_revision_id: string | null
  forked_from_session_id: string | null
  forked_from_message_id: number | null
  event_occurrence_id: string | null
  approval_mode: string
  execution_mode: string
  current_strategy: string | null
  reasoning_effort: string | null
  context_window: number | null
  input_tokens: number; output_tokens: number
  cache_hit_tokens: number; cache_miss_tokens: number; cache_hit_ratio: string | null
  compaction_summary: string | null; compaction_until_id: number | null
  created_at: number; updated_at: number
}

/** 最近普通会话摘要（含最后一条 user/assistant 消息的纯文本预览）。 */
export interface RecentSessionRow extends SessionRow {
  last_message_preview: string | null
}

/** 最近消息摘要最大长度（Unicode 码点）。 */
export const RECENT_PREVIEW_MAX = 120

/**
 * 消息摘要清洗：去控制字符 → 压缩连续空白 → trim → 截断（不切坏代理对）。
 */
export function cleanMessagePreview(content: string | null | undefined): string {
  if (!content) return ''
  const withoutControl = content.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
  const collapsed = withoutControl.replace(/\s+/g, ' ').trim()
  const chars = [...collapsed]
  return chars.slice(0, RECENT_PREVIEW_MAX).join('')
}

const INSERT_COLS = 'id, character_id, title, model, provider_id, workspace, workspaces, dataspace, parent_id, active_group, session_type, event_id, character_binding_mode, pinned_character_revision_id, forked_from_session_id, forked_from_message_id, event_occurrence_id, approval_mode, execution_mode, current_strategy, reasoning_effort, context_window, input_tokens, output_tokens, cache_hit_tokens, cache_miss_tokens, cache_hit_ratio, compaction_summary, compaction_until_id, created_at, updated_at'
const INSERT_PARAMS = '@id, @character_id, @title, @model, @provider_id, @workspace, @workspaces, @dataspace, @parent_id, @active_group, @session_type, @event_id, @character_binding_mode, @pinned_character_revision_id, @forked_from_session_id, @forked_from_message_id, @event_occurrence_id, @approval_mode, @execution_mode, @current_strategy, @reasoning_effort, @context_window, @input_tokens, @output_tokens, @cache_hit_tokens, @cache_miss_tokens, @cache_hit_ratio, @compaction_summary, @compaction_until_id, @created_at, @updated_at'
const UPDATE_COLS = 'character_id=@character_id, title=@title, model=@model, provider_id=@provider_id, workspace=@workspace, workspaces=@workspaces, dataspace=@dataspace, parent_id=@parent_id, active_group=@active_group, session_type=@session_type, event_id=@event_id, character_binding_mode=@character_binding_mode, pinned_character_revision_id=@pinned_character_revision_id, forked_from_session_id=@forked_from_session_id, forked_from_message_id=@forked_from_message_id, event_occurrence_id=@event_occurrence_id, approval_mode=@approval_mode, execution_mode=@execution_mode, current_strategy=@current_strategy, reasoning_effort=@reasoning_effort, context_window=@context_window, input_tokens=@input_tokens, output_tokens=@output_tokens, cache_hit_tokens=@cache_hit_tokens, cache_miss_tokens=@cache_miss_tokens, cache_hit_ratio=@cache_hit_ratio, compaction_summary=@compaction_summary, compaction_until_id=@compaction_until_id, updated_at=@updated_at'

export const sessionStore = {
  list(limit = 50): SessionRow[] {
    return getDb().prepare('SELECT * FROM sessions ORDER BY updated_at DESC LIMIT ?').all(limit) as SessionRow[]
  },
  /**
   * 最近普通对话（HOME_PAGE_DEVELOPMENT_PLAN §4.2）：
   * - 只返回 session_type='chat'，排除事件自动创建的会话。
   * - 包含分支会话（parent_id 非空照常返回）。
   * - 按 updated_at DESC 排序；limit 限制 1..10。
   * - 单条 SQL：相关子查询取最近一条 user/assistant 消息做纯文本预览。
   */
  listRecent(limit = 3): RecentSessionRow[] {
    const raw = typeof limit === 'number' && Number.isFinite(limit) ? Math.floor(limit) : 3
    const clamped = Math.min(10, Math.max(1, raw))
    const rows = getDb().prepare(`
      SELECT s.*, (
        SELECT m.content FROM messages m
        WHERE m.session_id = s.id AND m.role IN ('user', 'assistant')
        ORDER BY m.id DESC LIMIT 1
      ) AS last_message_preview
      FROM sessions s
      WHERE s.session_type = 'chat'
      ORDER BY s.updated_at DESC
      LIMIT ?
    `).all(clamped) as RecentSessionRow[]
    for (const row of rows) {
      row.last_message_preview = cleanMessagePreview(row.last_message_preview)
      if (!row.last_message_preview) row.last_message_preview = null
    }
    return rows
  },
  getById(id: string): SessionRow | null {
    return getDb().prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | null
  },
  getChildren(parentId: string): SessionRow[] {
    return getDb().prepare('SELECT * FROM sessions WHERE parent_id = ? ORDER BY created_at ASC').all(parentId) as SessionRow[]
  },
  nextForkTitle(sourceTitle: string): string {
    const base = (sourceTitle || '新会话').trim() || '新会话'
    const rows = getDb().prepare('SELECT title FROM sessions WHERE title LIKE ?').all(`${base}-分支%`) as { title: string }[]
    const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = new RegExp(`^${escaped}-分支(\\d+)$`)
    let max = 0
    for (const row of rows) {
      const match = pattern.exec(row.title)
      if (match) max = Math.max(max, Number(match[1]))
    }
    return `${base}-分支${max + 1}`
  },
  create(data: Partial<SessionRow> & { id: string }): SessionRow {
    const now = Date.now()
    const workspaces = data.workspaces || (data.workspace ? JSON.stringify([data.workspace]) : null)
    const row: SessionRow = {
      id: data.id, character_id: data.character_id || 'general',
      title: data.title || '', model: data.model || null,
      provider_id: data.provider_id || null, workspace: data.workspace || null,
      workspaces,
      dataspace: data.dataspace || null,
      parent_id: data.parent_id || null, active_group: data.active_group || null,
      session_type: data.session_type || 'chat', event_id: data.event_id || null,
      character_binding_mode: data.character_binding_mode || 'follow_latest',
      pinned_character_revision_id: data.pinned_character_revision_id || null,
      forked_from_session_id: data.forked_from_session_id || null,
      forked_from_message_id: data.forked_from_message_id ?? null,
      event_occurrence_id: data.event_occurrence_id || null,
      approval_mode: data.approval_mode || data.current_strategy || 'Ask Risky',
      execution_mode: data.execution_mode || 'direct',
      current_strategy: data.current_strategy ? normalizeStrategy(data.current_strategy) : null,
      reasoning_effort: data.reasoning_effort ?? null,
      context_window: data.context_window ?? null,
      input_tokens: data.input_tokens || 0, output_tokens: data.output_tokens || 0,
      cache_hit_tokens: data.cache_hit_tokens || 0, cache_miss_tokens: data.cache_miss_tokens || 0,
      cache_hit_ratio: data.cache_hit_ratio ?? 'N/A',
      compaction_summary: data.compaction_summary ?? null,
      compaction_until_id: data.compaction_until_id ?? null,
      created_at: now, updated_at: now,
    }
    getDb().prepare(`INSERT INTO sessions (${INSERT_COLS}) VALUES (${INSERT_PARAMS})`).run(row)
    return row
  },
  update(id: string, patch: Partial<SessionRow>): SessionRow | null {
    const existing = this.getById(id)
    if (!existing) return null
    if (patch.current_strategy) patch.current_strategy = normalizeStrategy(patch.current_strategy)
    if (patch.workspaces || (patch.workspace && !patch.workspaces)) {
      patch.workspaces = patch.workspaces || JSON.stringify([patch.workspace!])
    }
    const updated = { ...existing, ...patch, updated_at: Date.now() }
    getDb().prepare(`UPDATE sessions SET ${UPDATE_COLS} WHERE id=@id`).run(updated)
    return updated
  },
  delete(id: string): boolean {
    const db = getDb()
    return withTransaction(db, () => {
      // Cascade through every table that references the session (FK is ON).
      const runs = db.prepare('SELECT id FROM runs WHERE session_id = ?').all(id) as { id: string }[]
      const runIds = runs.map(r => r.id)
      // Break run self-references first so any delete order stays valid.
      db.prepare('UPDATE runs SET parent_run_id = NULL, resumed_from_run_id = NULL WHERE session_id = ?').run(id)
      for (const run of runs) {
        db.prepare('DELETE FROM run_events WHERE run_id = ?').run(run.id)
        db.prepare('DELETE FROM checkpoints WHERE run_id = ?').run(run.id)
      }
      // agent_tasks reference runs by parent_run_id and sessions by child_session_id.
      if (runIds.length > 0) {
        const ph = runIds.map(() => '?').join(',')
        db.prepare(`DELETE FROM agent_tasks WHERE parent_run_id IN (${ph})`).run(...runIds)
      }
      db.prepare('DELETE FROM agent_tasks WHERE child_session_id = ?').run(id)
      db.prepare('DELETE FROM runs WHERE session_id = ?').run(id)
      db.prepare('DELETE FROM turns WHERE session_id = ?').run(id)
      db.prepare('DELETE FROM goals WHERE session_id = ?').run(id)
      const plans = db.prepare('SELECT id FROM plans WHERE session_id = ?').all(id) as { id: string }[]
      for (const plan of plans) {
        db.prepare('DELETE FROM plan_steps WHERE plan_id = ?').run(plan.id)
      }
      db.prepare('DELETE FROM plans WHERE session_id = ?').run(id)
      db.prepare('DELETE FROM trajectories WHERE session_id = ?').run(id)
      db.prepare('DELETE FROM messages WHERE session_id = ?').run(id)
      return db.prepare('DELETE FROM sessions WHERE id = ?').run(id).changes > 0
    })
  },
}
