# 天枢手机远程管理 · 详细实施计划（从零到上线）

> 配套文档：`docs/mobile-cloud-architecture-plan.md`（架构定稿）。
> 本文是**执行计划**：每步做什么、产出什么、怎么验收。读者 = 实施者（我/你/可委派的子 agent）。
> 前置事实：已有 1 台云服务器 + 1 个域名；手机客户端、桌面登录、云中继服务全部未开发。
> 架构：手机 →(HTTPS/SSE)→ **云中继（只转发）** ←(WSS 出站隧道)— 每台电脑上的天枢桌面端（本地 server 127.0.0.1:3456）。电脑常开。

---

## 0. 一页总览

**最终形态**
- 手机装一个 App（先 Web/PWA，后 RN 壳）：登录 → 看到自己名下多台电脑（在线状态）→ 点选一台 → 像在本地一样用天枢（会话/聊天/角色/技能）。
- 每台电脑的桌面端：保持本地单机能力不变，后台多一条到云的加密隧道；设置页登录云账号并"上线本机"。
- 云中继：唯一有公网 IP 的节点；账号认证 + 设备目录 + 长连接汇聚 + 请求/事件双向转发；不存任何业务数据。

**里程碑（依赖有序）**

| # | 里程碑 | 核心产出 | 验证标准（演示） |
|---|---|---|---|
| M0 | 基建 | 仓库新目录、云服务器、官网子路径分流 HTTPS | 浏览器访问 `https://www.tianshuapp.tech/remote/health` 与 `/auth/me` 路由可达 |
| M1 | cloud-server（统一登录 + 远程转发） | `/auth` 账号中心 + `/remote` 设备/隧道/转发 | `curl` 经 `/remote` 打到本地天枢 API，token 互通 |
| M2 | 桌面 remote + 登录 | Electron 内 WSS 隧道 + 设置页登录/开关 | 桌面开机自动上线，`/remote/devices` 看到 online |
| M3 | 手机 App（mobile-web + Capacitor APK） | 登录页 + 设备列表 + 会话/聊天；出 Android APK | **Android 真机装 APK 远程给电脑发消息并收到流式回复 = MVP** |
| M4 | 端到端打磨 | 多设备、断线重连、离线提示、错误码 | 两台电脑 + 一台手机完整走通 |
| M5 | Android 发布版 + 原生能力 | release APK（自签）+ 本地通知 | 真机安装 release APK 与 M3 等价 |
| M6 | 上线加固 | 限流/审计/日志/备份/监控 | 压测与安全自查清单通过 |

**人力预估（一人全职）**：M0~M4 ≈ 3~4 周出 MVP；M5 ≈ +2 周；M6 ≈ +1 周。
**最大风险**：SSE 跨隧道桥接的稳定性（M2/M3 重点验证）。

---

## 1. 范围与前提

### 1.1 现状（已调研核实）
**天枢本体**
- 天枢桌面端 = Electron + fork 出的本地 server（Hono，绑 `127.0.0.1:3456`），渲染层 `web/client`（React+Vite），事件通道传输中立（`ws/handlers.ts` 同时喂 SSE 与 IPC）。
- 本地 server 是完整 HTTP 服务：REST `/api/*` + 上行 `POST /api/events` + 下行 SSE `GET /api/events/stream`，**可被整体透传，无需改动**。
- 桌面端、服务端**均无登录/账号体系**（loopback-only，天然安全但也无法远程）。

**官网（cloud-server 要挂载的目标，已读本机源码确认）**
- 官网项目在 `C:\Users\dmql\Desktop\腾讯云\腾讯云\tianshuapp`：`site/`（静态站，部署到服务器
  `/var/www/tianshuapp/site`）+ `deploy/nginx/tianshuapp.tech.conf`（Nginx 站点配置，部署到
  `/etc/nginx/sites-available/`）+ `scripts/deploy_tianshu.py`（paramiko + `SSH_PASS` 上传）。
- Nginx conf 现有 3 个 server 块：① 80 → 301 https；② `443 www.tianshuapp.tech`（主站：官网静态 +
  `/download/`、`/updates/` 下载分发 + GitHub 兜底）；③ `443 tianshuapp.tech`（裸域 → 301 www）。
- HTTPS 由 certbot 签发的 letsencrypt 证书管理（`www.tianshuapp.tech`）；ICP 备案已完成。
- 服务器：README-deploy.md 记载为阿里云 ECS `43.161.198.188` / 用户 `ubuntu`（密码登录，
  `SSH_PASS` 环境变量）——**与本机文件夹名"腾讯云"不一致，需用户最终确认**。

