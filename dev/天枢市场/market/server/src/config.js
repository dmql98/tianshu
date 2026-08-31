const path = require('path');
const fs = require('fs');

// 从环境变量或默认值读取配置
const config = {
  // 服务端口（仅接受有效正整数；环境变量 PORT=0 等异常值回退默认 7878）
  port: (() => {
    const p = parseInt(process.env.PORT, 10);
    return Number.isInteger(p) && p > 0 ? p : 7878;
  })(),

  // JWT 密钥（生产环境务必通过环境变量 JWT_SECRET 覆盖）
  jwtSecret: process.env.JWT_SECRET || 'tianshu-market-dev-secret-change-me',

  // 前端静态文件根目录（market 根目录，含 index.html 与 pages/）
  publicDir: process.env.PUBLIC_DIR || path.join(__dirname, '..', '..'),

  // 生产是否托管静态资源（默认托管，客户端用 URL 直接打开）
  serveStatic: process.env.SERVE_STATIC !== 'false',
};

// 校验静态目录存在
try {
  const idx = path.join(config.publicDir, 'index.html');
  if (!fs.existsSync(idx)) {
    console.warn(`[警告] 静态资源目录未找到 index.html: ${idx}。若前端从其它地址访问，请设置 PUBLIC_DIR。`);
  }
} catch (e) { /* ignore */ }

module.exports = config;
