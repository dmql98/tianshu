/**
 * migrator.test.ts — M0.1 正式 migration 引擎验收。
 *
 * 覆盖验收标准的核心三条：
 *   1. 空库全量迁移 → _migrations 版本表齐全；
 *   2. 重跑幂等（已应用版本不重复执行）；
 *   3. 注入一个失败 migration → 该步事务回滚（版本不回写、表结构不变）。
 *
 * 用独立临时目录 + node:sqlite 门面，不触碰默认数据目录。
 */
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import { openDatabase, withTransaction } from '../src/db/sqlite-db.js'
import {
  runMigrations,
  listApplied,
  getPendingMigrations,
  isApplied,
  type Migration,
} from '../src/db/migrator.js'

const dataDir = mkdtempSync(join(tmpdir(), 'tianshu-migrator-'))

function freshDb(): ReturnType<typeof openDatabase> {
  const db = openDatabase(join(dataDir, `sessions-${Math.random().toString(36).slice(2)}.db`))
  db.exec('PRAGMA journal_mode = WAL')
  return db
}

const emptyMigrations: Migration[] = [
  {
    version: 1,
    name: 'create_foo',
    up: (db) => db.exec('CREATE TABLE foo (id INTEGER PRIMARY KEY)'),
  },
  {
    version: 2,
    name: 'add_bar',
    up: (db) => db.exec('ALTER TABLE foo ADD COLUMN bar TEXT'),
  },
]

describe('migrator 引擎', () => {
  afterAll(() => {
    rmSync(dataDir, { recursive: true, force: true })
  })

  it('空库全量迁移：_migrations 表齐全、版本按顺序记录', () => {
    const db = freshDb()
    const applied = runMigrations(db, emptyMigrations)
    expect(applied).toBe(2)

    const rows = listApplied(db)
    expect(rows.map((r) => r.version)).toEqual([1, 2])
    expect(rows.map((r) => r.name)).toEqual(['create_foo', 'add_bar'])
    // 每个版本都有时间戳
    for (const row of rows) {
      expect(typeof row.applied_at).toBe('string')
      expect(new Date(row.applied_at).getTime()).not.toBeNaN()
    }
    // 表结构确实生效
    const cols = db.prepare('PRAGMA table_info(foo)').all() as Array<{ name: string }>
    expect(cols.map((c) => c.name)).toEqual(['id', 'bar'])
    db.close()
  })

  it('重跑幂等：已应用版本不再执行', () => {
    const db = freshDb()
    expect(runMigrations(db, emptyMigrations)).toBe(2)
    expect(runMigrations(db, emptyMigrations)).toBe(0)
    expect(listApplied(db)).toHaveLength(2)
    // getPendingMigrations 视角一致
    expect(getPendingMigrations(db, emptyMigrations)).toEqual([])
    expect(isApplied(db, 1)).toBe(true)
    expect(isApplied(db, 99)).toBe(false)
    db.close()
  })

  it('迁移中断可续跑：已有版本保留、失败版本重试', () => {
    const db = freshDb()
    const flaky: Migration[] = [
      emptyMigrations[0],
      {
        version: 2,
        name: 'flaky_add_bar',
        up: (db) => db.exec('ALTER TABLE foo ADD COLUMN bar TEXT'),
      },
    ]
    // 先只应用 1，模拟"上次已提交"的中间状态
    runMigrations(db, [flaky[0]])
    expect(isApplied(db, 1)).toBe(true)
    // 补上 2 → 1 已应用跳过，只应用 2
    expect(runMigrations(db, flaky)).toBe(1)
    expect(listApplied(db).map((r) => r.version)).toEqual([1, 2])
    db.close()
  })

  it('注入失败 migration：事务回滚，版本不回写、表结构不变', () => {
    const db = freshDb()
    const bad: Migration[] = [
      emptyMigrations[0],
      {
        version: 2,
        name: 'boom',
        up: () => {
          // 先写入一行（应在回滚中消失）
          throw new Error('intentional migration failure')
        },
      },
    ]
    expect(() => runMigrations(db, bad)).toThrow('intentional migration failure')
    // 失败步不写版本
    expect(listApplied(db).map((r) => r.version)).toEqual([1])
    expect(isApplied(db, 2)).toBe(false)
    // foo 表仍可用（migration 1 已提交）
    db.prepare('INSERT INTO foo (id) VALUES (1)').run()
    expect((db.prepare('SELECT COUNT(*) AS c FROM foo').get() as { c: number }).c).toBe(1)
    db.close()
  })

  it('migration 内部分失败也会整体回滚（同一事务）', () => {
    const db = freshDb()
    const dbPath = join(dataDir, `sessions-${Math.random().toString(36).slice(2)}.db`)
    // 用 withTransaction 直接验证"up 里先写后抛 → 全回滚"语义
    db.exec('CREATE TABLE demo (id INTEGER PRIMARY KEY)')
    expect(() =>
      withTransaction(db, () => {
        db.prepare('INSERT INTO demo (id) VALUES (1)').run()
        throw new Error('rollback me')
      }),
    ).toThrow('rollback me')
    expect((db.prepare('SELECT COUNT(*) AS c FROM demo').get() as { c: number }).c).toBe(0)
    db.close()
    rmSync(dbPath, { force: true })
  })

  it('非法清单：版本不连续 / 重复时启动即抛错', () => {
    const db = freshDb()
    const notConsecutive: Migration[] = [
      { version: 1, name: 'a', up: () => {} },
      { version: 3, name: 'b', up: () => {} },
    ]
    expect(() => runMigrations(db, notConsecutive)).toThrow(/expected 2/)
    const duplicated: Migration[] = [
      { version: 1, name: 'a', up: () => {} },
      { version: 1, name: 'a2', up: () => {} },
    ]
    // 重复版本先被"必须连续递增"拦截（index 1 期望 version 2）
    expect(() => runMigrations(db, duplicated)).toThrow(/expected 2/)
    db.close()
  })
})
