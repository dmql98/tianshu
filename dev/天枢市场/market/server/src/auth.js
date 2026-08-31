const jwt = require('jsonwebtoken');
const config = require('./config');
const { db } = require('./db');

/**
 * 鉴权中间件：从 Authorization: Bearer <token> 解析用户。
 * - 若 token 有效，req.user 为 { id, name, email, role }
 * - 否则放行但 req.user = null（允许匿名浏览）
 */
function attachUser(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  req.user = null;
  if (token) {
    try {
      const payload = jwt.verify(token, config.jwtSecret);
      const u = db.prepare('SELECT id,name,email,role FROM users WHERE id=?').get(payload.id);
      if (u) req.user = u;
    } catch (e) {
      // token 无效或不合法，按匿名处理
    }
  }
  next();
}

/** 强制登录：未登录返回 401 */
function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ ok: false, message: '请先登录' });
  }
  next();
}

/** 管理员校验 */
function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ ok: false, message: '请先登录' });
  if (req.user.role !== 'admin') return res.status(403).json({ ok: false, message: '无权限' });
  next();
}

/** 签发 token */
function signToken(user) {
  return jwt.sign({ id: user.id, email: user.email }, config.jwtSecret, { expiresIn: '7d' });
}

module.exports = { attachUser, requireAuth, requireAdmin, signToken };