### 1.2 未开发清单（本计划要做的）
1. 云中继服务器 → 升级为 **cloud-server（/remote 远程服务 + /auth 统一账号中心）**（新项目）。
2. 桌面端云隧道客户端 + 登录/绑定/开关 UI（`desktop/` 与 `web/client` 增量改造）。
3. 手机客户端（先 Web/PWA，后 RN）。
4. 部署：域名子路径分流、进程守护、运维。

### 1.3 明确不做（本期）
- 不改造天枢 server 的 agent/会话/多租户；不在云上存业务数据。
- 不做移动端推送（APNs/FCM）除非需要（后置到 M6+）。
- 不做端到端加密（本期 TLS + 信任中继；见风险 §8）。

---

## 2. 技术栈与仓库规划

### 2.1 技术栈（与天枢同栈，降低心智负担）
- **cloud-server**：Node 24 + TypeScript + Hono + `ws` + `jose`(JWT)；SQLite 用 Node 内置 `node:sqlite`；密码 `crypto.scrypt`。全部零外部基础设施（不需要 Redis/Postgres）。单进程两模块：`/auth`（统一账号中心）+ `/remote`（远程转发），同库同 secret，**未来新服务复用同一 token**。
- **desktop remote**：Electron main 进程内 TypeScript 模块，用 Node 全局 `WebSocket` 客户端 + `http` 透传（零新运行时依赖）。
- **手机 Web 版**：复用 `web/client` 的 stores/api/组件，Vite 独立入口 + PWA manifest。
- **手机 App**：mobile-web（React，复用 web/client 组件）+ **Capacitor** 壳打包 Android APK
  （Electron 不支持 Android；Capacitor = 原生 WebView 壳，同款复用逻辑）。同一份代码可出 PWA/APK/iOS。

### 2.2 仓库结构（**云端项目独立于天枢 dev/ 仓库**）

代码分两个仓库/目录：

```
① 云端项目（新，独立目录，本机开发）—— 与官网项目并列在同一工作区
C:\Users\dmql\Desktop\腾讯云\腾讯云\
├─ tianshuapp/                                  # 已有：官网项目（site + deploy/nginx + scripts）
└─ cloud-server/                                # 新：云端服务（部署到官网同一台服务器）
│  ├─ src/
│  │  ├─ index.ts          # 入口：hono + ws，挂 /auth 与 /remote 前缀
│  │  ├─ config.ts         # PORT/JWT_SECRET/DB_PATH
│  │  ├─ db.ts             # node:sqlite：users/devices/refresh_tokens
│  │  ├─ contracts/        # 【唯一权威】隧道帧 + REST 契约类型
│  │  │  ├─ tunnel-frame.ts
│  │  │  └─ cloud-api.ts
│  │  ├─ auth/             # 【统一账号中心】register/login/refresh/me/jwks + 中间件
│  │  └─ remote/           # 【远程服务】devices + tunnel + forward + sse-bridge
│  ├─ deploy/              # systemd unit、Nginx 配置片段、部署脚本（随项目版本管理）
│  ├─ test/
│  ├─ package.json
│  └─ tsconfig.json

② 天枢 dev/（现有仓库，只做增量改造）
dev/
├─ docs/mobile-cloud-architecture-plan.md      # 架构定稿（/remote + /auth 统一登录）
├─ docs/mobile-cloud-implementation-plan.md    # 本文
├─ desktop/src/remote/                          # 【新】桌面远程（Electron 内）
│  ├─ cloud-auth.ts        # /auth 登录/刷新/绑定，token 持久化(safeStorage)
│  ├─ cloud-tunnel.ts      # WSS 客户端 + 本地透传 + 心跳重连
│  ├─ contracts-sync/      # 从 ①cloud-server/src/contracts 同步的副本
│  └─ index.ts             # 生命周期/状态汇总
├─ desktop/src/main.ts      # 【改】装配 remote 隧道 + IPC handlers
├─ desktop/src/preload.ts   # 【改】暴露 remote API
├─ shared/desktop-contract.ts # 【改】remote 接口类型
├─ web/client/              # 【改】设置页「云远程」面板
│  └─ src/features/remote/   # 【新】设置面板 + 登录态组件
└─ mobile-web/              # 【新，M3】手机 Web 版（Vite 独立 app，复用 web/client 源码）
   └─ src/  # 登录(auth)/设备列表/会话/聊天（精简导航）
```

