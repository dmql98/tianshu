# 天枢桌面客户端分发与自动更新实施计划（OpenCode 执行版）

> 文档版本：v1.0  
> 编写日期：2026-08-09  
> 代码仓库：`C:\Users\dmql\Desktop\tianshu\TianShu`  
> 应用代码根目录：`C:\Users\dmql\Desktop\tianshu\TianShu\dev`  
> 第一目标平台：Windows x64  
> 当前应用版本：`0.1.0`

---

## 0. 给 OpenCode 的执行指令

本文件是实际开发任务书，不是概念方案。执行时遵守以下规则：

1. 先阅读仓库根目录和 `dev/AGENTS.md`，遵守其中的 CodeGraph/graphify 规则。
2. 开始前运行 `git status --short`，不得覆盖用户已有修改。
3. 严格按本文 Phase 0 → Phase 6 顺序实施；每个 Phase 独立构建、验证后再进入下一阶段。
4. 不要在本阶段实现商城、支付、登录、License、角色付费下载或内容加密。
5. 不要自研替换安装目录的 updater；应用更新必须使用 `electron-updater`。
6. 不要在 React 渲染进程直接调用 GitHub API；更新能力必须经 preload IPC 调用 Electron main。
7. 不要把数据库、配置、角色、技能或用户文件写入安装目录。
8. 不要把系统 Node 作为用户运行前提；生产安装包必须携带固定版本的便携 Node.js。
9. Windows 第一版只构建 x64 NSIS 安装包；macOS/Linux 暂不进入验收范围。
10. 每完成一个 Phase，更新本文对应复选框，并在交付说明中记录实际命令和结果。
11. 修改代码后运行 `graphify update .`（如果命令在环境中可用）；不可用时记录原因，不阻塞开发。

---

## 1. 已冻结的产品决策

### 1.1 当前阶段要做什么

当前只开发可大范围分发的基础桌面客户端：

- Electron 桌面客户端。
- 用户通过 Windows 安装包安装，不需要安装 Node.js。
- 客户端启动后自动拉起本地 Hono + Socket.IO 服务。
- Electron 窗口显示 React/Vite 前端，不打开外部浏览器。
- GitHub Releases 承担公开安装包分发和客户端自动更新。
- 设置 → 关于页面显示真实版本和更新状态。
- 支持启动静默检查、手动检查、确认下载、下载进度、重启安装和失败重试。
- 用户数据与应用安装目录完全分离，升级不能覆盖用户数据。

### 1.2 当前阶段明确不做什么

- 不实现商城 UI 和商城服务器。
- 不实现账户注册、登录和支付。
- 不实现内容权益、设备绑定、License 或激活。
- 不实现角色/皮肤/技能包的付费下载。
- 不实现前端静态文件单独增量热替换。
- 不实现后端 server 单独自替换。
- 不实现 stable/beta 多通道；第一版只有 stable。
- 不实现静默强制升级。
- 不实现 macOS/Linux 安装包。
- 不把 GitHub Releases 用作未来商城内容下载源。

### 1.3 后续商城的边界

未来商城是独立系统：

```text
公开应用更新                         私有商城内容
GitHub Releases                     TianShu Store Server
├─ 安装包                           ├─ 用户登录
├─ latest.yml                       ├─ 订单/支付
└─ blockmap                         ├─ 用户权益
                                    ├─ 内容包签名
无需登录                            └─ 鉴权下载地址
```

本次只需保证未来可以在导航中增加商城入口，不需要预埋无实际用途的商城代码。

---

## 2. 当前仓库基线与问题

### 2.1 当前结构

```text
TianShu/
├─ .git/
├─ docs/
└─ dev/
   ├─ .codegraph/
   ├─ web/
   │  ├─ client/              React 18 + Vite 6
   │  └─ server/              Hono + Socket.IO + better-sqlite3
   ├─ run.bat                 当前双端口浏览器开发入口
   ├─ setup.bat
   └─ .node-version           当前内容为 18，但实际依赖/开发环境已高于它
```

### 2.2 已存在但尚未实现的桌面接口

`dev/web/client/src/types/electron.d.ts` 已有一个草案：

```ts
interface ElectronAPI {
  version: string
  platform: string
  onUpdateStatus: (callback: (status: string) => void) => void
  checkForUpdates: () => void
  openDirectoryDialog: () => Promise<string | null>
}
```

该接口不能直接沿用，原因：

- `string` 状态无法表达进度、目标版本、更新说明和错误。
- 没有下载、安装和取消监听能力。
- 方法没有 Promise 返回值，前端无法处理失败。
- `version` 静态字段不利于统一 IPC 初始化。

Phase 3 必须替换为本文定义的强类型 contract。

### 2.3 当前后端不适合直接被 Electron 管理的点

`dev/web/server/src/index.ts` 当前在模块加载时立即：

- 打开数据库。
- 初始化工具。
- 创建 Hono/Socket.IO 服务。
- 固定监听端口。
- 启动事件调度器和资产 GC。
- 注册全局异常处理。
- 端口冲突时直接 `process.exit(1)`。

