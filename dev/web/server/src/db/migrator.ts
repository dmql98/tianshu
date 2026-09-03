/**
 * migrator.ts — 天枢正式 migration 引擎（M0.1）。
 *
 * 目标：把 schema.ts 里 `ALTER TABLE ... try/catch` 的隐式演进升级为
 * 有版本号、可审计、可回滚、可重现的正式 migration：
 *
 *   - `_migrations (version INTEGER PRIMARY KEY, name TEXT, applied_at TEXT)`
 *     记录已应用版本；版本号唯一且必须严格递增。
 *   - 每个 migration 在**同一事务**内执行 `up(db)` + 回写版本记录；
 *     失败整体回滚并抛错（启动即失败，不静默吞掉）。
 *   - `runMigrations` 幂等：已应用的版本跳过，重复调用安全。
 *   - `listApplied` / `getPendingMigrations` 供审计与测试。
 *
 * 版本语义：版本号不代表"第几条 ALTER"，而是 schema 演进的第几步。
 * M0.2 把现有建表 + ALTER 固化为有序清单（见 ./migrations/index.ts）。
 */
import { withTransaction, type TianshuDatabase } from './sqlite-db.js'

export interface Migration {
  /** 严格递增的版本号，从 1 开始。 */
  version: number
  /** 人类可读名称，写入 _migrations.name 供审计。 */
  name: string
  /** 正向迁移：把 schema 从 version-1 演进到 version。 */
  up: (db: TianshuDatabase) => void
  /** 可选反向迁移：M0 不要求提供，留作接口。 */
  down?: (db: TianshuDatabase) => void
}

export interface AppliedMigration {
  version: number
  name: string
  applied_at: string
}

const MIGRATIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS _migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )
`

/**
 * 确认清单合法：版本号唯一、严格递增（顺序即执行顺序）。
 * 在启动时抛错而不是运行到一半才失败——顺序写错是数据事故的根源。
 */
function assertSorted(migrations: readonly Migration[]): void {
  for (let i = 0; i < migrations.length; i++) {
    const m = migrations[i]
    if (m.version !== i + 1) {
      throw new Error(
        `[migrator] migration at index ${i} has version ${m.version}; expected ${i + 1} (strictly consecutive)`,
      )
    }
    if (i > 0 && migrations[i - 1].version >= m.version) {
      throw new Error(`[migrator] migrations not strictly increasing at "${m.name}"`)
    }
  }
}

/** 已应用版本列表（按版本号升序）。 */
export function listApplied(db: TianshuDatabase): AppliedMigration[] {
  db.exec(MIGRATIONS_TABLE)
  return db.prepare(
    'SELECT version, name, applied_at FROM _migrations ORDER BY version ASC',
  ).all() as unknown as AppliedMigration[]
}

/** 尚未应用的 migration（按给定清单顺序）。 */
export function getPendingMigrations(
  db: TianshuDatabase,
  migrations: readonly Migration[],
): Migration[] {
  const applied = new Set(listApplied(db).map((m) => m.version))
  return migrations.filter((m) => !applied.has(m.version))
}

/**
 * 应用所有未执行的 migration。每个 migration 单独一个事务（BEGIN IMMEDIATE），
 * 内含 up(db) + 版本回写；任何一个失败即回滚该步并向上抛错——
 * 已成功的历史步骤保持已提交，重跑时从失败步骤继续。
 */
export function runMigrations(db: TianshuDatabase, migrations: readonly Migration[]): number {
  assertSorted(migrations)
  const pending = getPendingMigrations(db, migrations)
  let appliedCount = 0
  for (const migration of pending) {
    withTransaction(db, () => {
      // _migrations 表本身随首个事务创建/补齐（幂等）。
      db.exec(MIGRATIONS_TABLE)
      migration.up(db)
      db.prepare('INSERT INTO _migrations (version, name, applied_at) VALUES (?, ?, ?)')
        .run(migration.version, migration.name, new Date().toISOString())
    })
    appliedCount++
    console.log(`[migrator] applied ${migration.version}_${migration.name}`)
  }
  return appliedCount
}

/** 是否已应用某版本（审计/条件逻辑用）。 */
export function isApplied(db: TianshuDatabase, version: number): boolean {
  const row = db.prepare('SELECT version FROM _migrations WHERE version = ?').get(version)
  return row != null
}

/**
 * 幂等加列：`ADD COLUMN` 前先查 `PRAGMA table_info`，列已存在则跳过。
 * 替代 `try/catch` 掩盖错误的方式——真正的 SQL 错误仍然会抛出。
 */
export function addColumnIfMissing(
  db: TianshuDatabase,
  table: string,
  column: string,
  definition: string,
): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  if (cols.some((c) => c.name === column)) return
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
}
