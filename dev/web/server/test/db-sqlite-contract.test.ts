/**
 * sqlite-db.test.ts — node:sqlite 驱动契约测试。
 *
 * 覆盖 docs/跨平台客户端与Node-SQLite迁移开发指南.md §5.2 列出的契约：
 * exec 多语句、prepare().run/get/all、匿名 ? 参数、@name 命名参数、
 * run().changes / lastInsertRowid、NULL/UTF-8/BLOB、事务提交/回滚/嵌套、
 * close()、WAL 与重新打开。
 *
 * 测试只使用临时 TIANSHU_DATA_DIR，不触碰真实用户数据（§5.3）。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { openDatabase, withTransaction, type TianshuDatabase } from '../src/db/sqlite-db.js'

const dirs: string[] = []

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tianshu-sqlite-contract-'))
  dirs.push(dir)
  return join(dir, 'contract.db')
}

function openTemp(opts?: Parameters<typeof openDatabase>[1]): TianshuDatabase {
  return openDatabase(tempDbPath(), opts)
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('node:sqlite 驱动契约', () => {
  it('exec() 可执行多条 SQL', () => {
    const db = openTemp()
    db.exec('CREATE TABLE t(a INTEGER, b TEXT); INSERT INTO t VALUES (1, \'x\'); INSERT INTO t VALUES (2, \'y\')')
    const rows = db.prepare('SELECT a, b FROM t ORDER BY a').all() as Array<{ a: number; b: string }>
    expect(rows).toEqual([
      { a: 1, b: 'x' },
      { a: 2, b: 'y' },
    ])
    db.close()
  })

  it('prepare().run/get/all 与匿名 ? 参数', () => {
    const db = openTemp()
    db.exec('CREATE TABLE t(a INTEGER, b TEXT)')
    const stmt = db.prepare('INSERT INTO t(a, b) VALUES (?, ?)')
    stmt.run(1, 'one')
    stmt.run(2, 'two')
    expect(db.prepare('SELECT b FROM t WHERE a = ?').get(2)).toEqual({ b: 'two' })
    expect((db.prepare('SELECT COUNT(*) AS c FROM t').get() as { c: number }).c).toBe(2)
    expect(db.prepare('SELECT b FROM t ORDER BY a').all()).toEqual([{ b: 'one' }, { b: 'two' }])
    db.close()
  })

  it('@name 命名参数可直接使用不带前缀的对象属性', () => {
    const db = openTemp()
    db.exec('CREATE TABLE t(id TEXT, n INTEGER)')
    db.prepare('INSERT INTO t(id, n) VALUES (@id, @n)').run({ id: 'a', n: 7 })
    const row = db.prepare('SELECT n FROM t WHERE id = @id').get({ id: 'a' }) as { n: number }
    expect(row.n).toBe(7)
    db.close()
  })

  it('命名参数对象可包含 SQL 未引用的完整行字段', () => {
    const db = openTemp()
    db.exec('CREATE TABLE t(id TEXT)')
    expect(() => db.prepare('INSERT INTO t(id) VALUES (@id)').run({ id: 'a', created_at: 1 })).not.toThrow()
    expect(db.prepare('SELECT id FROM t').get()).toEqual({ id: 'a' })
    // 忽略额外字段不等于忽略缺失字段：SQL 真正引用的参数仍是必需的。
    expect(() => db.prepare('INSERT INTO t(id) VALUES (@id)').run({ created_at: 1 })).toThrow()
    db.close()
  })

  it('run().changes 反映受影响行数', () => {
    const db = openTemp()
    db.exec('CREATE TABLE t(a INTEGER)')
    db.prepare('INSERT INTO t(a) VALUES (1)').run()
    db.prepare('INSERT INTO t(a) VALUES (2)').run()
    const result = db.prepare('UPDATE t SET a = a + 1 WHERE a = 1').run()
    expect(result.changes).toBe(1)
    const deleted = db.prepare('DELETE FROM t').run()
    expect(deleted.changes).toBe(2)
    db.close()
  })

  it('run().lastInsertRowid 返回自增 ID', () => {
    const db = openTemp()
    db.exec('CREATE TABLE t(id INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT)')
    const r1 = db.prepare('INSERT INTO t(v) VALUES (\'a\')').run()
    const r2 = db.prepare('INSERT INTO t(v) VALUES (\'b\')').run()
    expect(Number(r1.lastInsertRowid)).toBe(1)
    expect(Number(r2.lastInsertRowid)).toBe(2)
    db.close()
  })

  it('readBigInts=false 时自增 ID 返回 number', () => {
    const db = openTemp()
    db.exec('CREATE TABLE t(id INTEGER PRIMARY KEY AUTOINCREMENT)')
    const r = db.prepare('INSERT INTO t DEFAULT VALUES').run()
    expect(typeof r.lastInsertRowid).toBe('number')
    db.close()
  })

  it('支持 NULL、UTF-8 文本与 BLOB', () => {
    const db = openTemp()
    db.exec('CREATE TABLE t(a TEXT, b TEXT, c BLOB)')
    const emoji = '你好，世界 👋\u{1F680}'
    const blob = Buffer.from([0x00, 0x01, 0xfe, 0xff])
    db.prepare('INSERT INTO t(a, b, c) VALUES (?, ?, ?)').run(null, emoji, blob)
    const row = db.prepare('SELECT a, b, c FROM t').get() as { a: null; b: string; c: Uint8Array }
    expect(row.a).toBeNull()
    expect(row.b).toBe(emoji)
    expect(Buffer.from(row.c)).toEqual(blob)
    db.close()
  })

  it('空字符串与 NULL 可区分', () => {
    const db = openTemp()
    db.exec('CREATE TABLE t(a TEXT)')
    db.prepare('INSERT INTO t(a) VALUES (?)').run('')
    db.prepare('INSERT INTO t(a) VALUES (?)').run(null)
    const rows = db.prepare('SELECT a FROM t ORDER BY rowid').all() as Array<{ a: string | null }>
    expect(rows[0].a).toBe('')
    expect(rows[1].a).toBeNull()
    db.close()
  })

  it('正常事务提交后数据可见', () => {
    const db = openTemp()
    db.exec('CREATE TABLE t(a INTEGER)')
    withTransaction(db, () => {
      db.prepare('INSERT INTO t(a) VALUES (1)').run()
      db.prepare('INSERT INTO t(a) VALUES (2)').run()
    })
    expect((db.prepare('SELECT COUNT(*) AS c FROM t').get() as { c: number }).c).toBe(2)
    db.close()
  })

  it('抛错事务整体回滚并重新抛出原异常', () => {
    const db = openTemp()
    db.exec('CREATE TABLE t(a INTEGER)')
    const boom = new Error('boom')
    expect(() =>
      withTransaction(db, () => {
        db.prepare('INSERT INTO t(a) VALUES (1)').run()
        throw boom
      }),
    ).toThrow('boom')
    expect((db.prepare('SELECT COUNT(*) AS c FROM t').get() as { c: number }).c).toBe(0)
    db.close()
  })

  it('嵌套事务：内层失败回滚到 SAVEPOINT，外层继续提交', () => {
    const db = openTemp()
    db.exec('CREATE TABLE t(a INTEGER)')
    const boom = new Error('inner boom')
    expect(() =>
      withTransaction(db, () => {
        db.prepare('INSERT INTO t(a) VALUES (1)').run()
        expect(() =>
          withTransaction(db, () => {
            db.prepare('INSERT INTO t(a) VALUES (2)').run()
            throw boom
          }),
        ).toThrow('inner boom')
        // 内层回滚后外层仍可继续写入
        db.prepare('INSERT INTO t(a) VALUES (3)').run()
      }),
    ).not.toThrow()
    const rows = db.prepare('SELECT a FROM t ORDER BY a').all() as Array<{ a: number }>
    expect(rows.map((r) => r.a)).toEqual([1, 3])
    db.close()
  })

  it('嵌套事务：内层成功 RELEASE 后提交', () => {
    const db = openTemp()
    db.exec('CREATE TABLE t(a INTEGER)')
    withTransaction(db, () => {
      db.prepare('INSERT INTO t(a) VALUES (1)').run()
      withTransaction(db, () => {
        db.prepare('INSERT INTO t(a) VALUES (2)').run()
      })
    })
    expect((db.prepare('SELECT COUNT(*) AS c FROM t').get() as { c: number }).c).toBe(2)
    db.close()
  })

  it('close() 后 prepare 抛错', () => {
    const db = openTemp()
    db.exec('CREATE TABLE t(a INTEGER)')
    db.close()
    expect(() => db.prepare('SELECT 1').get()).toThrow()
  })

  it('WAL 模式持久化并在重新打开后数据仍在', () => {
    const path = tempDbPath()
    const db1 = openDatabase(path)
    db1.exec('PRAGMA journal_mode = WAL')
    const mode = db1.prepare('PRAGMA journal_mode').get() as { journal_mode: string }
    expect(mode.journal_mode.toLowerCase()).toBe('wal')
    db1.exec('CREATE TABLE t(a INTEGER)')
    db1.prepare('INSERT INTO t(a) VALUES (42)').run()
    db1.close()

    const db2 = openDatabase(path)
    const row = db2.prepare('SELECT a FROM t').get() as { a: number }
    expect(row.a).toBe(42)
    const mode2 = db2.prepare('PRAGMA journal_mode').get() as { journal_mode: string }
    expect(mode2.journal_mode.toLowerCase()).toBe('wal')
    db2.close()
  })

  it('openDatabase 使用默认选项并显式验证', () => {
    const db = openTemp()
    // allowBareNamedParameters 默认开启
    db.exec('CREATE TABLE t(id TEXT)')
    db.prepare('INSERT INTO t(id) VALUES (@id)').run({ id: 'x' })
    expect((db.prepare('SELECT COUNT(*) AS c FROM t').get() as { c: number }).c).toBe(1)
    // 完整业务对象可安全绑定到只引用其中一部分字段的 SQL。
    expect(db.prepare('SELECT @id AS v').get({ id: 'x', extra: 1 })).toEqual({ v: 'x' })
    db.close()
  })
})