因此必须拆出可启动、可报告端口、可优雅关闭的生命周期接口。

### 2.4 当前数据路径风险

`dev/web/server/src/config.ts` 当前：

- 默认数据路径固定为 `C:\.Tianshu`。
- `config.json` 写在 server 编译产物附近。

安装到 `Program Files` 或用户应用目录后，安装目录可能不可写，也会被 updater 替换。配置文件必须迁移到 Electron `userData`。

### 2.5 当前版本显示是假数据

`SettingsPage.tsx` 的“关于”页面写死 `v0.1.0`，检查按钮没有行为。必须改为读取 Electron 主进程版本。

---

## 3. 目标架构

### 3.1 生产运行结构

```text
TianShu.exe (Electron main)
│
├─ BrowserWindow
│  └─ http://127.0.0.1:<动态端口>/
│
├─ electron-updater
│  └─ GitHub Releases
│
└─ 内置 Node 子进程
   ├─ Hono API
   ├─ Socket.IO
   ├─ React 静态文件
   ├─ better-sqlite3
   └─ Agent/MCP/工具执行

用户数据
└─ %APPDATA% 或 Electron app.getPath('userData') 下的独立目录
```

### 3.2 为什么使用内置 Node 子进程

生产包内携带固定版本的官方 Node.js runtime，由 Electron 使用 `child_process.fork()` 启动 server：

- 保留当前 Node 后端，不要求大规模重构。
- `better-sqlite3` 按普通 Node ABI 安装，不与 Electron ABI 混用。
- 后端异常不会直接拖垮 Electron main。
- Electron 更新前可以通过 IPC 请求后端优雅关闭。
- 用户仍只安装和打开一个客户端，不感知 Node 和本地服务。
- 后续若 server 变大，仍可独立监控日志和进程状态。

不要在第一版把全部 server import 到 Electron main。

### 3.3 进程通信

Electron 与 server 子进程使用 Node IPC，不使用公开的 shutdown HTTP API：

```ts
// server -> Electron
type ServerMessage =
  | { type: 'ready'; port: number }
  | { type: 'fatal'; message: string }
  | { type: 'log'; level: string; message: string }

// Electron -> server
type DesktopMessage =
  | { type: 'shutdown' }
```

server 生产环境必须监听 `127.0.0.1`，端口使用 `0` 让操作系统自动分配，禁止监听 `0.0.0.0`。

### 3.4 开发模式

开发模式保留双端口热更新：

```text
Vite                    http://127.0.0.1:3457
Hono/Socket.IO          http://127.0.0.1:3456
Electron BrowserWindow  加载 3457
```

开发模式下：

- Vite HMR 正常工作。
- server 使用 `tsx watch`。
- Electron 不启动打包后的 Node 子进程。
- `electron-updater` 完全禁用。
- Electron 窗口关闭时，开发编排脚本终止 Vite 和 server。

---

## 4. 目标文件结构

实施完成后建议形成以下结构：

```text
TianShu/
├─ .github/
│  └─ workflows/
│     └─ desktop-release.yml
├─ docs/
│  └─ 客户端分发与自动更新-OpenCode实施计划.md
└─ dev/
   ├─ package.json                     # 统一开发/构建命令
   ├─ package-lock.json
   ├─ .node-version                    # 固定 Node 24
   ├─ scripts/
   │  ├─ dev-desktop.mjs
   │  ├─ prepare-desktop-runtime.mjs
   │  ├─ verify-release-version.mjs
   │  └─ smoke-packaged.mjs
   ├─ shared/
   │  ├─ desktop-contract.ts
   │  └─ server-ipc.ts
   ├─ desktop/
   │  ├─ package.json
   │  ├─ package-lock.json
   │  ├─ tsconfig.json
   │  ├─ electron-builder.yml
   │  ├─ assets/
   │  │  ├─ icon.ico
   │  │  └─ icon.png
   │  ├─ src/
   │  │  ├─ main.ts
   │  │  ├─ preload.ts
   │  │  ├─ server-manager.ts
   │  │  ├─ updater.ts
   │  │  ├─ updater-state.ts
   │  │  └─ ipc.ts
   │  ├─ test/
   │  │  ├─ updater-state.test.ts
   │  │  └─ server-manager.test.ts
   │  ├─ runtime/                       # 构建生成，gitignore
   │  │  └─ node/
   │  ├─ staging/                       # 构建生成，gitignore
   │  │  ├─ client/
   │  │  └─ server/
   │  └─ dist/                          # 构建生成，gitignore
   └─ web/
      ├─ client/
      │  └─ src/
      │     ├─ features/update/
      │     │  ├─ useDesktopUpdater.ts
      │     │  └─ UpdatePanel.tsx
      │     ├─ pages/SettingsPage.tsx
      │     └─ types/electron.d.ts
      └─ server/
         └─ src/
            ├─ app.ts
            ├─ index.ts
            ├─ event/event-scheduler.ts
            └─ character/asset-gc.ts
```

具体文件名可以小幅调整，但职责边界不能合并回单个巨型文件。

---

## 5. 统一版本和依赖策略

