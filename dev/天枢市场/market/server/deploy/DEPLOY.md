# 天枢市场 · 部署指南（Ubuntu 22.04）

本指南用于将**天枢市场**部署到 Ubuntu 22.04 云服务器。项目结构：

```
market/
├── index.html          # 前台首页
├── pages/              # 详情/登录/我的下载/上传/后台等
├── js/api.js           # 前端统一 API 层
└── server/             # Node.js 后端
    ├── src/index.js    # 服务入口（Express + 内置 SQLite）
    ├── src/seed.js     # 种子数据脚本
    ├── deploy/         # 部署脚本与本文档
    ├── data/market.db  # SQLite 数据库（自动生成）
    └── uploads/        # 上传的资产文件（自动生成）
```

---

## 一、技术栈与环境要求

| 组件 | 说明 |
|---|---|
| Node.js | **≥ 22.5**（使用内置 `node:sqlite`，无需任何原生编译） |
| 数据库 | SQLite（内置，零配置，单文件 `data/market.db`） |
| 进程守护 | PM2（开机自启、崩溃重启） |
| Web 服务 | Nginx（反向代理 + 静态托管） |
| 端口 | 默认 `7878`（可用环境变量 `PORT` 覆盖） |

> 无需 MySQL/PostgreSQL、无需编译工具链，部署非常轻量。

---

## 二、快速一键部署

### 1. 准备服务器
- 一台 Ubuntu 22.04 云服务器（至少 1 核 1G）
- 已开放 SSH（22 端口）

### 2. 上传代码
在本地（市场根目录 `market` 的同级）执行：

```bash
# 把整个 market 目录上传到服务器 /opt/tianshu-market
scp -r ./market root@<服务器IP>:/opt/tianshu-market
```

### 3. 执行部署脚本
```bash
ssh root@<服务器IP>
cd /opt/tianshu-market/server
# 有域名场景（推荐配 Nginx）：
sudo bash deploy/deploy.sh your-domain.com
# 无域名场景（直接用 IP + 端口）：
sudo bash deploy/deploy.sh
```

### 4. 部署完成
- 访问：`http://<服务器IP>:7878`（或 `http://your-domain.com`）
- 管理员：`admin@tianshu.dev` / `admin123`
- **立即修改管理员密码**（登录后通过接口/数据库修改）

---

## 三、手动部署（分步说明）

若想了解每一步做了什么，或自动化脚本失败时排查：

```bash
# 1. 系统依赖
sudo apt update && sudo apt install -y curl git nginx ufw

# 2. Node 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt install -y nodejs
node -v   # 应 ≥ v22.5

# 3. 安装后端依赖
cd /opt/tianshu-market/server
npm install

# 4. 初始化数据库（首次）
npm run seed

# 5. 配置环境变量
cat > .env <<'EOF'
PORT=7878
JWT_SECRET=请改成一段足够长的随机字符串
PUBLIC_DIR=/opt/tianshu-market
EOF

# 6. 用 PM2 启动
sudo npm install -g pm2
pm2 start src/index.js --name tianshu-market --time
pm2 save
pm2 startup systemd -u root --hp /root   # 结果提示的一行命令要再执行一次

# 7. 验证
curl http://127.0.0.1:7878/api/health
```

---

## 四、关键运维操作

### 查看日志
```bash
pm2 logs tianshu-market
```

### 重启 / 停止 / 状态
```bash
pm2 restart tianshu-market
pm2 stop tianshu-market
pm2 status
```

### 数据备份
数据库是单文件，直接备份复制即可：
```bash
# 备份（先停服或用 sqlite 备份避免写坏）
cp /opt/tianshu-market/server/data/market.db /backup/market-$(date +%F).db
# 上传目录
cp -r /opt/tianshu-market/server/uploads /backup/
```

### 重置数据（回到初始种子）
```bash
cd /opt/tianshu-market/server && npm run seed -- --reset && pm2 restart tianshu-market
```

### 修改管理员密码
项目未提供改密界面，可通过 node 脚本：
```bash
cd /opt/tianshu-market/server
node -e "
const bcrypt=require('bcryptjs');
const {db}=require('./src/db');
const h=bcrypt.hashSync('新密码',10);
db.prepare('UPDATE users SET password_hash=? WHERE email=?').run(h,'admin@tianshu.dev');
console.log('密码已更新');"
```

---

## 五、安全加固建议

1. **立即修改** `server/.env` 中的 `JWT_SECRET` 与管理员密码
2. Nginx 上启用 HTTPS（推荐 certbot）：
   ```bash
   sudo apt install -y certbot python3-certbot-nginx
   sudo certbot --nginx -d your-domain.com
   ```
3. `uploads/` 目录可按需做访问控制（当前为公开静态托管，便于下载）
4. 定期备份 `data/market.db` 与 `uploads/`
5. 若只允许特定客户端访问，可在 Nginx 层加 IP 白名单 / Basic Auth

---

## 六、天枢客户端接入

客户端只需**打开一个 URL** 即可使用市场：

### 客户端地址配置
- 本地调试：`http://localhost:7878`
- 服务器部署：`http://<服务器IP>:7878` 或 `https://your-domain.com`

客户端把市场页面的默认地址改为此 URL 即可。前端所有数据请求走同源 `/api/*`，**无需配置跨域（CORS 已内置允许）**。

### 常见问题
| 现象 | 原因与解决 |
|---|---|
| 页面能开但数据是空的 | 后端未启动，或被 `/api` 404；`pm2 status` 检查 |
| 登录后立即退出 | `JWT_SECRET` 重启后变化，导致 token 失效；登录后 token 存 localStorage，重启服务重登即可 |
| 上传大文件失败 | Nginx `client_max_body_size`（脚本已设 60m）+ 后端默认 50MB 上限 |
| 端口被占用 | 改 `.env` 中 `PORT` 后 `pm2 restart` |
| 图片/视频预览不显示 | 确认 `uploads/` 目录有读权限，文件路径为 `/uploads/<文件名>` |
| 客户端内打开某些页面 404 | 确认用的完整 URL（如 `http://IP:7878/pages/asset-detail.html?id=1`），服务已内置历史回退 |

---

## 七、扩展：升级 / 换机

1. 备份服务器上 `server/data/` 与 `server/uploads/`
2. 新机器按本文档部署后，将备份文件覆盖到对应位置
3. `pm2 restart tianshu-market`，数据即恢复