> **契约同步策略**：`cloud-server/src/contracts/` 是隧道帧与 REST 契约的**唯一权威**；
> 桌面端 `desktop/src/remote/contracts-sync/` 与手机端持有同步副本，用
> `scripts/check-contract-sync.mjs`（对比文件 hash）在 e2e/CI 里防漂移。避免 git
> submodule 的复杂度，用脚本校验即可。

### 2.3 端口与域名规划（同域子路径，Nginx 分流）
- 云服务器公网只开 `80/443`；cloud-server 监听 `127.0.0.1:8787`，由 **Nginx**（即官网
  现有反代）终结 TLS 并按前缀分流，**cloud-server 不监听公网**。
- 子路径布局（挂在官网 Nginx conf 的 443 server 块里）：
  - `/auth/*` → cloud-server 账号中心（所有服务统一登录）
  - `/remote/*` → cloud-server 远程服务（设备/隧道/转发）
  - 其余 → 官网原服务
- **统一入口用 `https://www.tianshuapp.tech`**（主站，证书所在；裸域 `tianshuapp.tech` 现在
  `return 301` 到 www——WebSocket **不跟随 301**，桌面隧道/手机 Web 都写死 www 可避开一次跳转。
  WSS 接入点 = `wss://www.tianshuapp.tech/remote/ws`）。
  > 可选：在裸域 443 server 块里对 `/auth`、`/remote` 也加同样的转发（这样打裸域也不 301
  > 断 WS），M0 里一并给出。
- **Nginx 只分流、不重写路径**：cloud-server 内部路由自带 `/auth`、`/remote` 前缀，
  反代 `proxy_pass http://127.0.0.1:8787;`（不带 URI）原样透传。完整配置见 §6/M0。

---

## 3. 里程碑分解（每个 M：目标 → 任务 → 验收）

### M0 · 基建（0.5~1 天）
**目标**：云端项目就绪，云服务器可跑 Node，官网 Nginx 子路径分流通。

任务：
1. 本机建项目：`C:\Users\dmql\Desktop\腾讯云\腾讯云\cloud-server\`（与官网 `tianshuapp/` 并列；
   npm init + tsconfig 模板），`src/contracts/tunnel-frame.ts` + `src/contracts/cloud-api.ts` 占位。
2. 服务器（与官网同一台，Ubuntu + Nginx 已就绪）：
   - 装 Node 24（nodesource：`curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -` + `apt install -y nodejs`）；
   - `nginx -v` 确认；**不用装新 Nginx**，直接在官网现有 `tianshuapp.tech.conf` 上加 location。
3. **改官网 Nginx 配置**：编辑本机权威文件
   `C:\Users\dmql\Desktop\腾讯云\腾讯云\tianshuapp\deploy\nginx\tianshuapp.tech.conf`，
   在 443 主站 server 块（www）内、`server_name` 之后插入下面三块（cloud-server 的
   `deploy/nginx-cloud.include` 保存同款片段便于 diff/复用）；**裸域 443 块也加同样三块**
   （否则打裸域 `/remote/ws` 会被 301 断 WS）：
   ```nginx
   # ── 统一账号中心 ──
   location /auth/ {
       proxy_pass http://127.0.0.1:8787;          # 不带 URI → 原样透传 /auth/...
       proxy_http_version 1.1;
       proxy_set_header Host $host;
       proxy_set_header X-Real-IP $remote_addr;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       proxy_set_header X-Forwarded-Proto https;
   }
   # ── 远程服务（REST + SSE）──
   location /remote/ {
       proxy_pass http://127.0.0.1:8787;
       proxy_http_version 1.1;
       proxy_set_header Host $host;
       proxy_set_header X-Real-IP $remote_addr;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       proxy_set_header X-Forwarded-Proto https;
       proxy_buffering off;                       # SSE 必须关缓冲
       proxy_read_timeout 24h;                    # 长连接（SSE/WS 共用）
   }
   # ── 远程服务 WSS 隧道 ──
   location = /remote/ws {
       proxy_pass http://127.0.0.1:8787;
       proxy_http_version 1.1;
       proxy_set_header Upgrade $http_upgrade;
       proxy_set_header Connection "upgrade";
       proxy_read_timeout 24h;
   }
   ```
   > 说明：`location = /remote/ws` 精确匹配优先于 `location /remote/` 前缀；WSS 的
   > Upgrade 头也可以直接写进 `/remote/` 块（对所有 /remote 请求无害），二选一即可。
   > 官网 `/download/`、`/updates/` 在独立 location，与 `/auth`、`/remote` 互不影响。
   > 修改后上传服务器（沿用官网 tee 方式）：`sudo tee /etc/nginx/sites-available/
   > tianshuapp.tech.conf`，`sudo nginx -t && sudo systemctl reload nginx`。
4. 写占位服务（cloud-server 骨架，仅 `/remote/health` + `/auth/me` 路由）跑在 127.0.0.1:8787
   验证 HTTPS 分流。

验收：`https://www.tianshuapp.tech/remote/health` 返回 `{"ok":true}`；`/auth/me` 返回 401
（未带 token，说明分流成功）；官网原页面与 `/download/`、`/updates/` 不受影响。