### 5.1 唯一版本源

以 `dev/desktop/package.json` 的 `version` 为发布版本源。以下位置不得再手写版本：

- React 关于页面。
- server 日志。
- Release 文件名。
- updater 当前版本。

Electron 使用 `app.getVersion()` 读取版本。

`verify-release-version.mjs` 在 CI 中校验：

```text
Git tag v0.1.1
desktop/package.json version 0.1.1
```

不一致则构建失败。

### 5.2 Node 版本

把 `dev/.node-version` 从 `18` 更新为固定的 Node 24 LTS小版本。执行开发时选择当时经过验证的 Node 24.x，并同时写入：

- `.node-version`
- `dev/package.json#engines.node`
- `dev/web/server/package.json#engines.node`
- `prepare-desktop-runtime.mjs` 的 runtime 版本常量
- GitHub Actions `setup-node`

所有位置必须保持一致。不要使用 `latest` 作为生产 runtime 下载标识。

### 5.3 Electron 依赖

`dev/desktop/package.json` 至少包括：

```json
{
  "name": "tianshu-desktop",
  "version": "0.1.0",
  "private": true,
  "main": "dist/main.js",
  "dependencies": {
    "electron-updater": "<安装时锁定的精确版本>"
  },
  "devDependencies": {
    "electron": "<安装时锁定的精确版本>",
    "electron-builder": "<安装时锁定的精确版本>",
    "typescript": "<安装时锁定的精确版本>",
    "vitest": "<安装时锁定的精确版本>"
  }
}
```

安装时选择当前稳定版本并提交 lockfile，不使用模糊版本漂移。`electron-updater` 必须放在 `dependencies`，不能只放 `devDependencies`。

---

## 6. Phase 0：构建基线和统一命令

### 目标

在引入 Electron 前先保证现有 client/server 可重复构建。

### 文件改造

#### 6.1 新建 `dev/package.json`

只负责统一编排，不把现有 client/server 立即迁移为 npm workspace，避免无关 lockfile 大改。

建议命令：

```json
{
  "name": "tianshu-dev",
  "private": true,
  "engines": { "node": "24.x" },
  "scripts": {
    "install:all": "npm ci --prefix web/server && npm ci --prefix web/client && npm ci --prefix desktop",
    "build:server": "npm run build --prefix web/server",
    "build:client": "npm run build --prefix web/client",
    "build:desktop": "npm run build --prefix desktop",
    "build": "npm run build:server && npm run build:client && npm run build:desktop",
    "dev": "node scripts/dev-desktop.mjs",
    "prepare:desktop": "node scripts/prepare-desktop-runtime.mjs",
    "dist:win": "npm run build && npm run prepare:desktop && npm run dist:win --prefix desktop",
    "test:desktop": "npm test --prefix desktop"
  }
}
```

如果 npm 在 Windows 下解析 `--prefix` 顺序存在问题，以实际验证可用的写法为准。

#### 6.2 更新 `.gitignore`

加入：

```gitignore
/desktop/dist/
/desktop/release/
/desktop/runtime/
/desktop/staging/
*.log
```

不要忽略 `desktop/package-lock.json` 和根编排 lockfile。

#### 6.3 校验当前构建

必须通过：

```powershell
npm ci --prefix web/server
npm ci --prefix web/client
npm run build --prefix web/server
npm run build --prefix web/client
```

### Phase 0 验收

- [x] client 全新安装依赖后构建成功。
- [x] server 全新安装依赖后构建成功。
- [x] 没有提交 `node_modules`、`dist` 或 staging 文件。
- [x] Node 版本要求统一且有明确错误提示。

---

## 7. Phase 1：后端生命周期与生产静态托管

### 目标

把当前“一 import 就启动”的 server 改为可被 CLI 和 Electron 子进程共同使用。

### 7.1 新建 `web/server/src/app.ts`

导出接口：

```ts
export interface StartServerOptions {
  host?: string
  port?: number
  clientDist?: string
  corsOrigins?: string[]
}

export interface TianshuServer {
  host: string
  port: number
  url: string
  close(): Promise<void>
}

export async function startTianshuServer(
  options: StartServerOptions = {},
): Promise<TianshuServer>
```

职责：

1. 初始化 DB 和工具 registry。
2. 创建 Hono 路由。
3. 注册 Socket.IO。
4. 启动 scheduler 和 asset GC。
5. 监听 `host`/`port`。
6. 当端口为 `0` 时从 `httpServer.address()` 读取实际端口。
7. 返回 `close()`，按顺序关闭：定时器 → Socket.IO → HTTP server → DB。

### 7.2 精简 `web/server/src/index.ts`

它只作为 CLI/子进程入口：

```ts
const server = await startTianshuServer({
  host: process.env.HOST || '127.0.0.1',
  port: Number(process.env.PORT || 3456),
  clientDist: process.env.TIANSHU_CLIENT_DIST,
})
```

启动完成后：

- 如果存在 `process.send`，发送 `{ type: 'ready', port }`。
- 否则打印普通启动日志。

监听父进程消息：

