# 天枢手机远程管理（Tianshu Remote）+ 统一登录 架构方案

> 目标：手机通过云端（只做中转）远程操作自己多台电脑上的天枢桌面端；电脑常开在线。
> **所有服务（远程管理、未来新增服务）共用一个登录（统一账号中心）**。
> 现状调研基于 `dev/` 工作区源码（web/server + web/client + desktop + shared）。

---

## 0. 结论速览（TL;DR）

1. **访问入口（同域子路径，挂在官网 www.tianshuapp.tech 下）**
   - `https://www.tianshuapp.tech/remote/*` → **远程管理服务**：设备目录 + 隧道 + 转发（手机↔电脑）
   - `https://www.tianshuapp.tech/auth/*` → **统一账号中心**：注册/登录/刷新/token 签发，**所有服务共用**
   - 未来新服务：`www.tianshuapp.tech/<服务>/*` 或独立子域，登录全部复用 `/auth`
   - 统一用 **www** 入口：裸域 tianshuapp.tech 现在 301 到 www，而 WebSocket 不跟随 301
2. **架构**：手机 App `--(HTTPS/SSE)--> /remote（云中继）<--(WSS 出站隧道)-- 电脑桌面端`。
   每台电脑主动向云发起反向隧道（解决 NAT），云在「手机请求」与「对应电脑隧道」间**透传转发**；
   agent/会话/数据全在电脑本地，云不存业务数据。
3. **统一登录（核心约束）**：注册一次、登录一次，token 在所有服务通用——云端做成
   **账号中心**：所有服务只认账号中心签发的 JWT（同一密钥/公钥），不再各自维护账号。
4. **天枢 server 几乎零改动**：被隧道整体透传；上行 `POST /api/events` + 下行
   SSE `/api/events/stream` 原样复用。
5. **需要新写**：① 云端 `cloud-server`（auth 账号中心 + remote 远程服务两模块）
   ② 桌面端隧道客户端 + 登录/开关 UI ③ 手机 App（mobile-web + Capacitor → Android APK 优先）。

---

## 1. 现状架构（已核实源码）

```
┌──────────────── 桌面端 (Electron) ────────────────┐
│  React 渲染层 (web/client)                         │
│    │ eventBus: 'ipc' 桥 OR 'sse' 降级              │
│  preload (window.tianshuDesktop)                   │
│    │ IPC                                          │
│  Electron main (desktop/src/server-manager.ts)     │
│    │ fork() 子进程                                 │
│  server 子进程 (web/server/dist/index.js)          │
│    ├─ Hono HTTP: 127.0.0.1:3456                   │
│    │   ├─ REST 路由 /api/*                        │
│    │   ├─ 上行 POST /api/events  (ws/handlers.ts)  │
│    │   └─ 下行 SSE GET /api/events/stream         │
│    ├─ transport/ipc-server.ts (process.send 桥)    │
│    ├─ agent 循环 / 会话管理 / SQLite sessions.db    │
│    └─ event-sinks 全局 fan-out                    │
└───────────────────────────────────────────────────┘
```

关键点（已核实）：
- **数据**：全部用户数据落 `dataDir`（`config.ts` `getDataDir()`），单机单租户，天然
  适合「一机一份」的多电脑模型。
- **事件通道**：`transport/event-sinks.ts` 全局 sink fan-out；SSE 每连接一个 sink，
  与 Electron IPC 桥共用同一套 `ws/handlers.ts`（传输中立）。SSE 是完整可用的远程通道。
- **上行协议**：`POST /api/events`（hello/strategy.set/chat-run/abort/approval.respond）；
  下行事件清单见 `eventBus.ts ALL_KNOWN_EVENTS`。
- **无认证**：全库无登录逻辑；CORS 只放行 loopback；server 只绑 `127.0.0.1:3456`——
  这是「云中继」方案的天然安全边界（本地永远不暴露公网）。

---

## 2. 目标架构：同一域名下的「账号中心 + 远程服务」

### 2.1 URL 布局（挂在官网 Nginx 的 443 server 块）

```
www.tianshuapp.tech/*               官网现有内容（不动）
www.tianshuapp.tech/auth/*          统一账号中心（注册/登录/刷新/me/token 元数据）
www.tianshuapp.tech/remote/*        远程管理服务（设备目录/隧道/转发）
   /remote/ws                       电脑 WSS 隧道接入点
   /remote/d/<deviceId>/api/*       手机到指定电脑的转发面（REST + SSE）
```