---

### M1 · cloud-server 核心：统一登录 + 远程转发（3~4 天）
**目标**：`/auth` 统一账号中心 + `/remote` 设备/隧道/转发全部可跑，本地可测。**此模块同时是
未来所有服务的登录基座**（其他服务只验证这里签发的 token，不建账号库）。

任务（实现顺序）：
1. **auth 模块（统一账号中心，`auth/` + `db.ts`）**
   - `POST /auth/register`、`/auth/login`、`/auth/refresh`、`GET /auth/me`、`GET /auth/jwks`。
   - JWT：`jose`，`JWT_SECRET` 环境变量；access 30min / refresh 30d（refresh 哈希入库可撤销）；
     `scrypt` 加盐存 `users.password_hash`。
   - 中间件 `requireAuth`：校验 Bearer，注入 `c.set('user')`；供 `/remote/*` 与未来服务复用。
2. **设备模块（`remote/devices.ts`）**
   - `POST /remote/devices/register`（桌面登录后调用：上报 hostname/os/machine_id → 建 device 并绑定当前 user）
   - `GET /remote/devices`（该账号下设备 + 在线状态）
   - `PATCH /remote/devices/:id`（改名）、`DELETE /remote/devices/:id`（解绑）。
3. **隧道模块（`remote/tunnel.ts` + `frame.ts`）**
   - `GET /remote/ws?token=...` 升级 WebSocket（`ws` 库），token 校验通过才接受。
   - `register` 帧 → 关联 user；在线表 `Map<deviceId, ws>` + `Map<userId, Set<deviceId>>`。
   - 心跳 25s / 超时 70s 判离线；断线清理在线表。
4. **转发模块（`remote/forward.ts`）**——最核心
   - REST 透传：`/remote/d/:deviceId/api/*` → 校验 JWT user 拥有该 device → 在线则沿隧道发
     `request` 帧 → 等 `response` 帧 → 回 HTTP；超时 60s → 504；离线 → `device_offline`。
   - SSE 桥接：`/remote/d/:deviceId/api/events/stream?token=` → 发 `sse-subscribe` 帧 → 电脑
     回推 `sse-event` 帧 → 服务器持续写 SSE 到手机；断连发 `sse-close`。
5. **测试**：auth（含 token 跨路由互通：同一 token 调 `/auth/me` 与 `/remote/devices` 都通过）
   /转发/离线 单测（vitest）；隧道用 `wscat` 手测。

验收（本机即可，不需要真云）：
- 启动 cloud-server（`PORT=8787 JWT_SECRET=x`）。
- 起一个本地天枢 server（`npm run dev` 于 web/server）作为"伪电脑"。
- 脚本模拟电脑：register → login → WSS 隧道注册并维持。
- `curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8787/remote/d/<deviceId>/api/sessions` → 返回电脑上真实会话列表。
- `curl -X POST .../remote/d/<deviceId>/api/events`（chat-run）收到 ack；SSE 收到 `run.*` 事件。
- **统一登录验证**：同一账号 token 可同时访问 `/auth/me` 与（未来服务预留的）同 secret 路由。

---

### M2 · 桌面 remote + 登录（3~5 天）
**目标**：真实桌面端上线到云远程；设置页可登录/开关/看状态；**天枢 server 零改动**。
**登录复用**：桌面登录的就是 `/auth` 同一账号（与手机一致），token 只存安全区。

