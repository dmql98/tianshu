/**
 * db-compatibility.test.ts — 旧版本 sessions.db 兼容性测试。
 *
 * 用 node:sqlite 在临时目录创建一个"旧版本结构"的最小数据库（§5.1）：
 *   - 一个 session；
 *   - 至少一条自增 ID message；
 *   - 一组 turn / run / run_event；
 *   - 一个 character definition / revision；
 *   - 一个 event definition / occurrence（events 表使用旧 status CHECK，
 *     用于触发 schema.ts 的 events 重建迁移路径）；
 *   - WAL 模式；
 *   - 非 ASCII 文本、emoji、空字符串、NULL、BLOB。
 *
 * 验证 schema.ts 初始化后（§5.2）：
 *   - 旧数据仍可读；
 *   - 迁移幂等（同一个旧数据库被重复初始化两次）；
 *   - 主键与自增行为不变（新 message 的 ID 在旧 ID 之后连续）。
 *
 * 本测试只使用临时 TIANSHU_DATA_DIR，不读取默认用户数据目录（§5.3）。
 */
import { afterAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { DatabaseSync } from 'node:sqlite'

const dataDir = mkdtempSync(join(tmpdir(), 'tianshu-compat-'))
// 必须在加载 schema.js 之前设置，保证 getDataDir() 指向临时目录。
process.env.TIANSHU_DATA_DIR = dataDir

const { getDb, closeDb } = await import('../src/db/schema.js')

const EMOJI_TEXT = '你好，天枢 👋 跨平台 🚀'
const BLOB_BYTES = Buffer.from([0x00, 0x01, 0xfe, 0xff, 0x7f])

/** 模拟旧版本（迁移前）的最小表结构。 */
function createLegacyDb(path: string): void {
  const db = new DatabaseSync(path)
  const now = 1_750_000_000_000
  db.exec('PRAGMA journal_mode = WAL')
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL DEFAULT 'general',
      title TEXT NOT NULL DEFAULT '',
      model TEXT,
      provider_id TEXT,
      workspace TEXT,
      current_strategy TEXT DEFAULT 'Read Only',
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      role TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      tool_name TEXT,
      tool_input TEXT,
      tool_output TEXT,
      tool_status TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE turns (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      ordinal INTEGER NOT NULL,
      trigger_type TEXT NOT NULL,
      user_message_id INTEGER,
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL,
      UNIQUE(session_id, ordinal)
    );
    CREATE TABLE runs (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      turn_id TEXT,
      character_id TEXT NOT NULL,
      character_revision_id TEXT NOT NULL,
      character_snapshot_hash TEXT NOT NULL,
      source TEXT NOT NULL,
      status TEXT NOT NULL,
      phase TEXT NOT NULL,
      approval_mode TEXT NOT NULL,
      execution_mode TEXT NOT NULL,
      max_turns INTEGER NOT NULL DEFAULT 50,
      usage TEXT,
      result TEXT,
      error TEXT,
      queued_at INTEGER NOT NULL,
      started_at INTEGER,
      finished_at INTEGER,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE run_events (
      event_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(id),
      session_id TEXT NOT NULL REFERENCES sessions(id),
      seq INTEGER NOT NULL,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(run_id, seq)
    );
    CREATE TABLE character_definitions (
      id TEXT PRIMARY KEY,
      current_revision_id TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE character_revisions (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL REFERENCES character_definitions(id),
      revision_no INTEGER NOT NULL,
      manifest_hash TEXT NOT NULL,
      snapshot TEXT NOT NULL,
      visual_manifest TEXT,
      created_at INTEGER NOT NULL,
      UNIQUE(character_id, revision_no)
    );
    -- 旧 events 表：status 带旧 CHECK 约束，schema.ts 必须能重建（迁移幂等）。
    CREATE TABLE events (
      id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL CHECK(source_type IN ('user', 'agent', 'system')),
      source_id TEXT,
      source_meta TEXT,
      assigned_agent_id TEXT NOT NULL,
      assigned_group_id TEXT,
      type TEXT NOT NULL CHECK(type IN ('once', 'cron')),
      cron_expr TEXT,
      payload TEXT NOT NULL,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'success', 'paused', 'expired', 'cancelled')),
      priority INTEGER DEFAULT 0,
      scheduled_at INTEGER,
      started_at INTEGER,
      finished_at INTEGER,
      result_summary TEXT,
      error_log TEXT,
      parent_event_id TEXT,
      retry_count INTEGER DEFAULT 0,
      max_retries INTEGER DEFAULT 3,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE event_definitions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      cron_expr TEXT,
      timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
      instruction TEXT NOT NULL,
      character_id TEXT NOT NULL,
      revision_policy TEXT NOT NULL DEFAULT 'follow_latest',
      approval_mode TEXT NOT NULL DEFAULT 'Ask Risky',
      execution_mode TEXT NOT NULL DEFAULT 'direct',
      overlap_policy TEXT NOT NULL DEFAULT 'skip',
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE event_occurrences (
      id TEXT PRIMARY KEY,
      definition_id TEXT NOT NULL REFERENCES event_definitions(id),
      trigger_type TEXT NOT NULL,
      scheduled_for INTEGER NOT NULL,
      resolved_revision_id TEXT NOT NULL,
      session_id TEXT,
      current_run_id TEXT,
      status TEXT NOT NULL,
      result TEXT,
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(definition_id, scheduled_for)
    );
  `)
  // 旧 events 行：status='success'（旧值）会触发 schema.ts 的 events 重建迁移。
  db.prepare(
    `INSERT INTO events (id, source_type, assigned_agent_id, type, payload, status, created_at)
     VALUES ('ev-legacy', 'agent', 'a1', 'once', '{}', 'success', ?)`,
  ).run(now)
  db.prepare(
    `INSERT INTO sessions (id, character_id, title, model, provider_id, workspace, current_strategy, input_tokens, output_tokens, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('sess-legacy', 'general', `旧会话 ${EMOJI_TEXT}`, 'gpt-4o', 'provider-a', null, 'Read Only', 10, 20, now, now)

  db.prepare(
    `INSERT INTO messages (id, session_id, role, content, tool_name, tool_input, tool_output, tool_status, created_at)
     VALUES (1, 'sess-legacy', 'user', ?, NULL, NULL, NULL, NULL, ?)`,
  ).run(`旧消息：${EMOJI_TEXT}`, now)
  db.prepare(
    `INSERT INTO messages (id, session_id, role, content, tool_name, tool_input, tool_output, tool_status, created_at)
     VALUES (2, 'sess-legacy', 'user', '', 'search', '{}', NULL, NULL, ?)`,
  ).run(now)
  db.close()
}

describe('旧版本 sessions.db 兼容性', () => {
  afterAll(() => {
    closeDb()
    rmSync(dataDir, { recursive: true, force: true })
  })

  it('schema 初始化后旧数据仍可读（重复初始化两次幂等）', () => {
    const dbPath = join(dataDir, 'sessions.db')
    createLegacyDb(dbPath)

    // ── 第一次初始化 ──
    const db1 = getDb()
    // 会话可读（含 emoji）
    const session = db1.prepare('SELECT * FROM sessions WHERE id = ?').get('sess-legacy') as {
      title: string
      current_strategy: string
    }
    expect(session.title).toBe(`旧会话 ${EMOJI_TEXT}`)
    expect(session.current_strategy).toBe('Read Only')
    // 消息可读：自增 ID 顺序保留
    const msgs = db1.prepare('SELECT id, content FROM messages ORDER BY id').all() as Array<{
      id: number
      content: string
    }>
    expect(msgs.map((m) => m.id)).toEqual([1, 2])
    expect(msgs[0].content).toBe(`旧消息：${EMOJI_TEXT}`)
    expect(msgs[1].content).toBe('')
    // WAL 已生效
    const mode = db1.prepare('PRAGMA journal_mode').get() as { journal_mode: string }
    expect(mode.journal_mode.toLowerCase()).toBe('wal')
    // events 旧 CHECK 已被重建迁移替换，status 迁移正确
    db1.prepare(
      `INSERT INTO events (id, source_type, assigned_agent_id, type, payload, status, created_at)
       VALUES ('ev-new', 'agent', 'a1', 'once', '{}', 'completed', 1)`,
    ).run()
    closeDb()

    // ── 第二次初始化（迁移幂等）──
    const db2 = getDb()
    const again = db2.prepare('SELECT COUNT(*) AS c FROM sessions').get() as { c: number }
    expect(again.c).toBe(1)
    const session2 = db2.prepare('SELECT title FROM sessions WHERE id = ?').get('sess-legacy') as { title: string }
    expect(session2.title).toBe(`旧会话 ${EMOJI_TEXT}`)
    closeDb()
  })

  it('新消息自增 ID 在旧 ID 之后连续', () => {
    const db = getDb()
    const r = db.prepare(
      `INSERT INTO messages (session_id, role, content, created_at) VALUES ('sess-legacy', 'assistant', '新回复', ?)`,
    ).run(Date.now())
    // 旧库已有 id 1、2 → 新消息必须从 3 继续
    expect(Number(r.lastInsertRowid)).toBe(3)
    const row = db.prepare('SELECT content FROM messages WHERE id = 3').get() as { content: string }
    expect(row.content).toBe('新回复')
    closeDb()
  })

  it('turn/run/run_event/character/event 旧数据在新 schema 下可读', () => {
    const db = getDb()
    // turn
    db.prepare(
      `INSERT INTO turns (id, session_id, ordinal, trigger_type, user_message_id, status, created_at)
       VALUES ('turn-1', 'sess-legacy', 1, 'user', 1, 'active', 1)`,
    ).run()
    const turn = db.prepare('SELECT * FROM turns WHERE id = ?').get('turn-1') as { ordinal: number }
    expect(turn.ordinal).toBe(1)
    // run + run_event（result 列承载 BLOB，验证 BLOB 往返）
    db.prepare(
      `INSERT INTO runs (id, session_id, turn_id, character_id, character_revision_id, character_snapshot_hash, source, status, phase, approval_mode, execution_mode, max_turns, usage, result, error, queued_at, updated_at)
       VALUES ('run-1', 'sess-legacy', 'turn-1', 'char-1', 'rev-1', 'abc', 'user', 'completed', 'done', 'Read Only', 'direct', 50, NULL, ?, NULL, 1, 1)`,
    ).run(BLOB_BYTES)
    const run = db.prepare('SELECT result FROM runs WHERE id = ?').get('run-1') as { result: Uint8Array }
    expect(Buffer.from(run.result)).toEqual(BLOB_BYTES)
    db.prepare(
      `INSERT INTO run_events (event_id, run_id, session_id, seq, type, payload, created_at)
       VALUES ('re-1', 'run-1', 'sess-legacy', 1, 'run.started', '{}', 1)`,
    ).run()
    expect((db.prepare('SELECT COUNT(*) AS c FROM run_events').get() as { c: number }).c).toBe(1)
    // character definition + revision（snapshot 非 ASCII）
    db.prepare(
      `INSERT INTO character_definitions (id, current_revision_id, status, created_at, updated_at)
       VALUES ('char-1', 'rev-1', 'active', 1, 1)`,
    ).run()
    db.prepare(
      `INSERT INTO character_revisions (id, character_id, revision_no, manifest_hash, snapshot, visual_manifest, created_at)
       VALUES ('rev-1', 'char-1', 1, 'h1', ?, NULL, 1)`,
    ).run(`角色快照 ${EMOJI_TEXT}`)
    const rev = db.prepare('SELECT snapshot FROM character_revisions WHERE id = ?').get('rev-1') as { snapshot: string }
    expect(rev.snapshot).toBe(`角色快照 ${EMOJI_TEXT}`)
    // event definition + occurrence
    db.prepare(
      `INSERT INTO event_definitions (id, name, type, cron_expr, timezone, instruction, character_id, created_at, updated_at)
       VALUES ('def-1', '每日巡检', 'cron', '0 9 * * *', 'Asia/Shanghai', '检查系统', 'char-1', 1, 1)`,
    ).run()
    db.prepare(
      `INSERT INTO event_occurrences (id, definition_id, trigger_type, scheduled_for, resolved_revision_id, status, created_at, updated_at)
       VALUES ('occ-1', 'def-1', 'cron', 1, 'rev-1', 'pending', 1, 1)`,
    ).run()
    const occ = db.prepare('SELECT name FROM event_definitions d JOIN event_occurrences o ON o.definition_id = d.id WHERE o.id = ?').get('occ-1') as { name: string }
    expect(occ.name).toBe('每日巡检')
    // NULL 可读（runs.error 为 NULL）
    const runErr = db.prepare('SELECT error FROM runs WHERE id = ?').get('run-1') as { error: null }
    expect(runErr.error).toBeNull()
    closeDb()
  })
})
