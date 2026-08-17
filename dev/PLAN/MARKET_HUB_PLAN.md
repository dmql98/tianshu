# 天枢星河市场（Market Hub）建设方案

> 目标：把 CocoLoop 式的 Skills 市场（skills / 专题 / 热门）内置到天枢客户端，
> 用公司服务器 + 公网 IP 做云端内容仓库，支撑后续客户端分发。
> 状态：方案稿 v1.0　日期：2025-08-17

---

## 1. CocoLoop 竞品拆解（已实测抓取）

### 1.1 页面结构

| 页面 | 路由 | 板块 | 核心功能 |
|---|---|---|---|
| 首页 | `/` | Hero 区 | "我是人类 / 我是智能体" 双入口 + 全局搜索（Command+K） |
| | | 统计条 | 可用 Skills 总数、支持平台数、CLS 安全检查徽章 |
| | | 精选 Skills 榜单 | 人工精选 Top 50，分类 tab：信息抓取 / Agent 增强 / 技术开发 / 自媒体创作 / 产品与创业 / 知识文件管理 / 理财炒股 / 赛博人类 |
| | | 精选专题 | 文章卡片（标题+摘要），"更多专题 →" 链到 /article |
| | | 热门 Skills | 总排行 / 近期最热 / 最新上传 三个排序 + 分类 tab |
| 专题 | `/article` | 文章列表 | 按日期分组，标题 + 摘要，分页 |
| | | 热门 Skills 侧栏 | 右侧复用热门卡片 |
| 热门 | `/popular` | 排行榜 | 总排行 / 近期最热 / 最新上传 + 分类 tab |
| 详情 | `/skills/:id` | 信息区 | 面包屑、名称+emoji+一句话描述、收藏/安装/版本/安全认证徽章 |
| | | 内容区 | 使用说明（README 渲染）、安全解读、标签 |
| | | 文件区 | 文件结构列表 + 手动下载 zip |
| | | 安装区 | 40+ Agent 一键安装入口（Molili/OpenClaw/Claude Code/Cursor/Codex…） |
| | | 推荐区 | 相关 Skills 推荐 |

### 1.2 值得借鉴的机制

1. **双入口引导**：人类用户走可视化安装，智能体用户走一键安装命令，降低理解成本。
2. **安全认证前置**：每个卡片带安全等级徽章（S+/S/A/B + CLS 认证），安装前看到风险提示。
3. **分类 tab 统一**：榜单、热门、搜索共用同一套分类体系，后端一个分类维度通吃。
4. **zip 手动兜底**：自动安装之外永远保留手动下载，兼容任何客户端。
5. **安装即统计**：收藏/安装数驱动排行榜，形成内容飞轮。

---

## 2. 天枢现状盘点（已核实代码）

### 2.1 已有资产

| 资产 | 位置 | 状态 |
|---|---|---|
| 市场页面雏形 | `web/client/src/pages/MarketPage.tsx`（249 行） | ✅ 已有"星河"市场 UI，含横幅/热门榜/分类/卡片，**全部为硬编码假数据，未接 API** |
| 市场路由 | `web/client/src/App.tsx` 第 152 行 `/market` + 导航第 30 行 | ✅ 已挂载 |
| 技能包 CRUD | `web/server/src/routes/skills.ts`：`GET/POST /api/skills/packages`、详情、文件读取、materialize/hide/restore | ✅ 完整 |
| 技能目录引擎 | `web/server/src/agent/skill-catalog.ts`（扫描+frontmatter 解析）、`skill-package-writer.ts`（创建） | ✅ 完整 |
| 角色系统 | `web/server/src/character/store.ts` + `routes/characters.ts` | ✅ 完整 |
| MCP 管理 | `routes/tools.ts` 等 + 前端 McpPage | ✅ 完整 |
| SQLite | `web/server/src/db/schema.ts`（sessions/messages/characters/…） | ✅ 已有，可加表 |
| 桌面端 | Electron + 内置 server（`server-manager.ts`）+ 自动更新（`updater.ts` + electron-updater） | ✅ 分发通道已具备雏形 |
| 部署产物 | `electron-builder.yml`：win nsis / mac dmg+zip / linux AppImage+deb | ✅ 三端产物已配置 |