任务：
1. **`cloud-auth.ts`**
   - 封装 register/login/refresh/me（fetch `https://www.tianshuapp.tech/auth/*`）。
   - token 持久化：Electron `safeStorage` 加密存 `userData/cloud-token.json`；refresh 自动续期。
2. **`cloud-tunnel.ts`**
   - 全局 `WebSocket` 连 `wss://www.tianshuapp.tech/remote/ws?token=...`。
   - 上线发 `register` 帧（device_id = 本机 `machine_id`：hostname + `os.homedir` 稳定哈希）。
   - 收到 `request` 帧 → Node `http.request` 打到 `127.0.0.1:3456`（method/path/headers/body 透传）→ `response` 帧回传。
   - 收到 `sse-subscribe` → 建 `EventSource http://127.0.0.1:3456/api/events/stream` → 事件转 `sse-event` 帧回推。
   - 心跳 + 指数退避重连（1s→2s→…→30s 封顶）；隧道只在本机 server ready 后启动。
3. **Electron 集成**（`main.ts` + `preload.ts` + `desktop-contract.ts`）
   - main 启动流程：server ready →（若配置开启）remote.start()；退出/重启时 stop()。
   - IPC 面：`remote:login` / `remote:logout` / `remote:get-status` / `remote:set-enabled`；状态事件 `remote:status` 推渲染层。
   - 开机自启：桌面应用 `app.setLoginItemSettings`（可选开关）。
4. **设置页 UI**（`web/client` + `features/remote/`）
   - 「云远程」面板：登录/注册表单（经 IPC，不暴露 token 给渲染层）、开关、状态（离线/连接中/已上线）、设备名。
   - 本地 IPC 模式不受影响（默认关闭，用户显式登录开启）。

验收：
- 桌面点「登录 + 开启中继」→ `GET /devices` 看到该电脑 online。
- 云上用 curl 经中继调电脑 `/health`、`/api/sessions` 返回真实数据。
- 重启电脑/杀隧道 → 自动重连回 online（≤30s）。
- 关闭中继 → 本地一切照旧。

> 注意：手机侧还不可用前，本里程碑的验证走 curl/浏览器开发者工具。

---

### M3 · 手机 App：mobile-web + Capacitor 打包 Android APK（1~2 周，MVP）
**目标**：手机完成「登录 → 选设备 → 聊天」→ **MVP 达成**，并出**可安装的 Android APK**。
**技术澄清**：Electron 不支持 Android，手机端不用 Electron；改用 **Capacitor**（原生 WebView 壳，
与 Electron"套壳复用前端"思路一致），产出真实 APK。

方案（与 Electron 同款复用逻辑）：
- `mobile-web/`（独立 Vite app，React）**复用** `web/client` 的 stores/api/eventBus/markdown 组件，
  路由精简为：登录 → 设备列表 → 会话列表 → 聊天。**同一份代码三端复用**：
  ① 浏览器/PWA 直接访问（手机浏览器调试用）② Capacitor 包成 Android APK ③ 后续 iOS。
- Capacitor 壳默认**加载远端 mobile-web**（`server.url = https://www.tianshuapp.tech/mobile/`）：
  与 /auth、/remote 同源 → 无 CORS 问题、EventSource/SSE 原生可用；离线缓存由 PWA SW 兜底。
  官网 Nginx 加 `location /mobile/` 指向 mobile-web 静态构建目录（与 /download/ 同模式）。

任务：
1. **remote 协议层**（`cloud-server/src/contracts/cloud-api.ts` 保证双端契约一致；登录走 `/auth`，业务走 `/remote`）
   - apiUrl：`https://www.tianshuapp.tech/remote/d/<deviceId>/api/...`；SSE：`.../remote/d/<deviceId>/api/events/stream?token=`。
   - auth store：token（access/refresh，refresh 存 localStorage/Capacitor Preferences）+ 自动刷新 + 401 跳登录。
   - device store：列表/在线状态/当前选中设备。
2. **页面**（移动端布局）
   - 登录/注册页；设备列表页（绿/灰点 + 离线原因）；会话列表 + 聊天页（流式 markdown、中止、approval 按钮——approval 是远程核心场景）；顶部设备切换器。
   - 全局状态条：设备离线/隧道断 → 提示 + 自动重连。
