# 天枢市场社区 — 本地开发方案

> 基于现有 TianShu 代码库，搭建可部署到云服务器的独立社区 Web 应用。

---

## 1. 现状分析

| 层 | 现有技术 | 位置 |
|---|---|---|
| 后端 | Hono + TypeScript + node:sqlite + tsx | `web/server/` |
| 前端 | React 18 + Vite + Zustand + React Router + TypeScript | `web/client/` |
| 桌面 | Electron（封装上述前后端） | `desktop/` |
| 原型 | HTML + Tailwind CDN + Vanilla JS | `prototype/` |

**关键发现**：
- `web/server/src/routes/` 已有 17 个路由模块：characters / skills / themes / iconpacks / providers / skins / prompts / tools 等
- `web/server/src/db/sqlite-db.ts` 已有完整的 SQLite 事务封装（`node:sqlite`）
- `web/client/src/pages/` 已有 MarketPage / CharactersPage / SkillsPage 等 15 个页面
- 共享合约 `shared/desktop-contract.ts` 定义了数据结构

**结论**：不需要从零搭建，基于现有 `web/` 扩展即可。

---

## 2. 架构决策

### 2.1 选型：在现有 web/ 上扩展（非新建项目）

理由：
- 后端路由、数据库层、类型定义已就绪
- 前端组件、状态管理、路由框架已就绪
- 避免维护两套代码，原型阶段的设计直接迁移为 React 组件
- 共享 `shared/` 合约层，桌面端和 Web 社区共用数据结构

### 2.2 新增模块清单

```
web/
├── server/src/
│   ├── routes/
│   │   ├── auth.ts              ← 新增：注册/登录/JWT/刷新
│   │   ├── admin.ts             ← 新增：管理后台 API
│   │   ├── upload.ts            ← 新增：资产上传/审核
│   │   ├── users.ts             ← 新增：用户管理
│   │   └── ... (现有路由保持)
│   ├── middleware/
│   │   └── auth-guard.ts        ← 新增：JWT 鉴权中间件
│   └── db/
│       └── migrations/
│           └── 001_community.sql ← 新增：用户表/审核表/评论表
│
├── client/src/
│   ├── pages/
│   │   ├── LoginPage.tsx         ← 新增：登录/注册页
│   │   ├── AdminPage.tsx         ← 新增：管理后台
│   │   ├── MarketPage.tsx        ← 改造：从原型迁移两栏布局
│   │   ├── AssetDetailPage.tsx   ← 改造：类型特定面板
│   │   └── ... (现有页面)
│   ├── components/
│   │   ├── Sidebar.tsx           ← 新增：统一侧栏（含登录态）
│   │   ├── Header.tsx            ← 新增：面包屑 + 搜索 + 通知
│   │   ├── AssetCard.tsx         ← 新增：资产卡片
│   │   ├── TypePanel.tsx         ← 新增：类型特定内容面板
│   │   ├── ReviewCard.tsx        ← 新增：审核项卡片
│   │   └── ui/                   ← 新增：通用 UI 组件
│   │       ├── Button.tsx
│   │       ├── Modal.tsx
│   │       ├── Table.tsx
│   │       ├── Toast.tsx
│   │       ├── Toggle.tsx
│   │       └── Pagination.tsx
│   ├── stores/
│   │   ├── authStore.ts          ← 新增：登录态（JWT + 用户信息）
│   │   └── adminStore.ts         ← 新增：管理后台数据
│   └── features/
│       └── market/               ← 新增：市场功能模块
│           ├── api.ts            ← 资产 CRUD API 调用
│           └── types.ts          ← 类型定义
│
└── shared/
    └── market-contract.ts        ← 新增：社区共享类型
```

### 2.3 数据库扩展（SQLite）

