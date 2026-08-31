# 天枢市场 · 项目交接文档（Handover）

> 本文档写给**对本项目完全不知前因后果的新会话**。请从头读一遍，再动手。
> 最后更新：2026-08-30

---

## 0. 一句话定位

**天枢市场**是一个资产（角色/技能/皮肤/主题/MCP/工具/知识库/图标包/提供商）的**分享与获取平台**。当前已完成「纯静态 demo → 真实后端（Node.js + Express + 内置 SQLite）」的改造，核心闭环已跑通；**下一步是把它嵌入天枢客户端**（本地登录、一键上传/下载到本地路径），但**该步尚未写代码，只完成了方案设计 + 市场端一个接口**。

项目根目录：`C:\Users\dmql\Desktop\tianshu\TianShu\天枢市场\market`（下称 `market/`）
天枢客户端源码：`C:\Users\dmql\Desktop\tianshu\TianShu\dev`（下称 `dev/`，**本交接主战场在 market，dev 只在"客户端嵌入"阶段才动**）

---

## 1. 最终目标（为什么做这个项目）

天枢是一个桌面 AI 客户端（Electron，本地 `<dataDir>` 存放角色/技能/皮肤等**本地资产**）。天枢需要有一个**共享资产市场**，让用户：
1. 把本地已经配置好的角色（**连同它关联的技能/工具/知识库/皮肤**）一键发布到市场；
2. 从市场**一键下载**资产，**直接落盘到客户端本地对应路径**（`<dataDir>/characters/`、`skills/`、`skin/` 等），下载即用；
3. 因此**客户端需要增加「市场账号登录」**。

**用户已拍板的两个决策**：
- 市场账号配置：**先写死、落在本地文件**（客户端本地 server 读取一个配置文件得到云端市场 URL/凭据），暂不做 UI 设置项；
- **客户端侧代码先不写**（第 2 点）。所以当前阶段**只做交接文档 + 市场端已就绪的接口**，天枢 dev 项目的代码改动待后续会话接手。

---

## 2. 架构总览

```
┌───────────── 天枢客户端（Electron + 本地 server，端口约 7878 附近）──────────────┐
│  本地资产：<dataDir>/characters/<id>/character.json + soul.md + visual/            │
│            <dataDir>/skills/<cat>/<id>/   <dataDir>/skin/<id>/  ...                 │
│  【未实现】MarketPage（客户端市场页）+ 市场账号登录 + 一键导出/安装到本地             │
└──────────────────────────────────────────────────────────────────────────┘
                        │  上传 .tianshu JSON 包 / 下载包
┌───────────── 云端市场（本机开发 7878；部署到 Ubuntu 服务器）───────────────────────┐
│  Node.js + Express + node:sqlite（零原生编译）+ multer（任意文件上传）               │
│  assets 表 + detail_data（角色 soul/tools/skills/... JSON）+ uploads/*.tianshu      │
└──────────────────────────────────────────────────────────────────────────┘
```

- **数据模型核心**：`assets` 表存资产元数据；`detail_data`（TEXT JSON）存「类型专属面板数据」；`uploads/` 存资产文件包；`related_assets` 表存资产间关联。
- 市场 `install` **目前只记录安装关系**（user_installs 表 + 下载计数），**不会下载文件**——「下载到本地」是客户端侧要做的（拉 `/api/assets/:id/file` 包 + 解包落盘），市场端无需改。

---

## 3. 已经完成的内容（market/ 目录）

### 3.1 后端（market/server/src/）
| 文件 | 职责 |
|---|---|
| `config.js` | 端口默认 7878；**已修 bug**：拒绝 `PORT=0` 环境变量污染（仅收正整数） |
| `db.js` | 建表 + 迁移 + `DB_PATH` 处理。表：users / assets / user_installs / user_favs / related_assets / categories。`assets` 有 `detail_data TEXT DEFAULT '{}'` 列 |
| `auth.js` | JWT 鉴权：`attachUser` / `requireAuth` / `requireAdmin` / `signToken`（bcryptjs 加密密码） |
| `assetHelper.js` | `rowToAsset`（把行 → 前端对象，展开 `detail_data` 为顶层字段如 `characterData`、附 `rel`）、`queryAssets`（列表查询：分类/搜索/排序，只出 live） |
| `routes.js` | 全部业务 API（详见 §5） |
| `index.js` | Express 入口：托管前端静态文件（同源无 CORS）+ API 路由 + 错误处理 |
| `seed.js` | 种子数据：17 资产 / 24 关联 / 10 分类 / 2 用户；`--reset` 支持；以 index.html 资产 id 为准，详情页类型面板数据合进 detail_data |