> 反代层（官网现有 Nginx）按前缀分流：`/auth/*`、`/remote/*` → 同一个 cloud-server 进程
> （`127.0.0.1:8787`）；其余 → 官网原服务。cloud-server 内部路由自带 `/auth`、`/remote`
> 前缀，不关心官网路由。以后想拆子域（`account.tianshuapp.tech` /
> `remote.tianshuapp.tech`）只是反代改动，代码不动。

### 2.2 拓扑

```
     手机 App（管理端）                        每台电脑 = 一台"设备"
 ┌───────────────────┐              ┌──────────────────────────────┐
 │ 登录(/auth)          │              │  天枢桌面端 (Electron)         │
 │ 设备列表(/remote/devices)│            │  ├─ 本地 server 127.0.0.1:3456│
 │ 会话/聊天(/remote/d/:id/api)│         │  └─ cloud-tunnel（新，WSS 隧道）│
 └─────────┬──────────┘              └──────────────┬───────────────┘
           │ HTTPS / SSE (JWT)                       │ WSS 出站(主动连云)
           ▼                                        ▼
 ┌──────────────── tianshuapp.tech（云服务器，唯一公网节点）───────────────┐
 │  官网原服务（Nginx 按前缀分流）                                             │
 │  ┌─────────────────── cloud-server 进程 (127.0.0.1:8787) ───────────┐ │
 │  │ /auth  账号中心: 注册/登录/refresh/me（JWT 签发，全服务唯一账号库） │ │
 │  │ /remote 远程服务: 设备目录(user→devices) + 隧道汇聚 + 双向转发     │ │
 │  └───────────────────────────────────────────────────────────────┘ │
 └────────────────────────────────────────────────────────────────────┘
      ▲ HTTPS/SSE (同一 JWT)
      │
  未来服务 X（tianshuapp.tech/x 或子域）—— 复用 /auth 登录，token 通用
```

### 2.3 为什么「云中继 + 子路径 + 统一账号中心」
- **多电脑管理**：每台电脑天然一实例；设备目录切换即路由切换；数据全在本地不冲突。
- **统一登录**：账号库只存在账号中心一份；任何新服务不重复造登录，只做「验证账号中心
  签发的 token」一件事（§5）。
- **改动最小**：天枢本地 server 零改动；官网共存；Electron/手机增量开发。

---

## 3. 云中继远程服务设计（cloud-server 的 /remote 模块）

### 3.1 职责（保持极薄）

```
POST /remote/devices/register       桌面登录后上报本机 → 绑定当前账号
GET  /remote/devices                该账号所有设备 + 在线状态
PATCH /remote/devices/:id           改名
DELETE /remote/devices/:id          解绑
GET  /remote/ws?token=              WSS 隧道接入（电脑）
# 转发面（校验 JWT user == 设备 owner，然后沿该设备隧道透传）
GET/POST/PATCH/DELETE /remote/d/:deviceId/api/*        REST 透传（含上行 POST /api/events）
GET  /remote/d/:deviceId/api/events/stream?token=      SSE 下行桥接
```

- 状态：在线表（设备↔隧道连接）全内存；账号/设备绑定关系 SQLite。
- **不做**：不缓存会话、不存消息、不做 agent、不持久化业务数据。

### 3.2 隧道帧协议（电脑 ↔ 云，WSS JSON，见 cloud-server/src/contracts/tunnel-frame.ts）

```
电脑→云：{ type:'register', device_id, name, os, machine_id }
         { type:'response', id, status, headers, body, error }
         { type:'sse-event', subId, event, data } | { type:'heartbeat' }
云→电脑：{ type:'request', id, method, path, query, headers, body }
         { type:'sse-subscribe', subId, path:'/api/events/stream' }
         { type:'sse-close', subId } | { type:'heartbeat' }
```

- 手机 REST：`POST /remote/d/<id>/api/events` → 云发 `request` 帧 → 电脑 bridge 本地
  打 `127.0.0.1:3456` → `response` 帧回传。
- 手机 SSE：`GET /remote/d/<id>/api/events/stream` → 云发 `sse-subscribe` → 电脑订阅本地
  SSE → `sse-event` 帧实时回推。