### 2.2 差距

1. 市场页是静态假数据，无任何云端 API 对接。
2. 没有"安装市场包"的动作：技能包只能本地创建，不能从远端下载落地。
3. 没有内容管理后台：发布技能/文章/排行榜都需要人工维护数据。
4. 没有安装/收藏统计，无法支撑"热门"排序。
5. 更新源、安装包托管目前没有指向任何服务器。

---

## 3. 目标架构

```
┌─ 客户端（天枢 Desktop / Web）─────────────┐      ┌─ 公司服务器（公网 IP）──────────────┐
│                                            │      │                                     │
│  MarketPage（星河市场，内置）                │      │  Market Hub 服务（Node + Hono）       │
│   ├─ 首页：精选榜单/专题/热门（三个板块）     │ ───► │   ├─ GET /api/catalog     列表+搜索   │
│   ├─ 专题页：文章列表 + 详情                 │      │   ├─ GET /api/catalog/:id 详情       │
│   ├─ 热门页：总排行/近期最热/最新上传        │ ◄─── │   ├─ GET /api/articles    专题       │
│   ├─ 详情页：README/安全/文件/一键安装       │      │   ├─ GET /api/popular    热门排行   │
│   └─ 安装动作 → 写入本地技能包/角色/MCP      │      │   ├─ POST /api/installs  统计上报   │
│                                            │      │   ├─ POST /api/admin/*  管理接口     │
│  本地内置服务（Hono）                        │      │   └─ 静态托管：zip 包 / 图标 / 文章   │
│   └─ /api/skills/packages（已有 CRUD）      │      │                                     │
│      接收市场包 → 解压 → 注册               │      │  Caddy/Nginx：HTTPS 443 + 静态文件  │
└────────────────────────────────────────────┘      └─────────────────────────────────────┘
```

**核心思路**：客户端内置市场页面只做"浏览 + 安装动作"；内容仓库、统计、管理后台全部放公司服务器。客户端与服务器解耦 —— 服务器挂了市场页降级为"仅已安装/离线缓存"，天枢其余功能不受影响。

### 3.1 三类内容统一模型

市场同时承载三类资产（与 CocoLoop 只做 Skills 相比，这是天枢的差异化）：

| 类型 | 安装动作 | 落地位置 |
|---|---|---|
| 技能包 | 下载 zip → 解压到技能目录 → 刷新 skill-catalog | `skillsRoot()`（`data-paths.ts`） |
| 角色 | 下载 json → 校验 → 写入角色库（character store） | 角色定义库 |
| MCP 服务 | 下载配置 json → 校验 → 注册到 mcp 配置 | MCP 配置存储 |

---

## 4. 云端数据模型（Market Hub 库，独立 SQLite）

```sql
-- 内容条目（技能/角色/MCP 统一）
CREATE TABLE catalog_items (
  id            TEXT PRIMARY KEY,          -- 如 'tavily-search-pro'
  type          TEXT NOT NULL,             -- 'skill' | 'character' | 'mcp'
  name          TEXT NOT NULL,
  description   TEXT,
  category      TEXT NOT NULL,             -- 与前端分类 tab 一致
  tags          TEXT,                      -- JSON 数组
  icon          TEXT,                      -- emoji 或图标 URL
  author        TEXT,
  version       TEXT,
  readme        TEXT,                      -- 使用说明（Markdown）
  safety_level  TEXT DEFAULT 'B',          -- S+/S/A/B，对应安全评级
  safety_report TEXT,                      -- 安全解读（Markdown）
  file_list     TEXT,                      -- JSON：包内文件结构
  package_url   TEXT NOT NULL,             -- zip/json 下载地址
  package_sha256 TEXT,                     -- 安装前校验
  package_size  INTEGER,
  status        TEXT DEFAULT 'published',  -- draft | published | removed
  created_at    TEXT, updated_at TEXT
);

-- 专题文章
CREATE TABLE articles (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  slug       TEXT UNIQUE,
  title      TEXT NOT NULL,
  summary    TEXT,
  cover      TEXT,
  body       TEXT,                         -- Markdown
  tags       TEXT,
  published_at TEXT,
  status     TEXT DEFAULT 'draft'
);

-- 统计（安装/收藏计数，驱动热门榜）
CREATE TABLE install_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id    TEXT NOT NULL,
  client_id  TEXT,                         -- 匿名设备指纹
  created_at TEXT
);
CREATE TABLE favorite_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id    TEXT NOT NULL,
  client_id  TEXT,
  created_at TEXT
);
```