### 3.2 前端（market/ 根目录 + js/ + pages/）
前端是**纯静态 HTML + Tailwind CDN + 原生 JS**，通过 `js/api.js`（`window.MarketAPI`）访问后端。

- `js/api.js`（111 行）：统一请求封装 + token 管理（localStorage: `tianshu_token`）、登录注册、资产 CRUD、安装/收藏、上传/编辑、管理。含 `importLocal`（§5.9）。
- 页面（9 个，全部已接真实 API）：
  - `index.html` 市场首页（列表/搜索/排序/安装、分类导航、`?cat=` 定位分类）
  - `pages/asset-detail.html` 详情（API 加载 + 类型面板 character/skill/theme/mcp/provider/iconpack + 更新日志）
  - `pages/login.html` 登录/注册
  - `pages/downloads.html` / `pages/favorites.html` / `pages/uploads.html` 我的下载/收藏/上传
  - `pages/upload.html` 上传（类型专属字段表单，收集 `detail_data`，见 §6）
  - `pages/edit.html` 编辑（API 加载 + 更新）
  - `pages/admin.html` 管理后台（权限守卫 + 看板统计 + 审核）

### 3.3 部署（market/server/deploy/）
- `deploy.sh`：Ubuntu 22.04 一键部署（Node≥22.5 安装 / npm 依赖 / seed / PM2 / Nginx 反代 / 防火墙 / 健康检查）。需先手动 `scp` 上传整个 market 目录到 `/opt/tianshu-market` 再执行。`bash -n` 语法通过。
- `DEPLOY.md`：完整部署/运维/备份/安全/FAQ 文档。

---

## 4. 目前进度（进行到什么程度）

- ✅ 后端全部 API + 种子 + 部署，已 curl 全链路验证通过。
- ✅ 前端 9 页全部接真实 API，语法校验通过，服务托管下全部 HTTP 200。
- ✅ 上传页「基于详情页重建」：类型专属字段（角色/技能/主题/MCP/图标包/工具/提供商 + 更新日志）收集进 `detail_data`，详情页真实渲染。
- ✅ 侧边栏统一（子页面也有完整分类导航）；后台入口 + 权限守卫。
- ✅ **市场端「本地导入」接口 `POST /api/assets/import-local`** 已实现并端到端验证（见 §5.9、§7）。
- ⏳ **未做**：天枢客户端嵌入（登录 / 一键导出上传 / 一键下载落盘）——**用户明确：先不写代码**，只完成了方案设计（见 §8）。

---

## 5. 后端 API 清单（market/server/src/routes.js）

鉴权：`requireAuth`=需登录 JWT；`requireAdmin`=需管理员。前缀 `/api`。

| 方法 & 路径 | 鉴权 | 说明 |
|---|---|---|
| GET `/categories` | 公开 | 分类列表（含每类 live 计数） |
| GET `/assets?cat&q&sort` | 公开(可带token) | 资产列表，只出 live |
| GET `/assets/:id` | 公开 | 资产详情（含 rel + 展开 detail_data） |
| GET `/assets/:id/file` | 公开 | **下载资产文件包**（`res.download`） |
| POST `/assets/:id/install` | 登录 | 安装（记关系+计下载数） |
| DELETE `/assets/:id/install` | 登录 | 卸载 |
| POST `/assets/:id/fav` / DELETE `/assets/:id/fav` | 登录 | 收藏/取消 |
| POST `/auth/register` | 公开 | 注册 |
| POST `/auth/login` | 公开 | 登录（返回 token） |
| GET `/auth/me` | 登录 | 当前用户信息（含 role/installed/installed_assets/fav_ids） |
| GET `/me/installs` / `/me/favs` / `/me/uploads` | 登录 | 我的下载/收藏/上传 |
| POST `/assets/upload` | 登录 | 手动上传（multipart file + 表单，`detail_data` 可选） |
| **POST `/assets/import-local`** | 登录 | **本地包导入**（§5.9，市场端新能力） |
| POST `/assets/:id/update` | 作者/管理员 | 编辑重提交（multipart 可选文件） |
| DELETE `/assets/:id` | 作者/管理员 | 下架/删除 |
| GET `/admin/stats` | 管理员 | 看板统计（assets/users/downloads/review…） |
| GET `/admin/review` | 管理员 | 待审列表 |
| POST `/admin/review/:id` | 管理员 | 审核（action: approve/reject, 可选 note） |

默认账号：
- 管理员 `admin@tianshu.dev` / `admin123`
- 普通用户 `user@tianshu.dev` / `user123`
- 测试用户 `test_local@tianshu.dev` / `test123`