- 请求以 id 关联，支持并发与超时（60s）；设备离线返回 `device_offline`。

### 3.3 内网穿透
电脑在 NAT 后，**电脑主动连云**（出站 WSS），云永不主动连电脑；无需公网 IP/DDNS/
改路由器；心跳 25s、超时 70s 判离线；断线指数退避重连；桌面开机自启。

---

## 4. 桌面端改造（cloud-tunnel + 登录 UI）

1. **cloud-auth**：登录/刷新/绑定账号；token 用 Electron `safeStorage` 加密存
   `userData/`，access 自动续期。
2. **cloud-tunnel**：WSS 连 `wss://www.tianshuapp.tech/remote/ws` → register → 收到
   `request` 帧 → 本地 `http.request` 打 `127.0.0.1:3456` 透传 → 回传；
   `sse-subscribe` → 本地 EventSource `/api/events/stream` → 事件回推。
3. **设置页「云远程」**（web/client + features/remote）：登录（与手机同一账号）、
   开关、状态、设备名。
4. 天枢本地 IPC 模式保持不变，云远程是可选开关。

---

## 5. 统一登录设计（核心约束：所有服务同一个登录）

### 5.1 账号中心是唯一账号源
```
www.tianshuapp.tech/auth
POST /auth/register  {username, password}            → 建账号（scrypt 加盐）
POST /auth/login     {username, password}            → {access_token, refresh_token, user}
POST /auth/refresh   {refresh_token}                 → 新 access_token
GET  /auth/me        (Bearer)                        → 当前用户
GET  /auth/jwks                                     → 公钥/JWKS（供未来服务离线验签）
```

- JWT：`jose` 签发，`kid` 支持多密钥轮换；access 30min / refresh 30d（哈希入库、可撤销）。
- 账号中心可作为**未来所有服务**的 IdP：浏览器端预留 OIDC `authorize` 端点演进
  （原生 App 直接走 login API，体验更好）。

### 5.2 服务如何"共用一个登录"
| 端 | 做法 |
|---|---|
| 手机 App | 只在 `/auth/login` 登一次；access token 对所有服务通用（同 JWT），
  调 `/remote/*`、未来服务 `/x/*` 都带同一 Bearer |
| 桌面端 | 同一账号登录 `/auth`，绑定自己的设备；token 供隧道注册与未来本地服务使用 |
| 未来服务 X | **不建账号库**：中间件只做一件事——验 `/auth` 签发的 JWT（共享密钥或
  拉 `/auth/jwks` 公钥验签），必要时调 `/auth/me` 拿用户信息 |
| Web 浏览器 SSO | 页面跳转 `/auth/login?redirect=...`，登录后回跳带 token（后续按需上
  OIDC 标准流） |

> 关键：**账号库只有一份**（cloud-server /auth），任何服务要"登录"都指回 `/auth`，
> token 签发、刷新、撤销都在这一个地方。服务间不重复实现密码存储/登录逻辑。

### 5.3 数据模型（账号中心，SQLite，仅元数据）
```sql
users          (id TEXT PK, username TEXT UNIQUE, password_hash TEXT, created_at INT)
refresh_tokens (token_hash TEXT PK, user_id TEXT, expires_at INT)  -- 可撤销
-- 设备绑定在 /remote（users 与 devices 同库，devices.user_id 引用 users.id）
devices        (id TEXT PK, user_id TEXT, name, os, machine_id TEXT UNIQUE,
                created_at INT, last_seen INT)
```

### 5.4 安全要点
- 全链路 TLS（手机↔云 HTTPS、电脑↔云 WSS）；本地 server 永不监听公网。
- 转发鉴权：请求者 JWT 的 `sub` == 设备 owner，否则 403。
- 登录限流（5 次/分/账号+IP）；密码 scrypt 加盐；日志不落密码/token。

---

## 6. 手机端设计（**App 优先：mobile-web + Capacitor → Android APK**）

- **技术澄清**：Electron 只支持桌面（Win/mac/Linux），**不支持 Android**。手机端"套壳复用
  前端"的对应方案是 **Capacitor**（原生 WebView 壳，一条 React 代码路径出 PWA / Android APK /
  iOS），与 Electron 的复用思路一致。
