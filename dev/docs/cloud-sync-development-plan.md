# 天枢云同步（Tianshu Cloud Sync）开发计划

> 目标：天枢登录「天枢云」账号后，可同步 `dataDir` 下的内容（角色/技能/服务提供商/主题/提示词/配置），实现多机一致、换机迁移。
> **部署策略：先在本机把 cloud-server 跑起来开发联调，后续原样搬到云服务器。**
> 前置关系：`docs/mobile-cloud-architecture-plan.md` 已定稿「统一账号中心 /auth」——**云同步直接复用它，不另造账号体系**，新增 `/sync` 模块即可。

---

## 0. 结论速览（TL;DR）

1. **复用已有架构**：账号中心 `/auth`（register/login/refresh/me）照搬 mobile-cloud 方案；云同步是 cloud-server 上的第三个模块 `/sync`，与前两个模块同进程、同库、同 JWT。
2. **同步模型：文件级 manifest + 内容寻址 blob 存储**。客户端扫描 dataDir 生成清单（相对路径 + hash + mtime + size），与服务端清单 diff 后增量上传/下载。单文件整体覆盖（last-write-wins），不做块级合并。
3. **客户端改造集中在桌面端**：Electron main 新增 `cloud-sync` 模块（扫描/diff/上传/下载/调度），设置页新增「天枢云」面板（登录 + 「立即同步」按钮 + 状态）。web/server 基本不动。
4. **同步范围显式列白名单**：characters/skills/providers/prompts/themes/iconpacks/config/config.json 元数据；**排除** sessions.db（另立二期）、media 大文件（二期可选）、tool-output、日志与临时文件。
5. **里程碑**：M0 cloud-server 骨架(本地) → M1 账号中心 → M2 /sync API + 本地 CLI 联调 → M3 桌面端集成 → M4 冲突/断点/节流打磨 → M5 迁云上线。本地阶段全部可用 `localhost:8787` 验收，迁云只换 base URL。
6. **产品红线（用户定稿）**：
   - **云同步全手动 + 按需逐项**：没有任何后台自动同步（无定时、无文件监听触发）。同步入口都是显式按钮：
     | 同步对象 | 上传入口 | 下载入口 |
     |---|---|---|
     | 单个角色 | 角色详情页头部「同步到云端」按钮 | 角色分页「拉取云端角色」按钮 |
     | 单个技能包 | 技能卡片「同步到云端」按钮 | 技能分页「拉取云端技能」按钮 |
     | 配置目录 | 设置页「上传配置到云端」按钮 | 设置页「从云端下载配置」按钮 |
   - **没有会话同步**（用户定稿取消）：sessions.db 完全不参与云同步，二期也不再考虑。

---

## 1. 现状与约束（已核实）

### 1.1 dataDir 实际内容（本机 `%APPDATA%/tianshu-desktop/data`）

| 目录/文件 | 内容 | 同步价值 | 体积/风险 | 期次 |
|---|---|---|---|---|
| `characters/` | 角色（每人一目录，含人格/技能绑定） | ★★★ 核心资产 | 小 | P0 |
| `skills/` | 技能包 | ★★★ 核心资产 | 中（可能含资源文件） | P0 |
| `providers/` | 模型服务适配（`providers.json` 在 `config/`） | ★★★ 配好很费时 | 小 | P0 |
| `prompts/` | 系统提示词 | ★★ | 小 | P0 |
| `themes/` | 自定义主题 | ★★ | 小 | P0 |
| `config/` | providers.json / theme.json / model-usage.json | ★★（model-usage 属运行数据） | 小 | P0（白名单单文件） |
| `mcpservers/` | MCP 配置 | ★★ | 小 | P1 |
| `media/` | 会话媒体附件 | ★（大、与 session 相关） | **大** | P2 可选 |
| `iconpacks/` | 图标包 | ★ | 中 | P1 |
| `sessions.db`(+wal/shm) | 会话/消息/记忆（SQLite） | ★★★ 但**结构不同** | 大、写入频繁 | **P0 不同步，二期单做** |
| `tool-output/`、日志、`.tmp` | 运行时产物 | ✗ | — | 永不同步 |