热门排序规则（对齐 CocoLoop）：
- **总排行**：`COUNT(install_events)` 全量累计，时间衰减可后置。
- **近期最热**：最近 7 天安装数。
- **最新上传**：`updated_at` 倒序。

---

## 5. 云端 API 设计（Hono，与天枢 server 同栈）

```
GET  /api/catalog?type=skill&category=信息抓取&q=搜索&sort=popular|hot|new&page=1
     → { items: [{id,name,icon,description,author,installCount,safetyLevel,category}], total, page }
GET  /api/catalog/:id        → 完整详情（含 readme、safety、file_list、package_url、sha256）
GET  /api/articles?page=1    → 专题列表（标题+摘要+日期）
GET  /api/articles/:id       → 文章详情（Markdown）
GET  /api/popular?range=all|week|new&category=…  → 热门榜
GET  /api/stats              → 首页统计条（总量/平台数）
POST /api/installs  {item_id, client_id}   → 安装上报（幂等，客户端每次安装成功调一次）
POST /api/favorites {item_id, client_id}   → 收藏上报
── 管理端（简单 token 鉴权）──
POST /api/admin/items        → 发布/更新内容条目（含上传 zip/图标，multipart）
POST /api/admin/articles     → 发布/更新专题
DELETE /api/admin/items/:id  → 下架
GET  /api/admin/stats        → 后台概览
GET  /api/health             → 健康检查
```

**安全基线**（对齐 CocoLoop 的 CLS 认证思路，做基础版）：
- 每个包带 `package_sha256`，客户端安装前校验，防止篡改。
- 管理端写操作走 token（管理员口令），发布人可见可审计。
- 技能包安装前展示 `safety_level` 与权限声明（读取了哪些脚本、是否联网），用户确认后落地。
- 服务器侧对上传 zip 做白名单校验：仅允许 `SKILL.md`、`scripts/`、`references/`、`templates/`、`assets/` 等技能包结构，拒绝任意可执行文件逃逸。

---

## 6. 客户端接入方案（天枢内置）

### 6.1 新增前端页面（复用现有 MarketPage 骨架）

| 路由 | 页面 | 说明 |
|---|---|---|
| `/market` | MarketPage 改造 | 顶部 Hero 搜索 + 统计条；三板块：精选榜单（分类 tab）/ 精选专题 / 热门（排序 tab）—— 即 CocoLoop 首页结构 |
| `/market/popular` | PopularPage | 总排行/近期最热/最新上传 + 分类 tab |
| `/market/articles` | ArticlesPage | 专题列表（日期分组），可复用 MarkdownContent 渲染 |
| `/market/articles/:id` | ArticleDetailPage | 文章详情 |
| `/market/items/:type/:id` | ItemDetailPage | 详情：README 渲染（复用 `MarkdownContent`）、安全解读、文件列表、**一键安装**按钮 |

### 6.2 新增前端 API 层

`web/client/src/api/market.ts`：`fetchCatalog / fetchItem / fetchArticles / fetchPopular / reportInstall`。
API 基地址：默认同源（桌面端内置 server 反代或直连服务器），可配置——设置页加"市场服务器地址"项，支持自建/私有化。

### 6.3 安装链路（关键技术点）

```
用户点"安装"
  → 客户端 GET /api/catalog/:id 拿 package_url + sha256
  → 下载 zip → 校验 sha256 → 解压到临时目录
  → 校验结构（复用 skill-catalog 的 parseSkillFrontmatter / ensureInside 校验逻辑）
  → 落地：
      技能 → 写入 skillsRoot()/<category>/<id>/
      角色 → 校验后写入 character store（复用现有导入逻辑）
      MCP  → 写入 mcp 配置（复用 mcp 注册逻辑）
  → 刷新 /api/skills/packages 列表（前端重新 fetch）
  → POST /api/installs 上报
  → 提示安装成功 + 安全提示（第三方内容风险自担）
```