---

## 5.9 ⭐ 关键已就绪接口：`POST /api/assets/import-local`（客户端上传用）

市场端**已经做好**、专门给"客户端一键上传"用的接口。接收一个 **`.tianshu` JSON 包**（由天枢客户端打包），自动解析并入库，原始包保留供下载。

**包格式**（客户端导出时必须按此结构）：
```jsonc
{
  "version": 1,
  "meta": { "name": "塔罗占卜师", "cat": "character", "ver": "1.2.0",
            "tags": ["占卜","神秘"], "desc": "从客户端导出的角色" },
  "detail": {
    // 类型面板数据。可直接用顶层键（characterData/skillData/themeData/mcpData/iconpackData/toolData/providerData/changelog），
    // 也可给裸字段（如 soul/tools/skills/maxSteps/strategy），后端会按 meta.cat 自动包裹成 characterData 等。
    "characterData": { "soul": "...", "tools": [...], "skills": [...], "maxSteps": 999, "strategy": "Auto Approve", "visual": {...} }
  },
  "files": {
    // 整个资产目录，相对路径 → base64。客户端下载后据此解包落盘到 <dataDir>
    "characters/taro/character.json": "BASE64...",
    "characters/taro/soul.md": "BASE64...",
    "skills/mysticism-tarot-divination/SKILL.md": "BASE64...",
    "skin/taro/skin.json": "BASE64..."
  }
}
```
**行为**：meta.name/cat 必填；由 detail 自动生成 `detail_data`；入库 status='review'；文件包存 `server/uploads/<id>.tianshu`；下载走 `/api/assets/:id/file` 返回该包。

---

## 6. 类型面板字段约定（上传页 ↔ 详情页必须对齐）

创建资产（上传页）收集的 `detail_data` 键，与详情页渲染函数一一对应：

| cat | detail_data 键 | 关键字段 |
|---|---|---|
| character | `characterData` | soul / tools[] / skills[] / maxSteps / strategy / visual{avatar,portrait} |
| skill | `skillData` | children[{name,description}] / files[] |
| theme | `themeData` | appearance / colors{**12 token**：primary,background,surface,surfaceLight,text,textSecondary,border,borderLight,success,warning,error,info} / artwork |
| mcp | `mcpData` | command / args[] / capabilities[] / tools[] / status |
| iconpack | `iconpackData` | slotCount / previewIcons[] / slots{} |
| tool | `toolData` | format / size |
| provider | `providerData` | baseUrl / models[] / fields[{label,required,type,placeholder}] |
| kb / skin | （仅说明） | 无面板字段 |
| （通用） | `changelog` | [{ver, desc}] 更新日志 |

详情页 `asset-detail.html` 里 `rowToAsset` 已把 `detail_data` 展开为顶层字段（`a.characterData` 等）。前端页面已用 `esc()` 做 XSS 转义。

---

## 7. 验证记录（这些都已跑通，别再重跑/另起炉灶）

> **验证失败的教训（重要）**：**不要重复尝试下面这些"已验证失败/已确认"的路径**——
> - ❌ **better-sqlite3**：Windows 无 VS 编译失败 → **已弃用**，改用 Node 内置 `node:sqlite`。部署要求 **Node ≥ 22.5**（引擎已写 `>=22.5`）。
> - ❌ `PORT=0` 环境变量会污染端口 → config.js 已修：仅接受正整数。
> - ❌ admin/stats 曾用双引号包 SQL 字符串报错 → 已改单引号。

**市场端已通过的端到端验证**（2026-08-30）：
1. 匿名浏览 / 注册 / 登录 / myInstalls / myFavs / myUploads 全通。
2. 上传 `.md` / `.sh` / `.png` 任意类型 → 管理员审核 → 下载内容正确。
3. 编辑重提交 / 重启服务后**数据持久化**（assets 27 / users 5 / installs 5 / favs 1）。
4. 类型面板字段落库：角色/主题/MCP 的 detail_data 均正确；theme 12 token；provider fields。
5. 更新日志 changelog 落库 + 详情页真实渲染（无则占位）。
6. **`import-local` 端到端**：客户端包（角色+技能+皮肤 base64）→ import-local → 自动生 characterData → 审核上架 → 下载包 4 个文件完整（id=27，资产名「塔罗占卜师」，当前为 live）。
7. 后台权限：未登录 401 / 普通用户 403 / 管理员 200。

---

## 8. 接下来要做什么（未完成部分）

### 8.1 市场端（market/）——已基本就绪，只剩收尾
- ⏳（可选）管理后台「审核」按钮接真实 `/api/admin/review` 操作（当前看板统计已接真，按钮还是静态示例）。

