const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');

// 确保数据与上传目录存在
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'market.db');

const db = new DatabaseSync(DB_PATH);

// 开启外键约束（node:sqlite 默认关闭）
db.exec('PRAGMA foreign_keys = ON;');

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT NOT NULL,
      email         TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      avatar        TEXT DEFAULT '',
      role          TEXT NOT NULL DEFAULT 'user',   -- user | admin
      installed     INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS assets (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      cat         TEXT NOT NULL DEFAULT 'skill',
      author      TEXT NOT NULL,
      author_id   INTEGER,                          -- 上传者用户 id（可为空=官方/社区）
      verified    INTEGER NOT NULL DEFAULT 0,
      dl          INTEGER NOT NULL DEFAULT 0,       -- 下载量（安装次数累计）
      rate        REAL NOT NULL DEFAULT 0,
      ver         TEXT NOT NULL DEFAULT '1.0.0',
      days        INTEGER NOT NULL DEFAULT 0,       -- 距今更新天数（用于"最新发布"排序）
      tags        TEXT NOT NULL DEFAULT '[]',       -- JSON 数组
      desc        TEXT NOT NULL DEFAULT '',
      status      TEXT NOT NULL DEFAULT 'live',     -- live | review | rejected | offline
      note        TEXT NOT NULL DEFAULT '',         -- 审核/下架备注
      file_name   TEXT DEFAULT '',                  -- 上传的原始文件名
      file_path   TEXT DEFAULT '',                  -- 存储路径
      file_size   INTEGER NOT NULL DEFAULT 0,       -- 字节
      detail_data TEXT DEFAULT '{}',                -- 类型专属面板 JSON（characterData/skillData 等）
      created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS user_installs (
      user_id    INTEGER NOT NULL,
      asset_id   INTEGER NOT NULL,
      version    TEXT NOT NULL DEFAULT '1.0.0',
      installed_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      PRIMARY KEY (user_id, asset_id),
      FOREIGN KEY (user_id)  REFERENCES users(id)  ON DELETE CASCADE,
      FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_favs (
      user_id    INTEGER NOT NULL,
      asset_id   INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      PRIMARY KEY (user_id, asset_id),
      FOREIGN KEY (user_id)  REFERENCES users(id)  ON DELETE CASCADE,
      FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS related_assets (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      parent_id   INTEGER NOT NULL,
      cat         TEXT NOT NULL,
      name        TEXT NOT NULL,
      ver         TEXT NOT NULL DEFAULT '1.0.0',
      ref         INTEGER,                         -- 关联到的资产 id（可为空）
      rid         INTEGER,                          -- 关联虚拟资产 id（无真实资产行时用）
      FOREIGN KEY (parent_id) REFERENCES assets(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS categories (
      key     TEXT PRIMARY KEY,
      name    TEXT NOT NULL,
      icon    TEXT NOT NULL,
      grad    TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      sort    INTEGER NOT NULL DEFAULT 0
    );
  `);
}

initSchema();

// 迁移：为已存在的库补充 detail_data 列
try {
  const cols = db.prepare(`PRAGMA table_info(assets)`).all().map(c => c.name);
  if (!cols.includes('detail_data')) {
    db.exec(`ALTER TABLE assets ADD COLUMN detail_data TEXT DEFAULT '{}'`);
  }
} catch (e) { /* ignore */ }

module.exports = {
  db,
  DB_PATH,
  DATA_DIR,
  UPLOAD_DIR,
};