关键事实：
- `dataDir` 路径由 `web/server/src/config.ts` `getDataDir()` 决定（76 处调用），客户端各模块都按目录/文件读写——**同步的单位天然就是「文件」**，不需要动 server 的读写逻辑。
- `config.json`（server 侧，含 dataDir 指针）**绝不同步**——dataDir 是每台机器本地路径，同步它会指向不存在的目录。
- 天枢目前无任何登录/账号逻辑；loopback-only。

### 1.2 已有可复用设计（mobile-cloud 方案）

- `/auth` 账号中心 API 形态、JWT 签发（`jose`，access 30min / refresh 30d）、scrypt 密码、限流——直接照搬。
- 桌面端 `desktop/src/remote/`（cloud-auth + cloud-tunnel）的目录位置、token 持久化（`safeStorage`）、契约同步（contracts 唯一权威 + hash 校验）——沿用同一套结构，cloud-sync 作为并列子模块。
- 部署形态：cloud-server 单进程（Hono + node:sqlite + jose）挂官网 Nginx 子路径。

---

## 2. 目标架构

### 2.1 拓扑

```
天枢桌面端 (Electron)                          cloud-server（本机开发 → 后迁云）
├─ 本地 server 127.0.0.1:3456（不动）          ├─ /auth    统一账号中心（已有方案，P0 实现）
└─ desktop/src/cloud/                          ├─ /sync    云同步（本期新增）
   ├─ cloud-auth.ts    登录/刷新/token存储      │   ├─ manifest 清单比对
   ├─ cloud-sync/                              │   ├─ blob 内容寻址存储
   │  ├─ scanner.ts    扫描 dataDir → manifest │   └─ 设备/同步状态
   │  ├─ differ.ts     本地↔远端 diff           └─ /remote  远程中继（mobile-cloud M2+，互不阻塞）
   │  ├─ uploader.ts   分块/重试上传
   │  ├─ downloader.ts 拉取+原子落盘
   │  └─ scheduler.ts  触发/节流/退避
   └─ contracts-sync/  契约副本（hash 校验）
设置页「天枢云」面板（web/client features/cloud）
```

### 2.2 同步语义（核心设计，先定死再写码）

- **单位**：文件。路径 = dataDir 相对路径（POSIX 风格，跨平台）。
- **冲突策略：last-write-wins（按文件）**。两端都改了同一文件 → 以 `updated_at`（服务端收到时间）+ 本地 mtime 较新者胜；被覆盖方文件移入服务端 `.conflicts/<deviceId>/<ts>/` 保留 30 天，可找回，不弹窗打断（P0 简化；P1 再考虑角色级合并）。
- **删除**：用墓碑（tombstone）记录 `deleted_at`，防止「旧机器把删掉的东西又传回来」。墓碑保留 90 天。
- **一致性**：单文件原子（服务端 blob 先落、manifest 后提交；客户端下载到临时文件再 rename）。
- **触发**：**全手动**（用户定稿）。同步只发生在：① 用户点设置页「立即同步」按钮；② 会话右键「同步到云端」时该会话快照单独上传。**没有**文件监听、没有定时兜底、登录后也不自动对账——只提示「有 N 个本地变更未同步」。这样 agent 运行中不可能被同步写坏文件，也省掉整套防抖/退避复杂度。
- **并发**：同一账号多设备允许同时在线；服务端按文件加轻量锁（同 hash 幂等，冲突走 LWW）。

### 2.3 同步范围白名单（P0）

```
包含：
  characters/**            skills/**
  providers/**             prompts/**
  themes/**                iconpacks/**
  config/providers.json    config/theme.json
  config/iconpack.json     mcpservers/**（P1）

排除（硬编码 + 允许用户追加）：
  sessions.db*             tool-output/**
  media/**（P2 再议）       *.tmp / *.log / *.bak-*
  config/model-usage.json  任何 .git / node_modules
```

> 白名单放**契约层**（contracts/sync-scope.ts），两端共用一份，hash 校验防漂移。

---

## 3. 云端设计（cloud-server `/sync` 模块）

