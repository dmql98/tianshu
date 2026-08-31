const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const config = require('./config');
const routes = require('./routes');
const { attachUser } = require('./auth');
const { db, DB_PATH, DATA_DIR, UPLOAD_DIR } = require('./db');

const app = express();

// ═══════════════ 中间件 ═══════════════
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// 全局挂载用户（解析 token，若存在）
app.use(attachUser);

// 请求日志（简洁）
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.path}${req.user ? ' (user:' + req.user.name + ')' : ''}`);
  }
  next();
});

// ═══════════════ 健康检查 ═══════════════
app.get('/api/health', (req, res) => res.json({ ok: true, service: 'tianshu-market-server', time: new Date().toISOString() }));

// ═══════════════ API 路由 ═══════════════
app.use('/api', routes);

// 已上传文件可公开访问（用于展示）
app.use('/uploads', express.static(UPLOAD_DIR));

// ═══════════════ 前端静态资源 ═══════════════
if (config.serveStatic) {
  const publicDir = config.publicDir;
  app.use(express.static(publicDir, { index: 'index.html' }));
  // SPA 回退：pages 下的 html 直接访问
  app.get('/', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));
  // 历史路由回退到对应 html（简单处理）
  app.get(/^\/(pages\/[\w-]+)\.html$/, (req, res) => {
    const target = path.join(publicDir, req.params[0] + '.html');
    if (fs.existsSync(target)) res.sendFile(target);
    else res.status(404).send('Not Found');
  });
}

// 404 处理（未匹配 API）
app.use('/api', (req, res) => res.status(404).json({ ok: false, message: '接口不存在: ' + req.path }));

// ═══════════════ 错误处理 ═══════════════
app.use((err, req, res, next) => {
  console.error('[错误]', err.message);
  if (err.name === 'MulterError') {
    return res.status(400).json({ ok: false, message: err.code === 'LIMIT_FILE_SIZE' ? '文件超过 50MB 限制' : err.message });
  }
  res.status(500).json({ ok: false, message: err.message || '服务器内部错误' });
});

// ═══════════════ 启动 ═══════════════
app.listen(config.port, () => {
  console.log('════════════════════════════════════════════');
  console.log(`  ✅ 天枢市场服务已启动`);
  console.log(`  📍 本机地址: http://localhost:${config.port}`);
  console.log(`  📍 局域网地址: http://<服务器IP>:${config.port}`);
  console.log(`  🔗 API 文档: http://localhost:${config.port}/api/health`);
  console.log(`  📁 数据库: ${DB_PATH}`);
  console.log(`  📁 上传目录: ${UPLOAD_DIR}`);
  console.log(`  🖥  静态资源: ${config.serveStatic ? config.publicDir : '（未托管，SERVE_STATIC=false）'}`);
  console.log('════════════════════════════════════════════');
});

// 优雅退出
process.on('SIGINT', () => { console.log('\n服务已停止'); process.exit(0); });
