/**
 * sqlite-db.ts — 天枢项目数据库门面。
 *
 * 唯一底层实现是 Node 内置的 `node:sqlite`（DatabaseSync），不安装也不回退
 * better-sqlite3。门面只暴露天枢实际使用的能力（exec / prepare().run|get|all /
 * close），并把事务语义统一为 withTransaction(db, fn)：
 *
 *   外层：BEGIN IMMEDIATE / COMMIT / ROLLBACK
 *   内层：SAVEPOINT / RELEASE / ROLLBACK TO + RELEASE（名称由内部计数器生成）
 *
 * 见 docs/跨平台客户端与Node-SQLite迁移开发指南.md §5.2 / §7.1-§7.3。
 */
import { DatabaseSync, type StatementSync } from 'node:sqlite'

export interface RunResult {
  changes: number
  lastInsertRowid: number | bigint
}

export interface TianshuStatement {
  run(...params: any[]): RunResult
  get(...params: any[]): unknown
  all(...params: any[]): unknown[]
}

export interface TianshuDatabase {
  exec(sql: string): void
  prepare(sql: string): TianshuStatement
  close(): void
}

/** node:sqlite 的 DatabaseSync 暴露 isTransaction，用于判断是否已在外层事务中。 */
export interface TransactionAware extends TianshuDatabase {
  readonly isTransaction: boolean
}

export interface OpenDatabaseOptions {
  /** 锁竞争等待毫秒数（默认 5000，避免短暂锁竞争立即失败）。 */
  timeoutMs?: number
  /** 默认 false：业务代码继续收到 number 而不是 BigInt。 */
  readBigInts?: boolean
  /** 默认 true：兼容 SQL 的 @id 与对象的 { id }（不带前缀）。 */
  allowBareNamedParameters?: boolean
  /**
   * 默认 false：底层保持严格；门面会在调用 StatementSync 前过滤 SQL
   * 未引用的额外对象字段，但缺少 SQL 实际引用的参数仍会报错。
   */
  allowUnknownNamedParameters?: boolean
}

class TianshuStatementImpl implements TianshuStatement {
  private readonly namedParameterKeys: ReadonlySet<string>
  private readonly requiredNamedParameters: ReadonlyMap<string, ReadonlySet<string>>

  constructor(private readonly stmt: StatementSync, sql: string) {
    const keys = new Set<string>()
    const required = new Map<string, Set<string>>()
    // Node 接受带前缀或（allowBareNamedParameters=true 时）不带前缀的键。
    // 多匹配字符串/注释中的 :name 最多只会保留一个额外对象字段，不会改变 SQL。
    for (const match of sql.matchAll(/(?:^|[^A-Za-z0-9_])([:@$][A-Za-z_][A-Za-z0-9_]*)/g)) {
      const token = match[1]
      const bare = token.slice(1)
      keys.add(token)
      keys.add(bare)
      const tokens = required.get(bare) ?? new Set<string>()
      tokens.add(token)
      required.set(bare, tokens)
    }
    this.namedParameterKeys = keys
    this.requiredNamedParameters = required
  }

  private normalizeParams(params: any[]): any[] {
    if (this.namedParameterKeys.size === 0 || params.length === 0) return params
    const named = params[0]
    if (
      named === null ||
      typeof named !== 'object' ||
      Array.isArray(named) ||
      ArrayBuffer.isView(named)
    ) return params

    for (const [bare, tokens] of this.requiredNamedParameters) {
      const hasBare = Object.prototype.hasOwnProperty.call(named, bare)
      const hasPrefixed = [...tokens].some((token) => Object.prototype.hasOwnProperty.call(named, token))
      if (!hasBare && !hasPrefixed) {
        throw new TypeError(`Missing named parameter '${bare}'`)
      }
    }

    const filtered = Object.fromEntries(
      Object.entries(named).filter(([key]) => this.namedParameterKeys.has(key)),
    )
    return [filtered, ...params.slice(1)]
  }

  run(...params: any[]): RunResult {
    // readBigInts: false 时 changes 实际为 number，这里显式规范化以符合接口契约。
    const result = this.stmt.run(...this.normalizeParams(params))
    return { changes: Number(result.changes), lastInsertRowid: result.lastInsertRowid }
  }

  get(...params: any[]): unknown {
    return this.stmt.get(...this.normalizeParams(params))
  }

  all(...params: any[]): unknown[] {
    return this.stmt.all(...this.normalizeParams(params))
  }
}

class TianshuDatabaseImpl implements TransactionAware {
  constructor(private readonly db: DatabaseSync) {}

  get isTransaction(): boolean {
    return this.db.isTransaction
  }

  exec(sql: string): void {
    this.db.exec(sql)
  }

  prepare(sql: string): TianshuStatement {
    return new TianshuStatementImpl(this.db.prepare(sql), sql)
  }

  close(): void {
    this.db.close()
  }
}

/**
 * 打开（或创建）SQLite 数据库并应用与旧驱动一致的行为选项。
 * WAL / foreign_keys 等 PRAGMA 由调用方（schema.ts）负责，门面不隐含迁移。
 */
export function openDatabase(path: string, options: OpenDatabaseOptions = {}): TianshuDatabase {
  const db = new DatabaseSync(path, {
    readBigInts: options.readBigInts ?? false,
    allowBareNamedParameters: options.allowBareNamedParameters ?? true,
    allowUnknownNamedParameters: options.allowUnknownNamedParameters ?? false,
    timeout: options.timeoutMs ?? 5_000,
  })
  return new TianshuDatabaseImpl(db)
}

let savepointSeq = 0

/**
 * 在 db 上运行 fn，外层使用 BEGIN IMMEDIATE，嵌套使用 SAVEPOINT。
 * 异常时回滚并重新抛出原异常；SAVEPOINT 名称由内部单调计数器生成，
 * 不接受业务输入。
 */
export function withTransaction<TResult>(db: TianshuDatabase, fn: () => TResult): TResult {
  if ((db as TransactionAware).isTransaction) {
    const name = `tianshu_sp_${++savepointSeq}`
    db.exec(`SAVEPOINT ${name}`)
    try {
      const result = fn()
      db.exec(`RELEASE ${name}`)
      return result
    } catch (err) {
      try {
        db.exec(`ROLLBACK TO ${name}`)
        db.exec(`RELEASE ${name}`)
      } catch {
        /* 回滚失败时保持原异常 */
      }
      throw err
    }
  }

  db.exec('BEGIN IMMEDIATE')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (err) {
    try {
      db.exec('ROLLBACK')
    } catch {
      /* 保持原异常 */
    }
    throw err
  }
}
