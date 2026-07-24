import Database from 'better-sqlite3'
import { existsSync, mkdirSync } from 'fs'
import { resolve } from 'path'

const DATA_DIR = process.env.DATA_DIR || resolve(import.meta.dirname, '../../../../data')

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (db) return db
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
  db = new Database(resolve(DATA_DIR, 'sessions.db'))
  db.pragma('journal_mode = WAL')
  try { db.exec('ALTER TABLE messages ADD COLUMN reasoning_content TEXT') } catch { }
  try { db.exec('ALTER TABLE sessions ADD COLUMN parent_id TEXT') } catch { }
  try { db.exec('ALTER TABLE sessions ADD COLUMN active_group TEXT') } catch { }
  try { db.exec("ALTER TABLE sessions ADD COLUMN session_type TEXT DEFAULT 'chat'") } catch { }
  try { db.exec('ALTER TABLE sessions ADD COLUMN event_id TEXT') } catch { }
  try { db.exec("ALTER TABLE sessions ADD COLUMN current_strategy TEXT DEFAULT 'Plan'") } catch { }
  try { db.exec('ALTER TABLE sessions ADD COLUMN context_window INTEGER') } catch { }
  try { db.exec("ALTER TABLE sessions ADD COLUMN workspaces TEXT") } catch { }
  try { db.exec('ALTER TABLE sessions ADD COLUMN compaction_summary TEXT') } catch { }
  try { db.exec('ALTER TABLE sessions ADD COLUMN compaction_until_id INTEGER DEFAULT 0') } catch { }
  try { db.exec('ALTER TABLE events ADD COLUMN model TEXT') } catch { }
  try { db.exec('ALTER TABLE events ADD COLUMN provider_id TEXT') } catch { }
  try { db.exec('ALTER TABLE events ADD COLUMN workspace TEXT') } catch { }
  try { db.exec('ALTER TABLE messages ADD COLUMN attachments TEXT') } catch { }
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL DEFAULT 'general',
      title TEXT NOT NULL DEFAULT '',
      model TEXT,
      provider_id TEXT,
      workspace TEXT,
      workspaces TEXT,
      parent_id TEXT,
      active_group TEXT,
      session_type TEXT DEFAULT 'chat',
      event_id TEXT,
      current_strategy TEXT DEFAULT 'Plan',
      context_window INTEGER,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      role TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      reasoning_content TEXT,
      tool_name TEXT,
      tool_input TEXT,
      tool_output TEXT,
      tool_status TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL CHECK(source_type IN ('user', 'agent', 'system')),
      source_id TEXT,
      source_meta TEXT,
      assigned_agent_id TEXT NOT NULL,
      assigned_group_id TEXT,
      model TEXT,
      provider_id TEXT,
      workspace TEXT,
      type TEXT NOT NULL CHECK(type IN ('once', 'cron')),
      cron_expr TEXT,
      payload TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
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
    CREATE INDEX IF NOT EXISTS idx_events_status_schedule ON events(status, scheduled_at);
    CREATE INDEX IF NOT EXISTS idx_events_source ON events(source_type, source_id);
    CREATE TABLE IF NOT EXISTS trajectories (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      user_goal TEXT,
      tool_calls TEXT,
      summary TEXT,
      success_rate REAL,
      created_at INTEGER NOT NULL
    );
  `)
  // Rebuild events table if old CHECK constraint still exists (prevents new status values)
  try {
    db.exec("UPDATE events SET status = 'completed' WHERE status = 'success'")
    db.exec("UPDATE events SET status = 'pending' WHERE status = 'paused'")
    db.exec("UPDATE events SET status = 'archived' WHERE status = 'expired'")
  } catch {
    try { db.exec('ALTER TABLE events RENAME TO events_old') } catch { }
    db.exec(`
      CREATE TABLE events (
        id TEXT PRIMARY KEY,
        source_type TEXT NOT NULL CHECK(source_type IN ('user', 'agent', 'system')),
        source_id TEXT,
        source_meta TEXT,
        assigned_agent_id TEXT NOT NULL,
        assigned_group_id TEXT,
        model TEXT,
        provider_id TEXT,
        workspace TEXT,
        type TEXT NOT NULL CHECK(type IN ('once', 'cron')),
        cron_expr TEXT,
        payload TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
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
      INSERT INTO events (id, source_type, source_id, source_meta, assigned_agent_id, assigned_group_id, model, provider_id, workspace, type, cron_expr, payload, status, priority, scheduled_at, started_at, finished_at, result_summary, error_log, parent_event_id, retry_count, max_retries, created_at) SELECT id, source_type, source_id, source_meta, assigned_agent_id, assigned_group_id, model, provider_id, workspace, type, cron_expr, payload, status, priority, scheduled_at, started_at, finished_at, result_summary, error_log, parent_event_id, retry_count, max_retries, created_at FROM events_old;
      DROP TABLE events_old;
    `)
    db.exec("UPDATE events SET status = 'completed' WHERE status = 'success'")
    db.exec("UPDATE events SET status = 'pending' WHERE status = 'paused'")
    db.exec("UPDATE events SET status = 'archived' WHERE status = 'expired'")
  }
  return db
}