### 3.1 数据模型（SQLite，与 /auth 同库）

```sql
-- blob 内容寻址存储：内容只存一份（同 hash 去重）
blobs (
  hash TEXT PRIMARY KEY,          -- sha256
  size INTEGER, size_compressed INTEGER,
  created_at INTEGER
)
-- blob 实体落盘：<data>/blobs/<hash前2>/<hash>（zstd/gzip 可选，P0 直接原样）

sync_files (                     -- 每账号当前「权威清单」
  user_id TEXT, path TEXT,       -- 相对路径，POSIX 风格
  hash TEXT, size INTEGER,       -- 引用 blobs.hash
  origin_device TEXT,            -- 最后写入设备
  updated_at INTEGER,            -- 服务端时间 = LWW 依据
  deleted_at INTEGER,            -- 墓碑（NULL=存在）
  PRIMARY KEY (user_id, path)
)

sync_devices (
  id TEXT PRIMARY KEY, user_id TEXT, name TEXT, os TEXT,
  machine_id TEXT UNIQUE, last_sync_at INTEGER, created_at INTEGER
)

sync_events (                    -- 审计/调试：每次上传下载各一行（可定期清理）
  id INTEGER PK, user_id, device_id, path, action, hash, at INTEGER
)
```

### 3.2 REST API（全部 Bearer JWT；`/sync` 前缀）

```
POST /sync/devices/register        登录设备，换 deviceToken（后续同步请求都带）
GET  /sync/manifest                当前权威清单（含墓碑，支持 ?since= 增量）
POST /sync/manifest/commit         提交一批变更（上传方申报：upsert/delete + hash）
GET  /sync/blob/:hash              下载 blob（校验属主；304/404）
POST /sync/begin-upload            申报要上传的 hash+size → 返回缺哪些（去重）
PUT  /sync/blob/:hash              上传 blob 内容（流式，限单文件 50MB）
GET  /sync/conflicts               列出冲突备份
GET  /sync/status                  配额用量（文件数/总字节）+ 最近事件
```

流程（一次同步回合）：

```
client                                   server
  │ GET /sync/manifest?since=<lastCursor>  │
  │◀──────── 权威清单（或增量） ────────────│
  │ 本地 diff → 分三类：本地新/改、远端新/改、冲突
  │ POST /sync/begin-upload {hashes}       │
  │◀──── 返回服务端缺失的 hash 列表 ────────│
  │ PUT /sync/blob/:hash × N（并发 3）      │
  │ POST /sync/manifest/commit {ops}       │  ← 服务端裁决 LWW，返回最终清单段
  │◀──────── commit 结果（胜/负/冲突） ─────│
  │ 下载远端胜出文件 → 临时文件 → rename    │
```

### 3.3 服务端要点

- 鉴权：JWT `sub` = user；deviceToken 绑定设备，`X-Device-Id` 头标识来源。
- 配额：P0 每账号 500MB / 5000 文件（超了 413 + 明确错误码）。
- 单文件上限 50MB；路径校验（拒绝 `..`、绝对路径、白名单外路径）。
- blob 去重天然防重复上传；上传限速不做（自用规模）。

### 3.4 实体级同步（角色 / 技能包 / 配置目录：按需逐个，文件通道）

> 会话同步已取消（用户定稿）：无 sync_sessions 表、无会话快照 API、SessionPanel 零改动。

**语义**：与 §2.2 的文件通道同一套 manifest/blob 机制，但**不扫全库**——每次只同步「用户指定的那一个实体」涉及的文件子树：

| 实体 | 云端 key（sync_files.path 前缀） | 本地来源 |
|---|---|---|
| 角色 `<charId>` | `characters/<charId>/**` | `dataDir/characters/<charId>/`（含 personality.md/memory.md/视觉资产等，server 端 `characterDir()` 权威定义） |
| 技能包 `<category>/<pkgId>` | `skills/<category>/<pkgId>/**` | `dataDir/skills/`（同上，`findSkillPackage()` 既有目录约定） |
| 配置 | `config/**` | `dataDir/config/`（providers.json / theme.json / iconpack.json 等；**仍排除 model-usage.json** 这类运行数据） |