```sql
-- 用户表
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  avatar TEXT DEFAULT '',
  role TEXT DEFAULT 'user',        -- user | creator | admin | super_admin
  status TEXT DEFAULT 'active',    -- active | banned
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 资产审核表
CREATE TABLE asset_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_name TEXT NOT NULL,
  asset_type TEXT NOT NULL,        -- character | skill | mcp | theme | ...
  author_id INTEGER REFERENCES users(id),
  status TEXT DEFAULT 'pending',   -- pending | approved | rejected
  review_note TEXT DEFAULT '',
  submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  reviewed_at DATETIME
);

-- 评论表
CREATE TABLE comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id INTEGER NOT NULL,
  user_id INTEGER REFERENCES users(id),
  content TEXT NOT NULL,
  rating INTEGER,                  -- 1-5 星
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 操作日志表
CREATE TABLE admin_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  target TEXT NOT NULL,
  level TEXT DEFAULT 'info',       -- info | warn | error
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## 3. 开发计划

### Phase 1：基础设施（第 1-2 天）

| 任务 | 说明 | 产出 |
|------|------|------|
| 1.1 数据库迁移 | 创建 users / asset_reviews / comments / admin_logs 表 | `db/migrations/001_community.sql` |
| 1.2 密码哈希 | 集成 bcrypt（或 Web Crypto API PBKDF2） | `server/src/lib/crypto.ts` |
| 1.3 JWT 鉴权 | access_token (15min) + refresh_token (7d)，Hono 中间件 | `middleware/auth-guard.ts` + `routes/auth.ts` |
| 1.4 前端路由 | 新增 `/login` `/admin` `/assets/:id` 路由 | `App.tsx` 路由配置 |

### Phase 2：核心 API（第 3-5 天）

| 任务 | 说明 |
|------|------|
| 2.1 Auth API | `POST /api/auth/register` / `POST /api/auth/login` / `POST /api/auth/refresh` / `GET /api/auth/me` |
| 2.2 资产 API 增强 | 在现有路由上增加分页、筛选、排序；`POST /api/assets/:id/review` 审核接口 |
| 2.3 用户 API | `GET /api/users` / `PUT /api/users/:id/role` / `PUT /api/users/:id/ban` |
| 2.4 上传 API | `POST /api/assets/submit` 上传 + 入库；`PUT /api/assets/:id/status` 上下架 |
| 2.5 管理 API | `GET /api/admin/stats` 看板统计 / `GET /api/admin/logs` 操作日志 |

### Phase 3：前端页面（第 6-10 天）

| 任务 | 对应原型 |
|------|---------|
| 3.1 登录/注册页 | `login.html` → React，保留微信/QQ/GitHub/Google |
| 3.2 侧栏组件 | 各页面共享，读取 `authStore` 显示登录态 |
| 3.3 市场首页 | `index.html` → `MarketPage.tsx`，Banner + 资产网格 |
| 3.4 资产详情页 | `asset-detail.html` → `AssetDetailPage.tsx`，两栏布局 + 类型面板 + 关联资产 |
| 3.5 管理后台 | `admin.html` → `AdminPage.tsx`，7 个子模块（Tab 切换） |
| 3.6 UI 组件库 | Button / Modal / Table / Toast / Toggle / Pagination |

### Phase 4：部署准备（第 11-12 天）

| 任务 | 说明 |
|------|------|
| 4.1 构建脚本 | `npm run build` 产出 `dist/`（server + client 静态文件） |
| 4.2 部署配置 | Dockerfile + docker-compose.yml（Node.js + SQLite + Nginx） |
| 4.3 环境变量 | `DATABASE_PATH` / `JWT_SECRET` / `PORT` / `CORS_ORIGIN` |
| 4.4 静态资源 | Nginx 反代 API，前端静态文件直接 serve |

---

## 4. 本地开发环境搭建

### 4.1 依赖安装

```bash
cd web/server
npm install                    # Hono + node:sqlite + zod 等
npm install bcryptjs           # 密码哈希（纯 JS，无需编译）
npm install -D @types/bcryptjs