```ts
process.on('message', async message => {
  if (message?.type !== 'shutdown') return
  await server.close()
  process.exit(0)
})
```

同时监听 `SIGINT`、`SIGTERM`，执行同一个幂等 shutdown。避免重复关闭。

全局 `uncaughtException`/`unhandledRejection` 不得只打印后继续运行：

- 记录错误。
- 尝试关闭服务。
- 以非零状态退出，让 Electron 能发现 server 崩溃。

### 7.3 给定时器增加停止接口

修改：

- `web/server/src/event/event-scheduler.ts`
- `web/server/src/character/asset-gc.ts`

分别导出：

```ts
export function stopEventScheduler(): void
export function stopAssetGC(): void
```

要求：

- `clearInterval()`。
- timer 置为 `null`。
- start/stop 都必须幂等。

### 7.4 生产静态托管

当 `clientDist` 存在时，Hono 同源托管 React 构建产物：

- `/api/**` 保持 API 路由优先。
- `/socket.io/**` 继续由 Socket.IO 接管。
- `/assets/*` 使用长期缓存：`public, max-age=31536000, immutable`。
- `index.html` 使用 `no-cache`。
- 未匹配且不是 API/socket 的 GET 请求回退 `index.html`，支持 React Router。
- 路径必须经过规范化，禁止 `..` 穿越 `clientDist`。

生产环境不再使用 `cors('*')`。同源时不需要 CORS；开发环境只允许 `http://127.0.0.1:3457` 和 `http://localhost:3457`。

### 7.5 修正依赖运行路径

检查并修复依赖 `process.cwd()` 的生产路径，尤其是：

- `web/server/src/tools/truncate.ts`
- `web/server/src/routes/workspace.ts`
- MCP workspace 替换逻辑

运行数据不得落到 Electron 安装目录。优先使用 `getDataDir()`；“项目根目录”必须表达用户选择的 workspace，而不是打包资源目录。

### Phase 1 测试

新增 server 生命周期测试：

1. `TIANSHU_DATA_DIR` 指向临时目录。
2. `startTianshuServer({ host:'127.0.0.1', port:0 })`。
3. 请求 `/health` 返回 200。
4. 调用 `close()`。
5. 验证端口可重新绑定。
6. 重复 `close()` 不抛错。

### Phase 1 验收

- [x] `npm run dev --prefix web/server` 仍可独立运行。
- [x] `PORT=0` 可以报告实际端口。
- [x] 父进程 IPC 能收到 ready。
- [x] shutdown 后 HTTP、Socket.IO、DB 和 timer 均关闭。
- [x] client build 可由 server 同源访问并支持刷新子路由。

---

## 8. Phase 2：Electron 壳、内置 Node 和安装包

### 目标

生成能安装、启动和卸载的 Windows x64 Electron 客户端；本阶段先不接自动更新。

### 8.1 `desktop/src/server-manager.ts`

职责：

- 开发模式不管理 server，直接使用 `TIANSHU_DEV_URL`。
- 生产模式定位：
  - `process.resourcesPath/runtime/node/node.exe`
  - `process.resourcesPath/server/dist/index.js`
  - `process.resourcesPath/client`
- 使用 `child_process.fork()`，并指定 `execPath` 为内置 Node。
- 环境变量：

```text
HOST=127.0.0.1
PORT=0
NODE_ENV=production
TIANSHU_CLIENT_DIST=<resources/client>
TIANSHU_CONFIG_DIR=<Electron userData>
TIANSHU_DEFAULT_DATA_DIR=<Electron userData>/data
```

- 等待 `{type:'ready'}`，默认超时 30 秒。
- 捕获 stdout/stderr，写入 `<userData>/logs/server.log`，日志轮转至少保留最近 5 个文件或限制总大小。
- server 在 ready 前退出时，向 UI 显示可理解的启动失败信息。
- server 在运行中意外退出时，不无限重启；最多自动重启 1 次，随后提示用户查看日志。
- `stop()` 发送 `{type:'shutdown'}`，等待最多 8 秒，超时才强制终止进程树。

不要用固定 3456 作为生产端口。

### 8.2 `desktop/src/main.ts`

启动顺序：

```text
app.requestSingleInstanceLock()
  ↓
app.whenReady()
  ↓
准备 userData/logs
  ↓
启动 server 或确认 dev URL
  ↓
创建 BrowserWindow
  ↓
加载 URL
  ↓
窗口 ready-to-show 后显示
```

BrowserWindow 安全设置：

```ts
webPreferences: {
  preload: PRELOAD_PATH,
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
}
```

要求：

- 禁止 renderer 获得 Node 能力。
- 拦截 `setWindowOpenHandler`，外链只允许通过 `shell.openExternal()` 打开 `https:`。
- 拒绝任意 `file:`、`javascript:` 和未知协议。
- 限制导航到启动时确定的本地 origin。
- 实现单实例；第二次启动时聚焦已有窗口。
- `before-quit` 中先关闭 server，再退出。
- Windows `window-all-closed` 正常退出；第一版不做托盘常驻。

### 8.3 数据配置迁移

修改 `web/server/src/config.ts`：