**REST API**（复用 §3.2 的 begin-upload / PUT blob / commit，只增加以下端点）：

```
GET  /sync/entities                 实体级云端索引（类型/id/文件数/字节/同步时间/来源设备）
POST /sync/entities/:type/:id/push  声明推送实体 → 服务端返回该实体下需要的 blob 缺口 → 客户端补传 → commit（同 §3.2 流程，scope 限定该实体前缀）
GET  /sync/entities/:type/:id/pull  拉取该实体全部文件的 manifest + blob 下载
DELETE /sync/entities/:type/:id     取消云端同步（该前缀全部写墓碑）
```

- `:type` ∈ `character | skill-package | config`；服务端按**前缀校验**（白名单 + 防路径穿越），非法前缀 400。
- 推送前照常把将被覆盖的本地文件备份到 `.sync-backup/`；角色整目录可能含二进制视觉资产 → 同样走 blob 通道（单文件 50MB 上限内）。
- **拉取落到本机即生效**：角色/技能的 store 都是「读 dataDir 文件 + 内存缓存」，P0 在客户端拉取完成后调用本地 server 的刷新（或提示用户刷新页面）；P1 给 server 加一个 `POST /api/content/reload` 主动失效缓存。

**云端索引**（`sync_files` 天然支持——按 path 前缀聚合即得实体索引，无需新表）：

```
GET /sync/entities 返回形如：
[{ type:'character', id:'coder', fileCount:12, bytes:34521, syncedAt:…, originDevice:'pc-home' },
 { type:'skill-package', id:'tianshu/agent-reach', … },
 { type:'config', id:'-', … }]
```

**客户端 UI 落点**（均已核实现有代码结构）：

| 页面 | 现有结构 | 新增 |
|---|---|---|
| 角色分页 | `CharactersPage.tsx` 左侧栏头部 `char-side-head`（标题+「+新建」按钮） | 头部加「拉取云端角色」按钮；`CharacterDetailPage.tsx` 头部操作区加「同步到云端」按钮 + 云朵已同步标记 |
| 技能分页 | `views/SkillView.tsx` 页头 `page-header`（标题+计数+「+新建技能包」） | 页头加「拉取云端技能」按钮；每张 `skill-card` 的 `skill-foot` 加「同步到云端」按钮 + 云朵标记 |
| 配置路径 | `SettingsPage.tsx`「配置路径」行（选择目录/刷新/打开配置文件夹按钮组） | 加「上传配置到云端」「从云端下载配置」两个 `btn` 按钮 + 上次同步时间 |

**冲突与覆盖规则（LWW，按文件）**：

- **push**：本地整实体子树与云端比对，只传有差异的文件；云端同路径更新时间更新 → 该文件走 LWW（云端胜出时 push 结果里返回冲突清单，UI 提示「N 个文件云端较新，已保留云端版本」）。
- **pull（拉取）**：明确语义 = **云端覆盖本地**（用户主动要求以下载为准）。拉取前把将被覆盖的本地文件备份到 `.sync-backup/`。拉取角色/技能时若本地不存在该 id → 直接落地为新角色/技能包。
- **config 特例**：providers.json 含 API Key 等敏感信息 → 端侧加密可后置（P1），P0 明示「配置明文上云」；从云端下载配置会覆盖本地 providers.json，下载前备份 + 提示需刷新生效。

### 3.5 云同步 UI 汇总

---


## 4. 天枢客户端改造

### 4.1 新增 `desktop/src/cloud/`（Electron main 进程）

| 文件 | 职责 |
|---|---|
| `cloud-auth.ts` | 登录/刷新/登出；token 存 `safeStorage`（与 mobile-cloud 方案共用设计） |
| `cloud-sync/scanner.ts` | 按白名单扫 dataDir → `FileEntry[] {path, hash, size, mtime}`；sha256 流式计算；排除规则生效 |
| `cloud-sync/differ.ts` | 本地清单 vs 远端清单 → 操作集（含墓碑理解） |
| `cloud-sync/uploader.ts` / `downloader.ts` | 分批并发、失败重试（指数退避）、下载临时文件+原子替换；**替换前把被覆盖文件备份到 dataDir 同步备份目录** |
| `cloud-sync/scheduler.ts` | 纯手动触发入口（按钮/右键菜单调用），状态机（idle/syncing/error/offline）向上报告；**不做任何自动触发** |
| `index.ts` | 生命周期（app 启动初始化、退出前尽力 flush） |