**与现有代码的对接点**（已核实可复用）：
- `web/server/src/routes/skills.ts`：`GET/POST /packages` 已支持创建；新增 `POST /api/skills/packages/import`（上传 zip 落地 + 注册），或由市场模块直接调用 `createSkillPackage`。
- `web/server/src/agent/skill-catalog.ts`：`parseSkillFrontmatter`、`ensureInside` 直接复用于包校验。
- `web/client/src/components/Chat/MarkdownContent.tsx`：README/文章渲染直接复用。
- `web/client/src/api/skills.ts`：安装后刷新列表复用。

### 6.4 降级策略

- 市场服务器不可达 → 市场页顶部显示"离线模式"，展示本地已安装列表 + 上次缓存的热门榜（localStorage 缓存 24h）。
- 安装失败（sha256 不符/结构非法）→ 明确报错，不写入任何文件，保留 zip 供用户自查。
- 默认同源直连；设置里可改服务器地址（适配以后私有化部署客户）。

---

## 7. 服务器部署方案（公司服务器 + 公网 IP）

### 7.1 组件

| 组件 | 选型 | 说明 |
|---|---|---|
| 应用服务 | Node 24 + Hono（与天枢同栈，代码可复用） | 独立进程，独立 SQLite 库 |
| 反向代理 | Caddy（推荐）或 Nginx | HTTPS 443 + 静态文件（zip/图标）+ 反向代理 API |
| 域名 | **强烈建议申请一个域名**（如 `hub.公司域名.cn`）做 A 记录到公网 IP | 原因见 7.3 |
| 存储 | 磁盘目录 `data/`（SQLite + uploads/） | 定时备份 |
| 进程守护 | pm2 或 systemd | 开机自启 + 崩溃重启 |
| 备份 | crontab 每日打包 `data/` 到备份目录/异地 | — |

### 7.2 部署步骤（概要）

1. 服务器安装 Node 24、Caddy（或 Nginx）。
2. `git clone` 市场服务代码（`market-hub/` 独立仓库或天枢仓库子目录）。
3. `npm ci && npm run build && pm2 start dist/index.js`（端口如 8787，仅本机监听）。
4. Caddyfile：
   ```
   hub.你的域名.cn {
       reverse_proxy 127.0.0.1:8787
       handle_path /files/* {
           root * /var/lib/market-hub/uploads
           file_server
       }
   }
   ```
5. 首次发布：用 `caddy` 自动申请 Let's Encrypt 证书（无需手动管证书）。
6. 管理端发布第一个技能包：打包技能目录 zip → 上传 → 校验 → 上架。

### 7.3 为什么需要域名（重要取舍）

- 公网 IP 直连可以跑，但 **HTTPS 证书必须要有**：
  - Electron 客户端 `fetch` 服务器、下载 zip，若走 http 明文，内容可被中间人篡改，sha256 校验也救不了（校验值本身可被替换）。
  - 浏览器端（Web 版天枢）跨域、混合内容（https 页面请求 http 接口）会被浏览器直接拦截。
- Let's Encrypt 不给纯 IP 发证书（免费渠道），所以**最低成本路径 = 注册一个域名**（几十元/年）→ DNS A 记录 → Caddy 自动签证书。
- 如果实在只有 IP：可用自签证书 + 客户端预置信任，但分发体验差、维护成本高，不建议。

### 7.4 客户端分发对接

天枢 desktop 已有 electron-updater 全套（`updater.ts` + `electron-builder.yml` 三端产物）。分发路径：

```
公司服务器 /var/www/update/
  ├─ latest.yml            ← electron-updater 检查更新入口
  ├─ TianShu-Setup-1.0.0-x64.exe
  ├─ TianShu-1.0.0-mac-x64.zip / latest-mac.yml
  └─ TianShu-1.0.0-linux-x64.AppImage / latest-linux.yml
```