### 8.2 天枢客户端（dev/）——★ 主战场，按用户要求先不写代码 ★
用户已确认：**先写死配置落在本地文件**（云端市场 URL + 凭据），**客户端代码下一会话再写**。接 handover 者需在 dev 项目做：

1. **登录**：市场账号登录 → 拿 JWT token → 存 `<dataDir>/config/market-token.json`（本地持久化，重启不丢）。客户端本地 server 新增市场代理路由 `/api/market/*`。
2. **一键导出上传**：读 `<dataDir>/characters/<id>/character.json`（含 soul/tools/skills/skinId/maxSteps/strategy）+ 关联技能 `skills/<cat>/<id>/` + 皮肤 `skin/<id>/` → 打 `.tianshu` JSON 包（§5.9 格式）→ POST 市场 `/api/assets/import-local`。
   - **注意**：客户端 `character.json` 里 `skills` 用 `"mysticism-tarot-divination"` 这种 id、`skinId` 指向皮肤，打包时要把这些关联文件一并纳入 `pkg.files`。
3. **一键下载落盘**：拉市场 `/api/assets/:id/file`（.tianshu 包）→ 解包 → 按 `files` 键的相对路径写回 `<dataDir>` 对应子目录 → 客户端立即可用。
4. **MarketPage.tsx**：目前是占位符（"市场建设中"），需重做为「登录对话框 + iframe 浏览市场（URL 来自本地配置）+ 发布/安装按钮」。

### 8.3 技术约束提醒
- 节点：`node:sqlite`，Node ≥ 22.5；**不要**引入 better-sqlite3 这类需原生编译的依赖。
- .tianshu 包用 JSON base64（Node 无内置 zip 解压，避免加依赖；若后续要 zip 可引入纯 JS 解压库 yauzl/jszip）。
- 跨源：客户端本地 server 调云端市场是跨源，市场端已 `cors` 放开；token 用 `Authorization: Bearer`。

---

## 9. 如何启动 / 验证（交接后第一步就该这么做）

### 启动市场后端
```bash
cd "C:\Users\dmql\Desktop\tianshu\TianShu\天枢市场\market\server"
node src/index.js        # 端口 7878，日志 server.log
# 重置种子数据：node src/seed.js --reset
```

### 快速健康检查
```bash
curl http://localhost:7878/api/health        # 期望 {"ok":true,...}
curl http://localhost:7878/api/categories    # 分类
```

### 前端
打开 `http://localhost:7878/`（服务托管静态，同源无 CORS）。

### 常用路径
- 数据库：`market/server/data/market.db`（单文件，SQLite）
- 资产文件包：`market/server/uploads/`
- 测试账号见 §5 末尾。

---

## 10. 常见坑 & 决策记录（新会话必读）

- **技术选型**：数据库用 `node:sqlite`（DatabaseSync）——零原生编译、Windows 友好、部署简单。**别换成 better-sqlite3 / 别加数据库服务**。
- **前端**：纯静态 HTML+原生 JS，无框架无构建；Tailwind 走 CDN；**别引入 React/Vue**。
- **detail_data 是核心**：一切类型面板都从它来；改上传/详情前先读 `routes.js` 的 `import-local`/`upload` 和 `rowToAsset`。
- **同源无 CORS**：dev 本地前端用 `localhost:7878` 直接访问；客户端嵌入走跨源时市场已配 cors。
- **配置写死位置**：下一步在客户端做市场 URL/凭据配置时，约定落 `dev` 的 `<dataDir>/config/` 下（与现有 providers/themes 同目录策略）。
- **搜索中文**：curl 在 Windows Git Bash 下中文需 `--data-urlencode`，浏览器无此问题。
- **不要重复踩坑**：见 §7「验证失败的教训」。

---

## 11. 交接人想对新会话说的话

1. 先跑 §9 启动 + 健康检查，再读 §5/§6，确认服务活着、接口在，再动代码。
2. 市场端核心已收敛、接口已验证，短期**不建议大改市场后端**。
3. 真正的下一步价值在**客户端嵌入**（§8.2）——这是用户最关心的：本地登录 + 一键上传/下载。但**用户明确要求先不写客户端代码**，所以接手者应当**先做方案细化/技术预研**（如确认市场 URL 配置文件的读写位置、.tianshu 打包的完整字段映射），并在动手前再次与用户确认。
4. 任何破坏性操作（`--reset` 清库、删 uploads、改 schema）**务必先备份 `server/data/market.db` 和 `server/uploads/`**，并说明影响范围。
