import Database from 'better-sqlite3'
import { existsSync, mkdirSync } from 'fs'
import { resolve } from 'path'
import { getDataDir } from '../config.js'

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (db) return db
  const DATA_DIR = getDataDir()
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
  db = new Database(resolve(DATA_DIR, 'sessions.db'))
  db.pragma('journal_mode = WAL')
  try { db.exec('ALTER TABLE messages ADD COLUMN reasoning_content TEXT') } catch { }
  try { db.exec('ALTER TABLE sessions ADD COLUMN parent_id TEXT') } catch { }
  try { db.exec('ALTER TABLE sessions ADD COLUMN active_group TEXT') } catch { }
  try { db.exec("ALTER TABLE sessions ADD COLUMN session_type TEXT DEFAULT 'chat'") } catch { }
  try { db.exec('ALTER TABLE sessions ADD COLUMN event_id TEXT') } catch { }
  try { db.exec("ALTER TABLE sessions ADD COLUMN current_strategy TEXT DEFAULT 'Read Only'") } catch { }
  try { db.exec('ALTER TABLE sessions ADD COLUMN context_window INTEGER') } catch { }
  try { db.exec("ALTER TABLE sessions ADD COLUMN workspaces TEXT") } catch { }
  try { db.exec('ALTER TABLE sessions ADD COLUMN compaction_summary TEXT') } catch { }
  try { db.exec('ALTER TABLE sessions ADD COLUMN compaction_until_id INTEGER DEFAULT 0') } catch { }
  try { db.exec('ALTER TABLE sessions ADD COLUMN cache_hit_tokens INTEGER DEFAULT 0') } catch { }
  try { db.exec('ALTER TABLE sessions ADD COLUMN cache_miss_tokens INTEGER DEFAULT 0') } catch { }
  try { db.exec("ALTER TABLE sessions ADD COLUMN cache_hit_ratio TEXT DEFAULT 'N/A'") } catch { }
  try { db.exec("ALTER TABLE sessions ADD COLUMN reasoning_effort TEXT") } catch { }
  try { db.exec('ALTER TABLE events ADD COLUMN model TEXT') } catch { }
  try { db.exec('ALTER TABLE events ADD COLUMN provider_id TEXT') } catch { }
  try { db.exec('ALTER TABLE events ADD COLUMN workspace TEXT') } catch { }
  try { db.exec('ALTER TABLE messages ADD COLUMN attachments TEXT') } catch { }
  try { db.exec('ALTER TABLE messages ADD COLUMN token_speed REAL') } catch { }
  try { db.exec("ALTER TABLE sessions ADD COLUMN dataspace TEXT") } catch { }
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL DEFAULT 'general',
      title TEXT NOT NULL DEFAULT '',
      model TEXT,
      provider_id TEXT,
      workspace TEXT,
      workspaces TEXT,
      dataspace TEXT,
      parent_id TEXT,
      active_group TEXT,
      session_type TEXT DEFAULT 'chat',
      event_id TEXT,
      current_strategy TEXT DEFAULT 'Read Only',
      context_window INTEGER,
      reasoning_effort TEXT,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      cache_hit_tokens INTEGER DEFAULT 0,
      cache_miss_tokens INTEGER DEFAULT 0,
      cache_hit_ratio TEXT DEFAULT 'N/A',
      compaction_summary TEXT,
      compaction_until_id INTEGER DEFAULT 0,
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
      attachments TEXT,
      token_speed REAL,
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
    CREATE TABLE IF NOT EXISTS session_skill_activations (
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      package_id TEXT NOT NULL,
      skill_id TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      activated_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      PRIMARY KEY(session_id, package_id, skill_id)
    );
    CREATE INDEX IF NOT EXISTS idx_session_skill_activations_active
      ON session_skill_activations(session_id, status);
  `)
  // Run/character architecture. Development data is upgraded in place so an
  // existing desktop profile can keep its conversations while the new domain
  // tables become the source of truth.
  const sessionColumns = [
    "ALTER TABLE sessions ADD COLUMN character_binding_mode TEXT NOT NULL DEFAULT 'follow_latest'",
    'ALTER TABLE sessions ADD COLUMN pinned_character_revision_id TEXT',
    'ALTER TABLE sessions ADD COLUMN forked_from_session_id TEXT',
    'ALTER TABLE sessions ADD COLUMN forked_from_message_id INTEGER',
    'ALTER TABLE sessions ADD COLUMN event_occurrence_id TEXT',
    "ALTER TABLE sessions ADD COLUMN approval_mode TEXT NOT NULL DEFAULT 'Ask Risky'",
    "ALTER TABLE sessions ADD COLUMN execution_mode TEXT NOT NULL DEFAULT 'direct'",
  ]
  for (const statement of sessionColumns) {
    try { db.exec(statement) } catch { /* column already exists */ }
  }
  const messageColumns = [
    'ALTER TABLE messages ADD COLUMN tool_name TEXT',
    'ALTER TABLE messages ADD COLUMN attachments TEXT',
    'ALTER TABLE messages ADD COLUMN turn_id TEXT',
    'ALTER TABLE messages ADD COLUMN run_id TEXT',
    "ALTER TABLE messages ADD COLUMN status TEXT NOT NULL DEFAULT 'active'",
    'ALTER TABLE messages ADD COLUMN supersedes_message_id INTEGER',
  ]
  for (const statement of messageColumns) {
    try { db.exec(statement) } catch { /* column already exists */ }
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS character_definitions (
      id TEXT PRIMARY KEY,
      current_revision_id TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS character_revisions (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL REFERENCES character_definitions(id),
      revision_no INTEGER NOT NULL,
      manifest_hash TEXT NOT NULL,
      snapshot TEXT NOT NULL,
      visual_manifest TEXT,
      created_at INTEGER NOT NULL,
      UNIQUE(character_id, revision_no)
    );
    CREATE INDEX IF NOT EXISTS idx_character_revisions_character
      ON character_revisions(character_id, revision_no DESC);

    CREATE TABLE IF NOT EXISTS turns (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      ordinal INTEGER NOT NULL,
      trigger_type TEXT NOT NULL,
      user_message_id INTEGER,
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL,
      UNIQUE(session_id, ordinal)
    );
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      turn_id TEXT,
      parent_run_id TEXT,
      resumed_from_run_id TEXT,
      character_id TEXT NOT NULL,
      character_revision_id TEXT NOT NULL,
      character_snapshot_hash TEXT NOT NULL,
      source TEXT NOT NULL,
      status TEXT NOT NULL,
      phase TEXT NOT NULL,
      approval_mode TEXT NOT NULL,
      execution_mode TEXT NOT NULL,
      turn_no INTEGER NOT NULL DEFAULT 0,
      max_turns INTEGER NOT NULL DEFAULT 50,
      run_policy_snapshot TEXT,
      configured_max_turns INTEGER,
      soft_turns INTEGER,
      absolute_turns INTEGER,
      continuation_root_run_id TEXT,
      continuation_index INTEGER NOT NULL DEFAULT 0,
      resume_trigger TEXT,
      usage TEXT,
      result TEXT,
      error TEXT,
      queued_at INTEGER NOT NULL,
      started_at INTEGER,
      finished_at INTEGER,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_runs_session_created
      ON runs(session_id, queued_at DESC);
    CREATE INDEX IF NOT EXISTS idx_runs_status
      ON runs(status, updated_at);
  `)
  // Run policy columns (RUN_LIMIT_POLICY_PLAN §6). Added idempotently; the
  // backfill below only runs once, gated on run_policy_snapshot being empty.
  const runPolicyColumns = [
    'ALTER TABLE runs ADD COLUMN run_policy_snapshot TEXT',
    'ALTER TABLE runs ADD COLUMN configured_max_turns INTEGER',
    'ALTER TABLE runs ADD COLUMN soft_turns INTEGER',
    'ALTER TABLE runs ADD COLUMN absolute_turns INTEGER',
    'ALTER TABLE runs ADD COLUMN continuation_root_run_id TEXT',
    'ALTER TABLE runs ADD COLUMN continuation_index INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE runs ADD COLUMN resume_trigger TEXT',
  ]
  for (const statement of runPolicyColumns) {
    try { db.exec(statement) } catch { /* column already exists */ }
  }
  // Historical migration: legacy runs get a version:1 snapshot mirroring
  // max_turns, dynamic limits and auto continuation off, and root themselves.
  db.exec(`
    UPDATE runs
    SET run_policy_snapshot = CASE
          WHEN run_policy_snapshot IS NULL OR run_policy_snapshot = '' THEN
            json_object(
              'version', 1,
              'policyVersion', 1,
              'system', json_object(
                'dynamicLimitEnabled', 0,
                'autoContinuationEnabled', 0,
                'maxAbsoluteTurnsPerRun', max_turns,
                'maxGraceTurns', 0,
                'noProgressThreshold', 0,
                'weakProgressThreshold', 0,
                'repeatedToolLoopThreshold', 0,
                'maxAutoContinuations', 0,
                'maxChainTurns', 0,
                'maxChainTokens', 0,
                'maxChainWallTimeMs', 0
              ),
              'character', json_object('autoContinuation', 'inherit'),
              'effective', json_object(
                'softTurns', max_turns,
                'graceTurns', 0,
                'absoluteTurns', max_turns,
                'autoContinuation', 0,
                'maxAutoContinuations', 0,
                'maxChainTurns', 0,
                'maxChainTokens', 0,
                'maxChainWallTimeMs', 0,
                'noProgressThreshold', 0,
                'weakProgressThreshold', 0,
                'repeatedToolLoopThreshold', 0
              )
            )
          ELSE run_policy_snapshot
        END,
        configured_max_turns = CASE WHEN configured_max_turns IS NULL THEN max_turns ELSE configured_max_turns END,
        soft_turns = CASE WHEN soft_turns IS NULL THEN max_turns ELSE soft_turns END,
        absolute_turns = CASE WHEN absolute_turns IS NULL THEN max_turns ELSE absolute_turns END,
        continuation_root_run_id = CASE WHEN continuation_root_run_id IS NULL OR continuation_root_run_id = '' THEN id ELSE continuation_root_run_id END,
        continuation_index = COALESCE(continuation_index, 0)
    WHERE run_policy_snapshot IS NULL OR run_policy_snapshot = ''
  `)
  // Auto-continuation uniqueness: at most one `auto_limit` successor per
  // predecessor run (§6.3).
  try {
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_runs_auto_continuation_once
      ON runs(resumed_from_run_id, resume_trigger)
      WHERE resume_trigger = 'auto_limit'
    `)
  } catch { /* unique index may already exist with same semantics */ }
  db.exec(`
    CREATE TABLE IF NOT EXISTS run_events (
      event_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(id),
      session_id TEXT NOT NULL REFERENCES sessions(id),
      seq INTEGER NOT NULL,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(run_id, seq)
    );
    CREATE INDEX IF NOT EXISTS idx_run_events_replay
      ON run_events(run_id, seq);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_run_events_one_terminal
      ON run_events(run_id)
      WHERE type IN ('run.completed', 'run.failed', 'run.cancelled',
                     'run.interrupted', 'run.max_turns',
                     'run.budget_exhausted');

    CREATE TABLE IF NOT EXISTS checkpoints (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(id),
      reason TEXT NOT NULL,
      message_cursor INTEGER,
      context_version INTEGER NOT NULL DEFAULT 1,
      policy_state TEXT,
      usage_snapshot TEXT,
      pending_request TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agent_tasks (
      id TEXT PRIMARY KEY,
      parent_run_id TEXT NOT NULL REFERENCES runs(id),
      child_session_id TEXT NOT NULL REFERENCES sessions(id),
      child_run_id TEXT NOT NULL REFERENCES runs(id),
      target_character_id TEXT NOT NULL,
      task TEXT NOT NULL,
      expected_output TEXT,
      mode TEXT NOT NULL DEFAULT 'foreground',
      status TEXT NOT NULL,
      result TEXT,
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agent_tasks_parent_run ON agent_tasks(parent_run_id);
    CREATE TABLE IF NOT EXISTS event_definitions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      cron_expr TEXT,
      timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
      instruction TEXT NOT NULL,
      character_id TEXT NOT NULL,
      revision_policy TEXT NOT NULL DEFAULT 'follow_latest',
      pinned_character_revision_id TEXT,
      assigned_group TEXT,
      provider_id TEXT,
      model TEXT,
      workspace TEXT,
      approval_mode TEXT NOT NULL DEFAULT 'Ask Risky',
      execution_mode TEXT NOT NULL DEFAULT 'direct',
      overlap_policy TEXT NOT NULL DEFAULT 'skip',
      status TEXT NOT NULL DEFAULT 'active',
      next_fire_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS event_occurrences (
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
    CREATE INDEX IF NOT EXISTS idx_event_occurrences_definition
      ON event_occurrences(definition_id, scheduled_for DESC);
    CREATE TABLE IF NOT EXISTS character_asset_refs (
      owner_type TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      character_id TEXT NOT NULL,
      asset_id TEXT NOT NULL,
      revision_id TEXT,
      retention_until INTEGER,
      created_at INTEGER NOT NULL,
      PRIMARY KEY(owner_type, owner_id, asset_id)
    );
    CREATE INDEX IF NOT EXISTS idx_character_asset_refs_asset
      ON character_asset_refs(character_id, asset_id);

    CREATE TABLE IF NOT EXISTS goals (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      outcome TEXT NOT NULL,
      constraints TEXT,
      verification TEXT,
      budget_tokens INTEGER,
      used_input_tokens INTEGER DEFAULT 0,
      used_output_tokens INTEGER DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      wake_condition TEXT,
      current_run_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_goals_session ON goals(session_id, status);

    CREATE TABLE IF NOT EXISTS plans (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      goal_id TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_plans_session ON plans(session_id, status);

    CREATE TABLE IF NOT EXISTS plan_steps (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL REFERENCES plans(id),
      ordinal INTEGER NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      depends_on TEXT,
      verification TEXT,
      evidence TEXT,
      created_at INTEGER NOT NULL,
      UNIQUE(plan_id, ordinal)
    );
    CREATE INDEX IF NOT EXISTS idx_plan_steps_plan ON plan_steps(plan_id, ordinal);
  `)
  db.exec(`
    UPDATE sessions SET current_strategy = CASE current_strategy
      WHEN 'Plan' THEN 'Read Only'
      WHEN 'Ask' THEN 'Ask Risky'
      WHEN 'Bypass' THEN 'Auto Approve'
      ELSE current_strategy
    END
    WHERE current_strategy IN ('Plan', 'Ask', 'Bypass')
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

export function closeDb(): void {
  if (db) { db.close(); db = null }
}