cd ../client
npm install                    # React + Vite + Zustand + Tailwind
npm install -D tailwindcss @tailwindcss/vite  # Tailwind v4
npm install lucide-react       # 图标库（替代 FontAwesome CDN）
npm install @tanstack/react-query  # 数据请求
```

### 4.2 开发启动

```bash
# 终端 1：后端（热更新）
cd web/server
npm run dev                    # tsx watch → localhost:3456

# 终端 2：前端（热更新）
cd web/client
npm run dev                    # vite → localhost:5173（代理 /api → 3456）
```

### 4.3 Vite 代理配置（client/vite.config.ts）

```typescript
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:3456',
      '/ws': { target: 'ws://127.0.0.1:3456', ws: true },
    }
  }
})
```

---

## 5. 云服务器部署方案

### 5.1 架构

```
互联网 → Nginx (80/443, SSL)
           ├── /          → 静态文件 (client/dist)
           ├── /api       → Node.js (localhost:3456)
           └── /ws        → WebSocket (localhost:3456)
           
Node.js 进程管理：PM2
SQLite 数据库：/var/lib/tianshu/market.db
```

### 5.2 Docker 部署（可选）

```yaml
# docker-compose.yml
services:
  app:
    build: .
    ports: ["3456:3456"]
    volumes:
      - tianshu-data:/data        # SQLite + 上传文件
    environment:
      - PORT=3456
      - DATABASE_PATH=/data/market.db
      - JWT_SECRET=${JWT_SECRET}
      - CORS_ORIGIN=https://market.tianshu.dev
    restart: unless-stopped

volumes:
  tianshu-data:
```

### 5.3 最低配置

| 资源 | 推荐 |
|------|------|
| CPU | 2 核 |
| 内存 | 2GB |
| 硬盘 | 40GB SSD |
| 系统 | Ubuntu 22.04 / Debian 12 |
| Node | 24.x（与现有项目一致） |

---

## 6. 技术风险与对策

| 风险 | 对策 |
|------|------|
| SQLite 并发写入瓶颈 | 社区初期流量可控；后期可迁移至 PostgreSQL（代码层只改 `sqlite-db.ts`） |
| 现有路由与社区路由冲突 | 社区 API 统一加 `/api/` 前缀，与桌面端 IPC 路径分离 |
| Tailwind v4 与现有 CSS 冲突 | 社区页面用 Tailwind v4；现有页面保持 v3 或 CDN 原型不变 |
| 原型设计与 React 组件不一致 | 以原型为视觉基准，逐组件 pixel-perfect 还原 |

---

## 7. 文件产出清单

```
# 本次开发新建的文件（约 40 个）
web/server/src/middleware/auth-guard.ts
web/server/src/lib/crypto.ts
web/server/src/routes/auth.ts
web/server/src/routes/admin.ts
web/server/src/routes/upload.ts
web/server/src/routes/users.ts
web/server/src/db/migrations/001_community.sql

web/client/src/pages/LoginPage.tsx
web/client/src/pages/AdminPage.tsx
web/client/src/components/Sidebar.tsx
web/client/src/components/Header.tsx
web/client/src/components/AssetCard.tsx
web/client/src/components/TypePanel.tsx
web/client/src/components/ui/*.tsx (6 个)
web/client/src/stores/authStore.ts
web/client/src/stores/adminStore.ts
web/client/src/features/market/api.ts
web/client/src/features/market/types.ts
web/client/tailwind.config.ts
web/client/vite.config.ts (修改)

shared/market-contract.ts

Dockerfile
docker-compose.yml
nginx.conf
```

---

## 8. 何时开始？

确认后立即从 **Phase 1（基础设施）** 开始，顺序为：

1. 创建数据库迁移脚本
2. 实现密码哈希 + JWT 鉴权
3. 实现 Auth API（注册/登录/刷新/用户信息）
4. 前端路由 + Tailwind 配置
5. 登录/注册页面
6. …按 Phase 1→2→3→4 推进