配置优先级：

```text
1. TIANSHU_DATA_DIR
2. <TIANSHU_CONFIG_DIR>/config.json
3. TIANSHU_DEFAULT_DATA_DIR
4. 兼容旧值 C:\.Tianshu
```

`setDataDir()` 必须写入 `TIANSHU_CONFIG_DIR/config.json`，不能写入 server dist。

首次 Electron 启动兼容规则：

- 如果新配置不存在，但 `C:\.Tianshu` 存在且包含已有数据，继续使用旧目录并写入新配置。
- 如果没有旧数据，默认使用 `<userData>/data`。
- 不自动搬迁大量用户数据；只记录选中的目录。
- 用户从设置页切换目录时沿用现有 reload 流程。

增加原生目录选择：设置页“配置路径”旁增加“选择目录”按钮，通过 preload 调用 Electron dialog。

### 8.4 `prepare-desktop-runtime.mjs`

此脚本创建完全可丢弃的构建 staging：

1. 清空并重建 `desktop/staging` 和 `desktop/runtime` 的明确子目录；删除前校验目标位于 `dev/desktop` 内。
2. 从 Node 官方发行地址下载固定 Node 24 win-x64 ZIP。
3. 下载官方 `SHASUMS256.txt`，校验 ZIP SHA-256。
4. 解压为 `desktop/runtime/node/`。
5. 复制 `web/client/dist/**` 到 `desktop/staging/client/**`。
6. 复制 server 的：
   - `dist/**`
   - `package.json`
   - `package-lock.json`
7. 在 staging server 中执行 `npm ci --omit=dev --no-audit --no-fund`。
8. 用内置 Node 实际运行一个 smoke 脚本，确认：
   - Node 版本正确。
   - `better-sqlite3` 可以 require/import。
   - server 可以启动并响应 `/health`。

不要直接复制开发机的 `web/server/node_modules`，避免把无关文件、错误 ABI 或开发依赖带入安装包。

### 8.5 `electron-builder.yml`

核心配置：

```yaml
appId: cn.tianshu.desktop
productName: 天枢
asar: true

directories:
  output: release
  buildResources: assets

files:
  - dist/**/*
  - package.json

extraResources:
  - from: runtime/node
    to: runtime/node
  - from: staging/server
    to: server
  - from: staging/client
    to: client

win:
  target:
    - target: nsis
      arch: [x64]
  artifactName: TianShu-Setup-${version}-${arch}.${ext}

nsis:
  oneClick: false
  perMachine: false
  allowToChangeInstallationDirectory: true
  createDesktopShortcut: true
  createStartMenuShortcut: true
  deleteAppDataOnUninstall: false
```

要求：

- updater 只能更新应用资源，不能触碰 userData。
- 卸载默认保留用户数据，并在卸载说明中明确。
- 安装包名称只使用 ASCII，减少下载/CDN/脚本兼容问题。
- 应用显示名可以使用中文“天枢”。

### 8.6 图标

必须提供真正的多尺寸 `icon.ico`，至少包含 16/24/32/48/64/128/256。不能直接把 JPG 改扩展名。

如果仓库现有 logo 不适合小尺寸，需要单独生成简化图标，但这不阻塞代码结构开发。

### Phase 2 验收

- [x] `npm run dist:win` 生成 NSIS `.exe`。
- [x] 干净 Windows 用户环境无需安装 Node 即可启动。
- [x] 只出现一个天枢桌面窗口，不打开浏览器和命令行窗口。
- [x] API、Socket.IO、SQLite、MCP 基础页面可用。
- [x] 任务管理器能看到 Electron 和内置 Node 子进程。
- [x] 退出客户端后 Node 子进程消失。
- [x] 再次启动不会报端口占用。
- [x] 安装目录只读时仍可保存配置和数据库。
- [x] 覆盖安装不会删除用户数据。

---

## 9. Phase 3：更新 IPC、状态机和前端 UI

### 目标

接入完整的客户端内更新体验，但先允许使用本地测试 feed 验证。

### 9.1 共享 contract

新建 `dev/shared/desktop-contract.ts`：

```ts
export type UpdatePhase =
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface DesktopAppInfo {
  version: string
  platform: 'win32' | 'darwin' | 'linux'
  arch: string
  packaged: boolean
}

export interface UpdateState {
  phase: UpdatePhase
  currentVersion: string
  targetVersion?: string
  releaseName?: string
  releaseNotes?: string
  releaseDate?: string
  percent?: number
  transferred?: number
  total?: number
  bytesPerSecond?: number
  checkedAt?: string
  message?: string
}

export interface TianShuDesktopAPI {
  getAppInfo(): Promise<DesktopAppInfo>
  getUpdateState(): Promise<UpdateState>
  checkForUpdates(): Promise<UpdateState>
  downloadUpdate(): Promise<void>
  installUpdate(): Promise<void>
  onUpdateState(listener: (state: UpdateState) => void): () => void
  openDirectoryDialog(defaultPath?: string): Promise<string | null>
}
```

如果前端 tsconfig 无法引用 `dev/shared`，调整 `include`/alias；不要复制两份会漂移的类型。