**安全护栏**：
- 下载替换只允许落在 dataDir 白名单路径内（path resolve 后前缀校验，防路径穿越）。
- 「同步把本地改坏」的退路：每次同步回合开始前，把将被覆盖/删除的本地文件先复制到 `<dataDir>/.sync-backup/<回合id>/`，保留最近 5 个回合。
- 首次在「新机器」登录时默认**只下载不上传**（`firstSyncMode=download`），避免空目录把云端清空——这是最容易出事故的点，P0 必须做。

### 4.2 改动既有文件（最小化）

- `desktop/src/main.ts`：装配 cloud 模块 + IPC handlers。
- `desktop/src/preload.ts`、`shared/desktop-contract.ts`：暴露 `cloud:login/logout/syncNow/getState/setEnabled` 等。
- `web/client`：设置页新增「天枢云」面板（`src/features/cloud/`）：登录表单、「立即同步」按钮、状态、冲突提示入口。**同步全手动，无自动开关**（用户定稿）。

### 4.3 云同步 UI（改动点，用户定稿）

- `web/client/src/pages/CharactersPage.tsx`：左侧栏头部 `char-side-head` 加「拉取云端角色」按钮 → 弹出云端角色列表（名称/文件数/同步时间/来源设备）→ 选择后 pull 落地（本地已存在则提示将覆盖 + 备份）。
- `web/client/src/pages/CharacterDetailPage.tsx`：头部操作区（启用/预览动画/绑定皮肤/删除角色旁）加「同步到云端」按钮 + 云朵已同步标记。
- `web/client/src/views/SkillView.tsx`：页头 `page-header` 加「拉取云端技能」按钮（同角色拉取交互）；每张技能卡 `skill-foot` 里加「同步到云端」按钮。
- `web/client/src/pages/SettingsPage.tsx`：「配置路径」行按钮组加「上传配置到云端」和「从云端下载配置」（下载前提示会覆盖本地 providers.json 等），旁边显示上次同步时间。
- `web/client/src/api/cloudSync.ts`（新）：`getEntityIndex/pushEntity/pullEntity/deleteEntity/…`（登录态由 desktop cloud-auth 提供 token）。
- 图标：`iconSlots.ts` 新增 `cloud` 槽位（文件与会话组）+ `web/server/src/iconpacks/slot-keys.ts` 同步 + `content/builtin/iconpacks/lucide/assets/cloud.svg`（lucide cloud，tint 着色）。
- **SessionPanel / chatStore 会话相关：零改动**（会话同步已取消）。

### 4.4 web/server：**基本不动**


同步完全绕过本地 server（直读 dataDir），理由：server 对这些文件无缓存层、无事务约束，绕过最简单且不引入耦合。角色/技能/配置同步由桌面端直读 dataDir 对应子目录（`data-paths.ts` 已有权威路径函数），P1 再考虑给 server 加 `POST /api/content/reload` 主动失效内存缓存。

---

## 5. 里程碑与验收

> 全程「本地先行」：cloud-server 以 `localhost:8787` 开发，客户端 base URL 走配置项 `TIANSHU_CLOUD_URL`（默认生产域名）。迁云 = 部署 + 换 Nginx 子路径，代码零改动。