3. **PWA**：manifest + service worker（缓存 app 壳）；「添加到主屏幕」全屏体验。
4. **Capacitor Android 壳**
   - `npx cap init` + `npx cap add android`；`capacitor.config.ts` 配 `server.url`（远程壳）
     或本地 bundle（`webDir: dist`，离线可用但更新要走 APK）。
   - Android 权限：`INTERNET`；targetSdk/compileSdk 用最新稳定；`android:usesCleartextTraffic=false`（全 HTTPS）。
   - 构建：`npm run build` → `npx cap sync android` → Android Studio 出 **debug APK**（侧载安装验证）；
     release 需 keystore 签名（自签即可侧载；上 Play 再另要）。
5. **联调**：手机（真机）连 4G/家庭 WiFi → 完整走通：发消息 → 电脑 agent 跑 → 流式回复 → 中止 → approval 确认。

验收（MVP 判定）：
- **Android 真机安装 APK**：登录 → 看到在线电脑 → 打开会话发消息 → 逐字收到回复 → 点「中止」能停。
- 手机浏览器访问 `/mobile` 同样可用（PWA 兜底）。
- 电脑离线 → 手机明确提示"设备离线"而非白屏/卡死。
- 刷新/重进页面会话历史完整（REST 拉取，不依赖 SSE 重放）。

---

### M4 · 端到端打磨（2~3 天）
任务：
1. 第二台电脑接入：注册设备、改名、手机切换路由不串会话。
2. 断连矩阵：电脑断网/关 app/休眠恢复；手机切后台/弱网/锁屏；服务器重启（systemd 拉起）——验证全部自动恢复且状态一致。
3. 错误码规范化：`device_offline` / `not_owner` / `token_expired` / `tunnel_timeout`，客户端分别提示。
4. 转发层防护：remote 转发请求超时、并发上限、body 大小上限（如 10MB，附件场景放宽）、SSE 订阅泄漏清理。
5. 安全自查：桌面 token 不落明文、日志不打印 token/密码、CORS 白名单（只放行手机 Web 域名）。

验收：两台电脑 + 一台手机 1 小时连续操作无卡死；断网恢复 ≤30s。

---

### M5 · Android 发布版 + 系统能力（2 周，可裁剪）
任务：
1. **Capacitor 原生能力补强**（按需）：Android 本地通知（approval 需确认时即使 App 在后台也弹
   通知）→ `@capacitor/local-notifications`；后台保活/重连说明（Android 限制后台 WebView 长连，
   前台才保 SSE，通知由 FCM 兜底——本期先文档化限制）。
2. **发布版 APK**：keystore 自签 → release APK（`aab` 备选）；Android 版本升级策略
   （App 内检查 `/mobile/version.json` 提示更新，或直接重装 APK）。
3. （可选）上架：Google Play 需开发者账号；不上架则官网放 APK 下载（`/download/` 同模式）。
4. iOS 如需：同代码加 `npx cap add ios`（需 macOS + Apple Developer 账号），本期不做。

验收：Android 真机安装 release APK，全流程 == M3 验收项。

---

### M6 · 上线加固（1 周，可裁剪）
- 限流（登录 5 次/分/IP + 全局限流）、审计日志（journald + 文件轮转）。
- 中继进程守护：systemd unit + 自动重启；数据库每日备份。
- 简单监控：`/health` 外部拨测（cron + 告警邮件/企业微信）。
- 安全自查清单：依赖更新、secret 管理、TLS 1.2+、HSTS。
- （可选）推送：approval 类事件 → FCM/APNs（需原生端 + 厂商账号）。

---

## 4. API 契约草案（双端共用的"标准"）

```
# 统一账号中心（所有服务共用一个登录）
POST /auth/register                {username, password}            → {user}
POST /auth/login                   {username, password}            → {access_token, refresh_token, user}
POST /auth/refresh                 {refresh_token}                 → {access_token}
GET  /auth/me                     (Bearer)                         → {user}
GET  /auth/jwks                                                       → 公钥（未来服务离线验签）
# 远程服务（Bearer 必须 = 设备 owner）
POST /remote/devices/register     (Bearer) {hostname, os, machine_id} → {device}
GET  /remote/devices              (Bearer)                           → {devices:[{id,name,os,online,last_seen}]}
PATCH/DELETE /remote/devices/:id  (Bearer)
POST /remote/d/:deviceId/api/events                  # 上行透传（chat-run/abort/…）
GET  /remote/d/:deviceId/api/events/stream?token=    # SSE 下行
GET/POST/PATCH/DELETE /remote/d/:deviceId/api/*      # 其余 REST 透传
# 未来服务 X：同样只调 /auth 登录；接口路径 tianshuapp.tech/x/*，中间件验证同一 JWT

# 隧道帧（WSS，JSON，见 cloud-server/src/contracts/tunnel-frame.ts）
电脑→云: register{device_id,name,os,machine_id} | response{id,status,headers,body,error}
         sse-event{subId,event,data} | heartbeat
云→电脑: request{id,method,path,query,headers,body} | sse-subscribe{subId,path}
         sse-close{subId} | heartbeat
```