### 9.2 preload

`desktop/src/preload.ts` 只暴露白名单 API：

```ts
contextBridge.exposeInMainWorld('tianshuDesktop', {
  getAppInfo: () => ipcRenderer.invoke('desktop:get-app-info'),
  getUpdateState: () => ipcRenderer.invoke('updater:get-state'),
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  downloadUpdate: () => ipcRenderer.invoke('updater:download'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),
  openDirectoryDialog: defaultPath => ipcRenderer.invoke('desktop:open-directory', defaultPath),
  onUpdateState: listener => {
    const handler = (_event, state) => listener(state)
    ipcRenderer.on('updater:state', handler)
    return () => ipcRenderer.removeListener('updater:state', handler)
  },
})
```

不得暴露通用 `send(channel, payload)`。

更新 `web/client/src/types/electron.d.ts`：

```ts
interface Window {
  tianshuDesktop?: TianShuDesktopAPI
}
```

删除旧的 `electronAPI` 草案，避免两个 API 并存。

### 9.3 updater 状态机

`desktop/src/updater.ts` 包装 `electron-updater`：

- 仅 `app.isPackaged` 时启用。
- `autoDownload = false`。
- `autoInstallOnAppQuit = true`。
- 禁止 downgrade。
- 同一时间只允许一个检查和一个下载任务。
- 将所有事件转换成 `UpdateState` 并广播给所有窗口。
- 保留最后状态，窗口刷新后可通过 `getUpdateState()` 恢复。

事件映射：

| electron-updater | UpdateState.phase |
|---|---|
| `checking-for-update` | `checking` |
| `update-available` | `available` |
| `update-not-available` | `not-available` |
| `download-progress` | `downloading` |
| `update-downloaded` | `downloaded` |
| `error` | `error` |

行为规则：

- 应用窗口 ready 后延迟 5–10 秒执行一次后台检查。
- 后台检查没有更新时不弹系统对话框。
- 手动检查由前端显示结果。
- 发现更新后不自动下载，用户点击“下载更新”。
- 下载完成后用户选择“立即重启安装”或稍后退出时安装。
- `installUpdate()` 前：
  1. 禁止重复调用。
  2. 调用 `serverManager.stop()`。
  3. 刷新日志。
  4. 调用 `autoUpdater.quitAndInstall(false, true)`。
- 更新错误不得导致应用退出。
- 日志写入 `<userData>/logs/updater.log`，错误信息向 UI 去除本地敏感路径后展示。

### 9.4 React hook

新建 `web/client/src/features/update/useDesktopUpdater.ts`：

- 初始化读取 `getAppInfo()` 和 `getUpdateState()`。
- 订阅 `onUpdateState()`。
- component unmount 时必须取消监听。
- 浏览器开发模式下返回 `disabled`，页面仍可正常使用。
- 暴露 `check`、`download`、`install`。

### 9.5 更新面板

新建 `UpdatePanel.tsx` 并嵌入 `SettingsPage.tsx` 的“关于”tab。

UI 状态：

```text
当前版本：v0.1.0
更新渠道：Stable

idle/not-available      [检查更新]
checking                正在检查…
available               发现 v0.1.1 [下载更新]
downloading             进度条 67% / 83MB / 124MB
downloaded              [立即重启安装] [稍后]
error                   错误摘要 [重试]
disabled                仅打包客户端支持自动更新
```

显示 release notes 时：

- 以纯文本或经过严格白名单清洗的 Markdown 渲染。
- 禁止直接 `dangerouslySetInnerHTML`。
- 限制最大展示长度，避免异常 feed 卡死页面。

将当前写死的 `v0.1.0` 和无行为“检查”按钮删除。

### Phase 3 测试

给 updater 状态转换逻辑做单元测试，使用假的 EventEmitter updater，不直接访问网络：

- available 状态字段完整。
- progress 数值截断到 0–100。
- error 可恢复后再次 check。
- 重复 check 不发起第二个请求。
- downloaded 后 install 先调用 server stop。
- renderer listener 能正确移除。

### Phase 3 验收

- [x] 浏览器开发模式设置页不报 `window.tianshuDesktop` 未定义。
- [x] Electron 开发模式显示真实 app info，但 updater 显示 disabled。
- [x] 打包模式显示真实版本。
- [x] 前端按钮通过 IPC 工作，不直接 fetch GitHub。
- [x] 状态订阅没有重复 listener 和内存泄漏。
- [x] 更新安装前 server 被关闭。

---

## 10. Phase 4：GitHub Releases 发布管线

### 目标

通过 Git tag 自动构建 Windows 安装包，并发布到公开的 Release 仓库。

### 10.1 Release 仓库决策

推荐创建独立公开仓库，例如：

```text
dmql98/tianshu-releases
```

它只保存 Releases，不放天枢源码。源码仓库可以继续私有。

如果最终选择直接在当前仓库发布，OpenCode 只调整 workflow 的目标仓库，客户端 contract 和 updater 不变。

### 10.2 electron-builder publish 配置

