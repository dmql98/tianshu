import { openDatabase, type TianshuDatabase } from './sqlite-db.js'
import { runMigrations } from './migrator.js'
import { migrations } from './migrations/index.js'
import { copyFileSync, existsSync, mkdirSync } from 'fs'
import { resolve } from 'path'
import { getDataDir } from '../config.js'

let db: TianshuDatabase | null = null

/**
 * 首次由新驱动打开数据库前创建一次带版本后缀的备份（迁移指南 §14.4）。
 * 只保留一个备份文件；复制失败仅记录日志，不阻塞启动（不得用空库覆盖原文件）。
 */
function backupDatabaseOnce(dbPath: string): void {
  const backup = `${dbPath}.pre-node-sqlite`
  if (!existsSync(dbPath) || existsSync(backup)) return
  try {
    copyFileSync(dbPath, backup)
    console.log(`[schema] pre-migration backup created: ${backup}`)
  } catch (err) {
    console.error('[schema] backup failed (continuing):', err)
  }
}

export function getDb(): TianshuDatabase {
  if (db) return db
  const DATA_DIR = getDataDir()
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
  const dbPath = resolve(DATA_DIR, 'sessions.db')
  backupDatabaseOnce(dbPath)
  db = openDatabase(dbPath)
  // 与旧驱动实测行为保持一致：WAL + 外键约束显式开启（迁移指南 §7.4）。
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  // M0：正式 migration 引擎接管 schema 演进（建表 + 列补齐 + 回填 + 重建）。
  // 迁移失败会抛错 → 启动即失败，不再静默吞错。
  runMigrations(db, migrations)

  return db
}

export function closeDb(): void {
  if (db) { db.close(); db = null }
}