登录态决策：**access_token 30min + refresh_token 30d**；手机与桌面都只存 refresh 于本地安全区，
access 每次启动/刷新时换取；401 时静默 refresh 重试一次，失败才踢回登录页。token 带 `sub`
(用户 id) 与 `aud`（签发场景：app/desktop/web），服务只验签与过期，不各自存密码。

---

## 5. 数据模型（cloud-server SQLite，仅元数据）

```sql
users   (id TEXT PK, username TEXT UNIQUE, password_hash TEXT, created_at INT)
devices (id TEXT PK, user_id TEXT NOT NULL, name TEXT, os TEXT,
         machine_id TEXT UNIQUE, created_at INT, last_seen INT)
refresh_tokens (token_hash TEXT PK, user_id TEXT, expires_at INT)   -- 可撤销
-- 在线状态只存内存（隧道断即掉），不落库
```

---

## 6. 部署手册要点（官网同一台服务器 + Nginx）

**本机开发**：`C:\Users\dmql\Desktop\腾讯云\腾讯云\cloud-server`（Windows，`npm run dev`）。
**部署目标**：官网所在服务器（README-deploy.md 记载阿里云 ECS `43.161.198.188`，用户 `ubuntu`，
密码经 `SSH_PASS` 环境变量 —— 服务器实际归属以用户确认为准），与官网 `/var/www/tianshuapp` 同机。

1. **服务器准备**
   - 装 Node 24（nodesource）；Nginx 已装（官网在用），无需重复配置证书。
   - 目录：`sudo mkdir -p /opt/tianshu-cloud && sudo chown $USER /opt/tianshu-cloud`
     （或 `~/cloud-server`，systemd 示例按 `/opt/tianshu-cloud`）。
2. **Nginx**：在官网权威文件 `tianshuapp/deploy/nginx/tianshuapp.tech.conf` 的 443 server
   块（www 主站 + 裸域）加 `/auth/`、`/remote/`、`=/remote/ws` 三块（见 M0），上传到
   `/etc/nginx/sites-available/tianshuapp.tech.conf`，`nginx -t && systemctl reload nginx`。
   cloud-server 侧 `deploy/nginx-cloud.include` 保存同款片段，diff 防漂移。
3. **systemd**（`deploy/tianshu-cloud.service`，随项目进版本管理）：
   ```
   [Unit]
   After=network.target
   [Service]
   User=ubuntu
   WorkingDirectory=/opt/tianshu-cloud
   ExecStart=/usr/bin/node /opt/tianshu-cloud/dist/index.js
   EnvironmentFile=/etc/tianshu-cloud.env
   Restart=always
   RestartSec=3
   [Install]
   WantedBy=multi-user.target
   ```
   `sudo systemctl enable --now tianshu-cloud`
4. **环境文件** `/etc/tianshu-cloud.env`（服务器上创建，不进 git）：
   ```
   PORT=8787
   JWT_SECRET=<openssl rand -base64 48 生成>
   DB_PATH=/opt/tianshu-cloud/data/cloud.db
   ```
5. **部署脚本** `cloud-server/deploy/deploy.py`：沿用官网 `paramiko + SSH_PASS` 工具链
   （与 `tianshuapp/scripts/deploy_tianshu.py` 同款健壮上传）：本机 build → 上传 dist/
   package.json/deploy → 远程 systemctl restart。SSH_HOST/SSH_USER/SSH_PASS 环境变量可配。
6. **验证**：`curl https://www.tianshuapp.tech/remote/health`、`/auth/me`；
   `journalctl -u tianshu-cloud -f` 看日志。

> 注意：域名/证书已由官网现有 Nginx + certbot 管理（不要动官网 server 块的证书配置，
> 只加 location）；cloud-server 永不监听公网（仅 127.0.0.1:8787）。

---

