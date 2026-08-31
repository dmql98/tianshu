#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# 天枢市场 · Ubuntu 22.04 一键部署脚本
# 用法: sudo bash deploy.sh [域名或IP] [端口]
#   默认: 域名/IP = 服务器公网IP, 端口 = 7878
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

DOMAIN="${1:-}"
PORT="${2:-7878}"
APP_DIR="/opt/tianshu-market"

echo "══════════════════════════════════════"
echo " 天枢市场部署 · Ubuntu 22.04"
echo " 应用目录: ${APP_DIR}"
echo " 服务端口: ${PORT}"
echo "══════════════════════════════════════"

# 0. 前置检查
if [ "$(id -u)" -ne 0 ]; then
  echo "❌ 请用 root 或 sudo 运行"
  exit 1
fi

# 1. 安装基础工具
echo "▶ 安装基础工具..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl git nginx ufw >/dev/null

# 2. 安装 Node.js 22 LTS（node:sqlite 需要 >=22.5）
echo "▶ 安装 Node.js 22 LTS..."
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d. -f1 | tr -d 'v')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs >/dev/null
fi
NODE_VER=$(node -v)
echo "  ✅ Node ${NODE_VER}"

# 3. 准备应用目录
echo "▶ 准备应用目录 ${APP_DIR}..."
mkdir -p "${APP_DIR}"
cd "${APP_DIR}"

# 4. 拉取/放置代码
# 说明：将 market 目录（含 index.html, pages/, js/, server/）整体放到 /opt/tianshu-market 下
echo "▶ 检查代码..."
if [ ! -f "${APP_DIR}/server/package.json" ]; then
  echo "⚠️  未找到 server/package.json"
  echo "   请先将整个 market 目录 上传到 ${APP_DIR}："
  echo "   scp -r ./market/* root@服务器IP:${APP_DIR}/"
  echo "   然后重新运行本脚本"
  exit 1
fi
if [ ! -f "${APP_DIR}/index.html" ]; then
  echo "⚠️  未找到 index.html（前端静态文件），请一并上传"
  exit 1
fi

# 5. 安装后端依赖
echo "▶ 安装后端依赖（server/）..."
cd "${APP_DIR}/server"
npm install --omit=dev --no-audit --no-fund >/dev/null 2>&1 || npm install --no-audit --no-fund

# 6. 初始化数据库（种子数据）
echo "▶ 初始化数据库与种子数据..."
if [ ! -f "${APP_DIR}/server/data/market.db" ]; then
  npm run seed
else
  echo "  ✅ 数据库已存在，跳过种子（如需重置: cd ${APP_DIR}/server && npm run seed -- --reset）"
fi

# 7. 配置文件（.env）
echo "▶ 生成配置文件 .env..."
cat > "${APP_DIR}/server/.env" <<EOF
PORT=${PORT}
# 生产环境请务必修改 JWT 密钥！
JWT_SECRET=$(head -c 32 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 32)
PUBLIC_DIR=${APP_DIR}
EOF

# 8. 安装 PM2 并启动服务
echo "▶ 安装 PM2 进程守护..."
npm install -g pm2 >/dev/null 2>&1 || true
if pm2 describe tianshu-market >/dev/null 2>&1; then
  pm2 delete tianshu-market >/dev/null 2>&1 || true
fi

# 读取 .env 注入 PM2
set -a
source "${APP_DIR}/server/.env"
set +a
cd "${APP_DIR}/server"
PM2_HOME=/root/.pm2 pm2 start src/index.js --name tianshu-market --time
PM2_HOME=/root/.pm2 pm2 save
PM2_HOME=/root/.pm2 pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true

echo "  ✅ 服务已由 PM2 托管"

# 9. Nginx 反向代理
echo "▶ 配置 Nginx..."
if [ -n "${DOMAIN}" ]; then
  SITE_NAME="tianshu-market"
  cat > "/etc/nginx/sites-available/${SITE_NAME}" <<EOF
server {
    listen 80;
    server_name ${DOMAIN};

    client_max_body_size 60m;

    location / {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 300s;
    }
}
EOF
  ln -sf "/etc/nginx/sites-available/${SITE_NAME}" "/etc/nginx/sites-enabled/${SITE_NAME}"
  rm -f /etc/nginx/sites-enabled/default
  nginx -t && systemctl reload nginx
  echo "  ✅ Nginx 已配置: http://${DOMAIN}"
else
  echo "  ℹ️  未指定域名，跳过 Nginx 配置（默认端口 ${PORT} 直连）"
fi

# 10. 防火墙
echo "▶ 配置防火墙（放行 ${PORT}/80）..."
ufw allow "${PORT}/tcp" >/dev/null 2>&1 || true
ufw allow 80/tcp >/dev/null 2>&1 || true
ufw allow 22/tcp >/dev/null 2>&1 || true
echo "y" | ufw enable >/dev/null 2>&1 || true

# 11. 健康检查
sleep 2
echo "▶ 健康检查..."
HEALTH=$(curl -s -m 5 "http://127.0.0.1:${PORT}/api/health" || echo "")
if echo "${HEALTH}" | grep -q '"ok":true'; then
  echo "══════════════════════════════════════"
  echo " ✅ 部署完成！"
  if [ -n "${DOMAIN}" ]; then
    echo " 🌐 访问地址: http://${DOMAIN}"
  else
    echo " 🌐 访问地址: http://<服务器公网IP>:${PORT}"
  fi
  echo " 🔑 管理员账号: admin@tianshu.dev / admin123"
  echo " ⚠️  请立即登录后台修改管理员密码！"
  echo "══════════════════════════════════════"
else
  echo " ❌ 健康检查失败，请查看日志: pm2 logs tianshu-market"
  exit 1
fi