| 里程碑 | 产出 | 验收标准 | 预估 |
|---|---|---|---|
| **M0 骨架（本地）** | `cloud-server/` 独立项目（Hono+node:sqlite+jose），`/health`；contracts 目录（tunnel 帧先留空，sync 契约定型） | `curl localhost:8787/health` 200；契约文件两端副本 hash 一致脚本通过 | 0.5 天 |
| **M1 账号中心** | `/auth` register/login/refresh/me + scrypt + 限流 + JWT | curl 全链路：注册→登录→me→refresh；错误密码 401；连刷 6 次触发 429 | 1 天 |
| **M2 同步 API** | `/sync` 全套 API（文件通道 + 实体级 push/pull）+ blobs 存储 + LWW/墓碑；**伪客户端 e2e 脚本**（Node 脚本直接调 API 模拟两台设备） | e2e：A 上传角色→B 下载一致；同路径冲突→LWW 裁决+备份可查；配置目录 push/pull 往返一致；删除→墓碑→第三台不再复活；中断 PUT 重试 | 2~3 天 |
| **M3 桌面端集成** | `desktop/src/cloud/` + 设置页面板 + 同步入口（角色详情页上传 / 角色分页拉取 / 技能卡上传 / 技能分页拉取 / 配置上传+下载） | 真机演示：登录→角色详情页点同步→另一实例（另一 dataDir）「拉取云端角色」后角色可用；技能/配置同理；关闭面板后零网络请求 | 3 天 |
| **M4 打磨** | 冲突 UI 提示、配额展示、手动重试退避、日志脱敏、同步范围自定义（追加排除） | 断网/杀 cloud-server 模拟故障：手动点同步时给出明确错误、恢复后手动补同步成功；两机并行编辑同一角色产生冲突且有提示 | 2 天 |
| **M5 迁云上线** | 部署 cloud-server 到**腾讯云**服务器（systemd + Nginx `/auth` `/sync` 子路径 + HTTPS）+ 备份策略（SQLite 定期 backup + blobs rsync） | 公网域名下完整走通 M3/M4 验收；服务器重启后服务自动拉起 | 1 天 |

**总计 ≈ 10 人天**（不含 sessions.db 同步二期与 /remote 手机中继线）。

### 二期预留（本期不做，架构上留位）
1. **media/ 附件同步**：走同一 blob 通道，量大了加冷热分层。
2. **/remote 手机中继**：与本期互不阻塞，/auth 完成后即可并行开工。
3. **端侧加密**：密钥派生自密码，服务端只存密文 blob（配置含 API Key 时优先）。

---

## 6. 风险与对策

| 风险 | 对策 |
|---|---|
| 新机器空目录首轮同步清空云端 | 首次登录强制 `download-first`；服务端墓碑只在「已见过该路径的设备」上生效（`sync_files.origin_device` + 设备 manifest 校验） |
| 同步把正在运行的 agent 状态写坏 | **全手动同步（用户定稿）从根上规避**；白名单排除运行时数据；写入走临时文件+rename；`.sync-backup` 兜底 |
| 两台机器同时改同一角色/技能后各自上传 | **LWW 按最新时间覆盖（定稿）**；被覆盖文件云端备份 30 天；push 结果返回冲突清单，UI 提示 |
| token 泄露 = dataDir 可被读写 | token 存 safeStorage；refresh 可撤销；服务端按设备撤销入口；P1 可加端侧加密（密钥派生自密码，服务端只存密文 blob） |
| SQLite 单文件在云上的备份一致性 | 用 `node:sqlite` 的 backup API / `VACUUM INTO` 定期快照，不用 cp 热文件 |
| 本地开发与云上行为差异 | 客户端只依赖 `TIANSHU_CLOUD_URL`；M5 迁云后用同一套 e2e 脚本对公网再跑一遍 |

---

## 7. 已定稿的决策点（用户确认，2026-09-15）

1. **冲突策略**：按最新时间覆盖（LWW，服务端时间为准）；被覆盖文件云端备份 30 天可找回。
2. **云服务器**：腾讯云那台（阿里云 43.161.198.188 弃用；具体机型/OS 在 M5 迁云时确认）。
3. **账号形式**：用户名 + 密码（scrypt 加盐），不做邮箱/手机号。
4. **目录**：cloud-server 放 `C:\Users\dmql\Desktop\腾讯云\腾讯云\cloud-server\`。
5. **providers.json 含 API Key 明文上云**：P0 接受（HTTPS 传输 + 服务端私有存储），端侧加密放二期。