## 7. 测试与验证策略
- **单元**：cloud-server auth（含统一登录互通）/forward/offline（vitest）；desktop cloud-auth 存读（mock fetch）；mobile stores。
- **契约测试**：`scripts/check-contract-sync.mjs` 校验 desktop/mobile 的契约副本与
  `cloud-server/src/contracts/` 一致；类型在 cloud 与 desktop/手机端双侧编译引用防漂移。
- **手动验证脚本**（`scripts/cloud-e2e.sh`，M1 起维护）：register→login→(伪电脑隧道)→转发 sessions→chat-run→SSE 收事件，一键回归。
- **真机验收清单**：M3/M5 的验收项逐条打勾。

---

## 8. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| SSE 跨隧道桥接丢帧/断流 | 手机收不到流式回复（核心体验） | M1 就用脚本压测桥接；断流自动重订阅（last-event-id 重放）；M3 优先验收 |
| 电脑休眠/断电 | 设备离线，手机不可用 | 桌面开机自启 + 关闭"允许睡眠"引导；离线明确提示 |
| 隧道被云侧误杀 | 连接假死 | 心跳 + 双方超时判定；cloud-tunnel 断线立即重连 |
| 云服务器被攻击 | 账号泄露/滥用 | 只开 80/443；HTTPS；登录限流；JWT_SECRET 强随机；token 可撤销 |
| 中继看到明文流量 | 隐私 | 本期明示信任模型；后续可加消息体加密（隧道帧 payload 加一层 E2EE） |
| 域名/DNS/证书运维 | 服务不可达 | 证书由官网现有 Nginx 管理（勿动）；`/remote/health` 外部拨测告警 |
| 手机端误用桌面 UI | 体验差/返工 | M3 起就独立 mobile-web 入口，不复用宽屏导航 |

---

## 9. 建议的执行顺序（我建议这样推进）

1. **先做 M0 + M1**（我可以立即开工）：产出 cloud-server（`/auth` 统一账号中心 + `/remote` 远程服务）完整代码 + 单测 + 本机伪电脑链路验证 → 你 rsync 到云服务器跑起来（或我写好部署脚本你执行）。
2. **M2**：桌面 remote（这块要动 Electron main，谨慎增量，本地 IPC 模式必须不受影响）。
3. **M3 与 M2 并行尾段**：mobile-web 协议层可先写（对着 cloud-api 契约），等 M2 通了直接联调 → **MVP**。
4. M4~M6 逐项收尾。

**已确认的环境（2026-09-03）：**
1. ✅ 官网反代 = **Nginx**，官网项目本机在 `C:\Users\dmql\Desktop\腾讯云\腾讯云\tianshuapp`
   （静态站 + `deploy/nginx/tianshuapp.tech.conf`），证书/TLS 已由 certbot 管理，只加 location。
2. ✅ 服务器 = **43.161.198.188 / ubuntu / SSH 密码登录**（密码用户口头提供，只经 `SSH_PASS`
   环境变量使用，**严禁写入 git/文档/代码**；官网 deploy_tianshu.py 同款约定）。
   cloud-server 与官网**同机部署**，本机开发目录 =
   `C:\Users\dmql\Desktop\腾讯云\腾讯云\cloud-server`（与 tianshuapp 并列，不进 dev/ 仓库）。
3. ✅ 访问路径：`www.tianshuapp.tech/remote`（远程）+ `www.tianshuapp.tech/auth`（统一登录），
   Nginx 按前缀分流到 127.0.0.1:8787；桌面/手机统一用 www 入口（裸域现 301，WS 不跟随 301）。
4. ✅ 手机端 = **App（不要 PWA 先行）**：mobile-web 前端 + **Capacitor** 壳 → **Android APK 优先**；
   Electron 不支持 Android（Capacitor 才是移动端"套壳复用前端"的对应方案）。

**执行顺序：**
1. **先做 M0 + M1**：在 `C:\Users\dmql\Desktop\腾讯云\腾讯云\cloud-server` 产出完整代码
   （`/auth` 统一账号中心 + `/remote` 远程服务 + 单测 + 本机伪电脑链路验证）；
   部署脚本与 Nginx 片段随项目给出，你执行后官网即挂载 `/auth`、`/remote`。
2. **M2**：桌面 remote（动 Electron main，谨慎增量，本地 IPC 模式必须不受影响）。
3. **M3 与 M2 并行尾段**：mobile-web 协议层可先写（对着 cloud-api 契约），等 M2 通了直接联调 → **MVP**。
4. M4~M6 逐项收尾。
