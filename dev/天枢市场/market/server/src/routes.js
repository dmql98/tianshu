const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const { db, UPLOAD_DIR } = require('./db');
const { attachUser, requireAuth, requireAdmin, signToken } = require('./auth');
const { rowToAsset, queryAssets } = require('./assetHelper');
const config = require('./config');

const router = express.Router();

/* ═══════════════ 静态文件上传配置 ═══════════════
 * 支持任意文件类型（图片/视频/md/脚本/zip/tianshu 等），限制单文件 50MB */
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const uid = crypto.randomBytes(8).toString('hex');
    cb(null, `${Date.now()}-${uid}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

/* ═══════════════ 分类 ═══════════════ */
router.get('/categories', (req, res) => {
  const cats = db.prepare('SELECT * FROM categories WHERE enabled=1 ORDER BY sort').all();
  // 附带每类资产数
  const withCount = cats.map(c => {
    const cnt = db.prepare("SELECT COUNT(*) c FROM assets WHERE cat=? AND status='live'").get(c.key).c;
    return { ...c, count: cnt };
  });
  res.json({ ok: true, data: withCount });
});

/* ═══════════════ 资产 ═══════════════ */
// 列表：/api/assets?cat=&q=&sort=
router.get('/assets', (req, res) => {
  try {
    const list = queryAssets({
      cat: req.query.cat,
      q: (req.query.q || '').trim(),
      sort: req.query.sort,
      viewUserId: req.user ? req.user.id : null,
    });
    res.json({ ok: true, data: list });
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message });
  }
});

// 详情：/api/assets/:id
router.get('/assets/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM assets WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ ok: false, message: '资产未找到' });
  const asset = rowToAsset(row, req.user ? req.user.id : null);
  res.json({ ok: true, data: asset });
});

// 下载文件（真实资产文件，任意类型）
router.get('/assets/:id/file', (req, res) => {
  const row = db.prepare('SELECT * FROM assets WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ ok: false, message: '资产未找到' });
  if (!row.file_path || !fs.existsSync(row.file_path)) {
    return res.status(404).json({ ok: false, message: '该资产暂无文件包' });
  }
  res.download(row.file_path, row.file_name || path.basename(row.file_path));
});

// 安装资产（记录到 user_installs，并累加下载量）
router.post('/assets/:id/install', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM assets WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ ok: false, message: '资产未找到' });

  const same = db.prepare('SELECT * FROM user_installs WHERE user_id=? AND asset_id=?').get(req.user.id, row.id);
  if (!same) {
    db.prepare('INSERT INTO user_installs (user_id,asset_id,version) VALUES (?,?,?)').run(req.user.id, row.id, row.ver);
    db.prepare('UPDATE assets SET dl=dl+1 WHERE id=?').run(row.id);
    // 更新用户已安装计数
    const c = db.prepare('SELECT COUNT(*) c FROM user_installs WHERE user_id=?').get(req.user.id).c;
    db.prepare('UPDATE users SET installed=? WHERE id=?').run(c, req.user.id);
  }
  res.json({ ok: true, message: '安装成功' });
});

// 卸载资产
router.delete('/assets/:id/install', requireAuth, (req, res) => {
  db.prepare('DELETE FROM user_installs WHERE user_id=? AND asset_id=?').run(req.user.id, req.params.id);
  const c = db.prepare('SELECT COUNT(*) c FROM user_installs WHERE user_id=?').get(req.user.id).c;
  db.prepare('UPDATE users SET installed=? WHERE id=?').run(c, req.user.id);
  res.json({ ok: true, message: '已卸载' });
});

// 收藏资产
router.post('/assets/:id/fav', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM assets WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ ok: false, message: '资产未找到' });
  db.prepare('INSERT OR IGNORE INTO user_favs (user_id,asset_id) VALUES (?,?)').run(req.user.id, row.id);
  res.json({ ok: true, message: '已收藏' });
});

// 取消收藏
router.delete('/assets/:id/fav', requireAuth, (req, res) => {
  db.prepare('DELETE FROM user_favs WHERE user_id=? AND asset_id=?').run(req.user.id, req.params.id);
  res.json({ ok: true, message: '已取消收藏' });
});

/* ═══════════════ 认证 ═══════════════ */
// 注册
router.post('/auth/register', (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ ok: false, message: '请填写完整信息' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ ok: false, message: '邮箱格式不正确' });
  if (password.length < 6) return res.status(400).json({ ok: false, message: '密码至少 6 位' });
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) {
    return res.status(409).json({ ok: false, message: '该邮箱已注册' });
  }
  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare('INSERT INTO users (name,email,password_hash,avatar,role) VALUES (?,?,?,?,?)')
    .run(name, email, hash, '', 'user');
  const user = db.prepare('SELECT id,name,email,role FROM users WHERE id=?').get(info.lastInsertRowid);
  const token = signToken(user);
  res.json({ ok: true, data: { token, user } });
});

// 登录
router.post('/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ ok: false, message: '请填写邮箱与密码' });
  const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ ok: false, message: '邮箱或密码错误' });
  }
  if (user.role === 'banned') return res.status(403).json({ ok: false, message: '账号已被封禁' });
  const installed = db.prepare('SELECT COUNT(*) c FROM user_installs WHERE user_id=?').get(user.id).c;
  const token = signToken(user);
  res.json({
    ok: true,
    data: {
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, avatar: user.avatar, installed },
    },
  });
});

// 当前用户（附带安装与收藏列表）
router.get('/auth/me', requireAuth, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  const installedCount = db.prepare('SELECT COUNT(*) c FROM user_installs WHERE user_id=?').get(u.id).c;
  // 关联安装的资产详情
  const installedObj = db.prepare(`SELECT a.* FROM user_installs ui JOIN assets a ON a.id=ui.asset_id WHERE ui.user_id=?`).all(u.id);
  const favIds = db.prepare('SELECT asset_id FROM user_favs WHERE user_id=?').all(u.id).map(r => r.asset_id);
  res.json({
    ok: true,
    data: {
      user: { id: u.id, name: u.name, email: u.email, role: u.role, avatar: u.avatar, installed: installedCount },
      installed_assets: installedObj.map(r => rowToAsset(r)),
      fav_ids: favIds,
    },
  });
});

/* ═══════════════ 我的 ═══════════════ */
// 我的下载（已安装资产列表）
router.get('/me/installs', requireAuth, (req, res) => {
  const rows = db.prepare(`SELECT a.* FROM user_installs ui JOIN assets a ON a.id=ui.asset_id WHERE ui.user_id=? ORDER BY ui.installed_at DESC`).all(req.user.id);
  res.json({ ok: true, data: rows.map(r => rowToAsset(r)) });
});

// 我的收藏
router.get('/me/favs', requireAuth, (req, res) => {
  const rows = db.prepare(`SELECT a.* FROM user_favs f JOIN assets a ON a.id=f.asset_id WHERE f.user_id=? ORDER BY f.created_at DESC`).all(req.user.id);
  res.json({ ok: true, data: rows.map(r => rowToAsset(r)) });
});

// 我的上传
router.get('/me/uploads', requireAuth, (req, res) => {
  const rows = db.prepare(`SELECT * FROM assets WHERE author_id=? ORDER BY updated_at DESC`).all(req.user.id);
  res.json({ ok: true, data: rows.map(r => rowToAsset(r)) });
});

// 上传新资产（multipart：file + 表单字段）。任意文件类型。
router.post('/assets/upload', requireAuth, upload.single('file'), (req, res) => {
  const { name, desc, ver, tags, cat, detail_data } = req.body || {};
  if (!name) return res.status(400).json({ ok: false, message: '请填写资产名称' });
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);

  let file_name = '', file_path = '', file_size = 0;
  if (req.file) {
    file_name = req.file.originalname;
    file_path = req.file.path;
    file_size = req.file.size;
  }

  // detail_data 为可选 JSON 字符串
  let ddata = '{}';
  if (detail_data) {
    try { ddata = JSON.stringify(JSON.parse(detail_data)); } catch (e) { ddata = JSON.stringify({ raw: detail_data }); }
  }

  const info = db.prepare(`INSERT INTO assets
    (name,cat,author,author_id,ver,tags,desc,detail_data,status,file_name,file_path,file_size,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,'review',?,?,?,datetime('now','localtime'),datetime('now','localtime'))`)
    .run(
      name, cat || 'skill', u.name, req.user.id, ver || '1.0.0',
      JSON.stringify((tags || '').split(/[,，\s]+/).filter(Boolean)),
      desc || '', ddata, file_name, file_path, file_size,
    );

  res.json({ ok: true, message: '已提交审核', data: { id: Number(info.lastInsertRowid) } });
});

// 本地资产导入（multipart：file = .tianshu JSON 包，来自天枢客户端的"发布到市场"）
// 包格式：{ version:1, meta:{name,cat,ver,tags,desc}, detail:{...}, files:{ "路径": "base64" } }
// 后端自动解析 meta.detail 生成 detail_data，原始包号存库（下载=给包，客户端解包落盘）。
router.post('/assets/import-local', requireAuth, upload.single('file'), (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!req.file) return res.status(400).json({ ok: false, message: '缺少资产包文件' });

  let pkg = null;
  try {
    pkg = JSON.parse(fs.readFileSync(req.file.path, 'utf-8'));
  } catch (e) {
    return res.status(400).json({ ok: false, message: '资产包不是有效的 JSON 包（请用客户端"发布到市场"导出）' });
  }

  const meta = (pkg && pkg.meta) || {};
  const detail = (pkg && pkg.detail) || {};
  const name = (req.body.name || meta.name || '').trim();
  if (!name) return res.status(400).json({ ok: false, message: '资产包缺少名称（meta.name）' });
  if (!meta.cat) return res.status(400).json({ ok: false, message: '资产包缺少类型（meta.cat）' });

  // 由 detail 自动生成类型面板字段：角色 characterData、主题 themeData、MCP mcpData 等
  // detail 键形如 { characterData:{...} } 或 { soul, tools, skills, maxSteps, strategy }（自动包裹）
  let detailObj = detail;
  const KNOWN = ['characterData','skillData','themeData','mcpData','iconpackData','toolData','providerData','changelog'];
  if (!KNOWN.some(k => detailObj[k])) {
    // 裸字段 → 按类型包裹
    const wrap = { character: 'characterData', skill: 'skillData', theme: 'themeData',
      mcp: 'mcpData', iconpack: 'iconpackData', tool: 'toolData', provider: 'providerData' }[meta.cat];
    if (wrap && wrap !== 'changelog') detailObj = { [wrap]: detailObj };
  }
  const ddata = JSON.stringify(detailObj);

  const tags = Array.isArray(meta.tags) ? meta.tags : String(meta.tags || '').split(/[,，\s]+/).filter(Boolean);
  const info = db.prepare(`INSERT INTO assets
    (name,cat,author,author_id,ver,tags,desc,detail_data,status,file_name,file_path,file_size,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,'review',?,?,?,datetime('now','localtime'),datetime('now','localtime'))`)
    .run(
      name, meta.cat, u.name, req.user.id, meta.ver || '1.0.0',
      JSON.stringify(tags), meta.desc || '', ddata,
      req.file.originalname, req.file.path, req.file.size,
    );

  res.json({ ok: true, message: '资产包已提交审核', data: { id: Number(info.lastInsertRowid), parsed: Object.keys(detailObj) } });
});

// 编辑资产（重新提交）：/api/assets/:id/update，multipart 可选文件
router.post('/assets/:id/update', requireAuth, upload.single('file'), (req, res) => {
  const row = db.prepare('SELECT * FROM assets WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ ok: false, message: '资产未找到' });
  // 仅作者本人或管理员可编辑
  if (row.author_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ ok: false, message: '无权编辑该资产' });
  }
  const { name, desc, ver, tags, cat, detail_data } = req.body || {};
  let file_path = row.file_path, file_name = row.file_name, file_size = row.file_size;
  if (req.file) { file_path = req.file.path; file_name = req.file.originalname; file_size = req.file.size; }

  let ddata = row.detail_data;
  if (detail_data) {
    try { ddata = JSON.stringify(JSON.parse(detail_data)); } catch (e) { ddata = JSON.stringify({ raw: detail_data }); }
  }

  db.prepare(`UPDATE assets SET
      name=?, cat=?, ver=?, tags=?, desc=?, detail_data=?, status='review', note='',
      file_path=?, file_name=?, file_size=?,
      updated_at=datetime('now','localtime')
    WHERE id=?`).run(
    name || row.name, cat || row.cat, ver || row.ver,
    JSON.stringify((tags || '').split(/[,，\s]+/).filter(Boolean)),
    desc || row.desc, ddata, file_path, file_name, file_size, row.id,
  );
  res.json({ ok: true, message: '已保存并重新提交审核' });
});

// 下架/删除自己上传的资产
router.delete('/assets/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM assets WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ ok: false, message: '资产未找到' });
  if (row.author_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ ok: false, message: '无权操作该资产' });
  }
  // 逻辑下架：移到 offline，不物理删除（保留文件）
  db.prepare(`UPDATE assets SET status='offline', note='已下架', updated_at=datetime('now','localtime') WHERE id=?`).run(row.id);
  res.json({ ok: true, message: '已下架' });
});

/* ═══════════════ 管理后台 ═══════════════ */
// 后台看板统计
router.get('/admin/stats', requireAdmin, (req, res) => {
  const assets = db.prepare('SELECT COUNT(*) c FROM assets').get().c;
  const users = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  const downloads = db.prepare('SELECT COALESCE(SUM(dl),0) s FROM assets').get().s;
  const review = db.prepare("SELECT COUNT(*) c FROM assets WHERE status='review'").get().c;
  const live = db.prepare("SELECT COUNT(*) c FROM assets WHERE status='live'").get().c;
  const catRows = db.prepare("SELECT cat, COUNT(*) c FROM assets WHERE status='live' GROUP BY cat").all();
  const recent = db.prepare('SELECT * FROM assets ORDER BY created_at DESC LIMIT 8').all();
  res.json({
    ok: true,
    data: {
      assets, users, downloads, review, live,
      catStats: catRows,
      recent: recent.map(r => rowToAsset(r)),
    },
  });
});

// 后台审核队列
router.get('/admin/review', requireAdmin, (req, res) => {
  const rows = db.prepare(`SELECT * FROM assets WHERE status='review' ORDER BY created_at DESC`).all();
  res.json({ ok: true, data: rows.map(r => rowToAsset(r)) });
});

// 审核操作：通过 / 驳回
router.post('/admin/review/:id', requireAdmin, (req, res) => {
  const { action, note } = req.body || {};
  const row = db.prepare('SELECT * FROM assets WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ ok: false, message: '资产未找到' });
  const status = action === 'approve' ? 'live' : 'rejected';
  db.prepare(`UPDATE assets SET status=?, note=?, updated_at=datetime('now','localtime') WHERE id=?`).run(status, note || '', row.id);
  res.json({ ok: true, message: status === 'live' ? '已通过审核上架' : '已驳回' });
});

module.exports = router;