```yaml
publish:
  provider: github
  owner: dmql98
  repo: tianshu-releases
  releaseType: release
```

不要在客户端内放 GitHub token。公开 Release 下载不需要客户端 token。

### 10.3 Workflow 位置

必须创建在 Git 仓库根目录：

```text
TianShu/.github/workflows/desktop-release.yml
```

不能放到 `dev/.github`。

### 10.4 触发与步骤

触发：

```yaml
on:
  push:
    tags:
      - 'v*.*.*'
  workflow_dispatch:
```

Windows job：

1. Checkout 精确 tag。
2. Setup 固定 Node 24.x。
3. 分别 `npm ci`：server、client、desktop。
4. 运行 server/client/desktop 测试。
5. `verify-release-version.mjs` 校验 tag 与 package version。
6. 构建 server/client/desktop。
7. 下载并校验内置 Node runtime。
8. 创建 production server staging。
9. 执行 packaged smoke test。
10. electron-builder 生成 NSIS。
11. 校验产物存在：
    - `TianShu-Setup-<version>-x64.exe`
    - `.exe.blockmap`
    - `latest.yml`
12. 上传到公开 Release 仓库。
13. 安装包和 blockmap 上传成功后，最后上传/覆盖 `latest.yml`。

如果使用独立 Release 仓库：

- GitHub 默认 `GITHUB_TOKEN` 不能直接写另一个仓库。
- 创建最小权限 fine-grained token，只允许目标 Release 仓库 contents write。
- 保存为源码仓库 secret：`RELEASES_TOKEN`。
- 不把 token 输出到日志。

### 10.5 Windows 代码签名

自动更新功能可以先用未签名内部测试包验证，但“大范围分发”的完成条件包括代码签名，否则 SmartScreen 会显著阻碍用户安装。

预留 secrets：

```text
WIN_CSC_LINK
WIN_CSC_KEY_PASSWORD
```

workflow 只从 secrets 注入，仓库不得出现证书和密码。

如果首版暂时未购买证书：

- CI 明确输出 unsigned 警告。
- Release 标记为测试版或早期预览。
- 不伪装为已签名正式版。

### 10.6 Release 内容

Release notes 至少包括：

- 版本号。
- 主要新增和修复。
- 是否需要用户操作。
- 数据兼容说明。
- 安装包 SHA-256（供人工校验；updater 自身使用生成的 SHA-512 metadata）。

### Phase 4 验收

- [x] 推送测试 tag 后 workflow 能在全新 runner 构建。（run #9 在 windows-latest 全绿）
- [x] Release 中三个 updater 必需文件齐全。（v0.1.0 单个 Release 含 exe/blockmap/latest.yml）
- [x] `latest.yml` 的文件名、size、sha512 与安装包一致。（已实测：size=140976652、sha512=i9oagk… 一致）
- [x] Release 公开访问且无需登录。（仓库公开，匿名下载 200）
- [x] 客户端没有 GitHub token。（app-update.yml 仅含 provider/owner/repo）
- [x] 构建日志没有泄露 secret。（workflow 仅经 env 传递 GH_TOKEN，从不 echo）
- [x] 已决策：直接在公开源码仓库 `dmql98/tianshu` 发布 Release（§10.1 允许路径），使用默认 `GITHUB_TOKEN`；发布改用 `gh release create/upload`（避免 electron-builder 并发创建同 tag Release 的竞态）。客户端 contract 与 updater 不变。

---

## 11. Phase 5：真实升级闭环测试

### 目标

不是只验证“能检查”，而是验证旧安装版能完整升级到新版本。

### 11.1 测试版本

准备两个连续版本：

```text
v0.1.0  基线安装包
v0.1.1  更新测试包（UI 增加可见版本标记）
```

### 11.2 必测路径

#### 全新安装

1. 在未装 Node 的 Windows 用户环境安装 v0.1.0。
2. 启动天枢。
3. 设置数据目录并创建测试会话。
4. 退出、重启，确认数据存在。

#### 自动检查

1. 发布 v0.1.1。
2. 启动 v0.1.0。
3. 等待后台检查。
4. 确认 UI 显示有更新，但不会自动下载。

#### 手动更新

1. 点击检查更新。
2. 点击下载。
3. 观察进度。
4. 点击立即重启安装。
5. 确认 Node server 先退出。
6. 确认安装完成并自动启动 v0.1.1。

#### 数据保留

升级后确认：

- 数据目录配置仍在。
- `sessions.db` 可打开。
- Provider 配置仍在。
- 角色、技能、MCP 配置仍在。
- 旧会话可以继续使用。

#### 失败恢复

至少测试：

- 离线检查更新。
- 下载中断后重新下载。
- GitHub 返回错误。
- 磁盘空间不足时显示错误且旧版本可继续用。
- server 无法关闭时 updater 超时处理。
- 用户点击“稍后”，正常退出后安装。

### 11.3 不允许的结果

- 更新失败后客户端无法再次启动。
- 出现两个 server 占用不同端口长期残留。
- 安装器删除或重置用户数据。
- renderer 获得 Node 权限。
- 版本号更新但实际资源仍为旧版。