- **形态**：`mobile-web/`（React，复用 web/client 组件）+ `npx cap add android`；
  壳默认加载远端 `https://www.tianshuapp.tech/mobile/`（同源 → 无 CORS、SSE 原生可用），
  官网 Nginx 加 `location /mobile/` 静态目录。
- **登录**：/auth 账号密码（与桌面同一账号）→ refresh token 存 Preferences/本地。
- **首页 = 设备列表**：账号下所有电脑，绿点=在线；点选进入某台。
- **操作台**：复刻 web/client 的会话/聊天 UI（API 前缀
  `https://www.tianshuapp.tech/remote/d/<deviceId>`），流式 markdown、中止、approval。
- **多设备切换**：顶部设备选择器；设备离线/断流 → 顶部横幅 + 自动重连。
- **Android 限制**：后台 WebView 长连接会被系统冻结 → 前台保 SSE；approval 通知后置到
  Capacitor 本地通知/FCM（M5）。

---

## 7. 文件/模块清单

| 对象 | 位置 | 说明 |
|---|---|---|
| 新增 | `C:\Users\dmql\Desktop\腾讯云\腾讯云\cloud-server\`（独立项目，与官网 tianshuapp/ 并列） | 云端单进程两模块：`src/auth/` + `src/remote/`（Hono + ws + node:sqlite + jose） |
| 新增 | `cloud-server/src/contracts/` | 隧道帧 + REST 契约唯一权威（desktop/mobile 持同步副本 + hash 校验） |
| 新增 | `desktop/src/remote/` | cloud-auth + cloud-tunnel（WSS 隧道客户端） |
| 改动 | `desktop/src/main.ts` / `preload.ts` / `shared/desktop-contract.ts` | 装配隧道、IPC 面 |
| 改动 | `web/client` | 设置页「云远程」面板 |
| 新增 | `mobile-web/`（M3） | 手机 App 前端（登录→设备→聊天；复用 web/client 组件；同份代码出 PWA） |
| 新增 | `mobile-app/`（M3，Android） | Capacitor 壳：`npx cap add android` → APK（Electron 不支持 Android，故用 Capacitor WebView 壳） |
| 不改 | `web/server/*` | 被隧道整体透传 |

---

## 8. 落地阶段（详见 implementation-plan）

| 里程碑 | 产出 | 验收 |
|---|---|---|
| M0 | 基建：cloud-server 骨架 + 云服务器 + 域名 HTTPS（/auth、/remote 分流） | `https://www.tianshuapp.tech/remote/health` 200 |
| M1 | cloud-server：统一登录(/auth) + 远程服务(/remote) 全链路 | curl 经 /remote 打到本地天枢 API；登录 token 互通 |
| M2 | 桌面 cloud-tunnel + 设置页登录/开关 | 桌面上线，设备 online；云上 curl 调真实电脑 |
| M3 | 手机 App（mobile-web + Capacitor APK） | Android 真机装 APK 远程聊天 = **MVP** |
| M4 | 多设备/断线重连/错误码打磨 | 两台电脑 + 手机稳定 |
| M5 | Android 发布版 + 原生通知 | release APK 等价 M3 |
| M6 | 限流/守护/备份/监控 | 自查清单通过 |

---

## 9. 风险与注意事项

- 电脑常开：断电即离线 → 开机自启 + 明确离线提示。
- SSE 跨隧道桥接稳定性 → M1 起脚本压测、断流自动重订阅。
- 账号中心是单点：需强 secret、限流、可撤销 token、备份；未来可独立部署/升级 OIDC。
- 同域子路径：官网反代改动会触及 cloud-server → `location /remote`、`/auth` 配置进版本管理。
- 云可见明文流量（TLS 只保传输）→ 本期信任模型明示；隐私敏感再上 E2EE。

---

## 10. 下一步

1. 架构定稿（/remote + /auth 统一登录，Nginx 分流）。可直接开工 M0/M1：
   `C:\Users\dmql\Desktop\腾讯云\腾讯云\cloud-server` 全新建（auth + remote + 单测 + 本机伪电脑 e2e + 部署脚本/Nginx 片段）。
2. 待确认：官网部署栈（决定反代配置写法）；云服务器 OS；仓库目录名 `cloud-server` 是否 OK。