- `electron-builder --publish` 或手动把产物拷到服务器目录。
- 桌面端 `updater.ts` 的更新源改为 `https://hub.你的域名.cn/update/`（当前是占位/本地）。
- **首版分发**：安装包手动分发（官网下载/网盘/群文件）；**后续版本**：自动差分更新，无需用户重装。
- Web 版：市场同源直连服务器即可（如需跨域，Caddy 加 CORS 头）。

---

## 8. 分阶段实施计划

| 阶段 | 内容 | 交付物 | 估时 |
|---|---|---|---|
| **P0 云端服务** | market-hub 独立服务：数据模型 + catalog/articles/popular API + 管理端 + 静态托管 | 可跑的服务 + 种子数据 | 2-3 天 |
| **P1 客户端对接** | `api/market.ts` + MarketPage 改造（三板块）+ 详情页 + 安装链路 + 设置项 | 市场页真实可用，可安装技能 | 3-4 天 |
| **P2 内容运营** | 第一批技能包打包上架（从现有内置技能挑 5-10 个）+ 专题文章 3-5 篇 + 分类体系定稿 | 上线内容 | 1-2 天 |
| **P3 部署上线** | 服务器部署 + 域名 + HTTPS + 备份 + 管理后台使用 | 生产环境 | 1 天 |
| **P4 分发打通** | electron-updater 指向服务器 + 首版安装包托管 + 更新验证 | 客户端分发闭环 | 1 天 |
| **P5 增强（可选）** | 安装统计飞轮、角色/MCP 上架、私有化部署开关、内容审核后台 | 进阶能力 | 按需 |

**建议启动顺序**：P0 → P1 → P3（域名/服务器可以现在就并行准备）→ P2 → P4。

---

## 9. 关键取舍与风险

| 决策点 | 推荐 | 理由 |
|---|---|---|
| 市场服务独立部署 vs 合并进天枢 server | **独立部署**（独立仓库/独立进程） | 客户端内置 server 是每台用户机器一份，绝不能让所有用户流量打到自己机器；云端市场必须独立在服务器 |
| SQLite vs PostgreSQL | SQLite（市场读多写少） | 与天枢同栈、零运维；量级到万级用户再迁 PG |
| 域名 vs 纯 IP | 域名 | HTTPS 证书是硬需求，Let's Encrypt 只认域名（见 7.3） |
| 技能包格式 | 复用天枢现有包格式（SKILL.md frontmatter + scripts/references/…） | 安装链路零转换，直接复用 skill-catalog |
| 安全认证 | 基础版：sha256 + 结构白名单 + 等级徽章 | CocoLoop 的 CLS 是人工审核体系，先做机器校验，人工审核后续补 |
| 客户端统计 | 匿名 client_id（不收集用户数据，只计数） | 合规、轻量 |

**风险清单**
1. **技能包恶意代码**：安装第三方技能等于执行其脚本。缓解：安全等级展示 + 安装前确认 + sha256 溯源；后续可加"沙箱试运行"。
2. **服务器流量**：zip 下载走静态托管 + Caddy 缓存，避免打到 Node 进程；带宽不够可上 CDN。
3. **公网暴露面**：管理端接口必须 token 鉴权 + 限流；服务器防火墙只开 80/443。
4. **分发安全**：electron-updater 需配 HTTPS + 建议签名（Windows 代码签名证书、macOS 公证），否则系统拦截/告警，用户信任度低。

---

## 10. 一页总结

- **照抄什么**：CocoLoop 的三板块结构（精选榜单/专题/热门）、分类 tab、卡片信息密度、详情页"使用说明+安全解读+文件+一键安装"的布局、安装即统计。
- **差异化**：天枢市场不止技能，还承载角色与 MCP；完全内置客户端，离线可用。
- **怎么落地**：公司服务器跑一个独立 Hono 市场服务（SQLite + 静态文件），客户端 MarketPage 从假数据改为真 API，安装动作复用现有 skill-catalog 链路；申请域名 + Caddy 一键 HTTPS；electron-updater 指向服务器完成分发闭环。
- **最先做什么**：P0 云端服务（2-3 天），同时并行申请域名。