### Phase 5 验收

- [ ] v0.1.0 → v0.1.1 完整升级成功。
- [ ] 更新前后数据 hash/关键记录一致。
- [ ] 失败场景不会破坏当前已安装版本。
- [ ] 更新日志可定位失败原因。

---

## 12. Phase 6：文档和发布交付

### 必须更新的文档

1. 根 `README.md`：
   - Windows 安装方式。
   - 数据目录位置。
   - 手动检查更新入口。
   - 日志位置。
2. `docs/分发更新方案.md`：
   - 标记旧的自研 server 替换方案已被本方案取代。
   - 保留“未来内容更新与 App 更新分离”的概念。
3. 新增发布手册 `docs/桌面客户端发布手册.md`：
   - 修改版本号。
   - 更新 changelog。
   - 本地构建。
   - 打 tag。
   - 查看 CI。
   - 验证 Release。
   - 回滚/撤下错误版本。

### Phase 6 验收

- [ ] 新开发者只按 README 能启动 Electron 开发模式。
- [ ] 发布者只按发布手册能生成一个 Release。
- [ ] 文档不再同时推荐两套互相冲突的 updater。

---

## 13. 推荐提交拆分

不要一次提交全部功能。推荐形成以下可审查提交：

1. `build: add desktop build baseline and pin node runtime`
2. `refactor(server): expose start and graceful shutdown lifecycle`
3. `feat(server): serve production client assets on loopback`
4. `feat(desktop): add electron shell and bundled node server`
5. `fix(config): persist desktop config outside install directory`
6. `feat(desktop): add secure preload updater contract`
7. `feat(settings): add version and update controls`
8. `ci: publish windows desktop releases`
9. `test: cover packaged startup and update state transitions`
10. `docs: add desktop development and release guide`

每个提交都应能独立解释目的，避免夹带商城或无关 UI 重构。

---

## 14. 完成定义（Definition of Done）

只有全部满足才算本计划完成：

### 客户端形态

- [ ] 用户获得标准 Windows `.exe` 安装包。
- [ ] 用户不需要安装 Node、npm 或打开浏览器。
- [ ] 启动后只看到天枢桌面窗口。
- [ ] 单实例工作正常。

### 运行稳定性

- [ ] 内置 server 只监听 loopback 动态端口。
- [ ] server ready、异常和 shutdown 有可靠 IPC。
- [ ] 退出后无残留 Node 进程。
- [ ] 安装目录不可写时应用仍正常工作。

### 数据安全

- [ ] 配置和数据库不在安装目录。
- [ ] 安装、覆盖安装、自动更新不删除用户数据。
- [ ] 旧 `C:\.Tianshu` 数据可继续使用。

### 更新体验

- [ ] 启动后自动静默检查一次。
- [ ] 设置 → 关于可手动检查。
- [ ] 显示当前版本、目标版本、更新说明和进度。
- [ ] 用户确认后才下载。
- [ ] 可立即重启安装或稍后安装。
- [ ] 更新失败不影响继续使用当前版本。

### 发布

- [ ] Git tag 能触发 Windows CI。
- [ ] GitHub Release 包含 exe、blockmap、latest.yml。
- [ ] 公开下载不需要登录。
- [ ] 完成一次真实的旧版到新版升级测试。

### 安全

- [ ] `contextIsolation=true`、`nodeIntegration=false`。
- [ ] preload 只暴露白名单方法。
- [ ] 没有 GitHub token、证书或密码进入客户端。
- [ ] 外链和导航受到限制。
- [ ] 正式大范围发布包完成 Windows 代码签名。

---

## 15. 后续商城阶段的衔接点（本次不实现）

基础客户端完成后，商城作为另一条 roadmap：

```text
Phase Store-0  用户系统、登录和设备标识
Phase Store-1  商品目录和用户权益
Phase Store-2  角色/皮肤/技能包签名与鉴权下载
Phase Store-3  支付、订单和后台
Phase Store-4  内容安装、更新、卸载和回滚
```

商城内容必须安装到用户数据目录，例如：

```text
<dataDir>/packages/<packageId>/<version>/
```

不得写入 Electron 安装目录，也不得通过 GitHub Releases 公开分发付费内容。

App updater 与 Store downloader 必须始终是两个模块：

```text
electron-updater       只更新公开客户端
store package manager  只更新登录用户有权限的内容
```

---

## 16. OpenCode 最终交付报告模板

完成开发后按以下格式汇报：

```markdown
## 已完成
- Phase 0 ...
- Phase 1 ...

## 主要文件
- path: 用途

## 构建产物
- 安装包路径
- 版本
- SHA-256

## 验证结果
- 命令：结果
- v0.1.0 → v0.1.1：结果

## 未完成/风险
- Windows 签名状态
- GitHub Release 仓库状态
- 仍需人工配置的 secrets

## 用户数据验证
- 旧目录兼容结果
- 更新前后数据结果
```

如果因账号、证书或 GitHub secret 缺失不能完成外部发布，代码、构建、测试和本地 updater feed 验证仍需完成，并明确列出唯一外部阻塞项。
