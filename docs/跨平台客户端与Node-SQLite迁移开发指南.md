# 天枢跨平台客户端与 Node SQLite 迁移开发指南

> 文档性质：开发交接与实施规范  
> 适用仓库：`dmql98/tianshu`  
> 基线日期：2026-08-16  
> 当前桌面版本基线：`dev/desktop/package.json` 中的版本  
> 目标平台：Windows x64、macOS x64、macOS arm64、Linux x64  
> 明确不支持：Windows 32 位、Linux 32 位、Mac App Store、Microsoft Store

## 1. 文档目标

本文档用于把当前“仅 Windows x64”的天枢桌面端改造成可从同一个 GitHub Release 分发的多平台客户端，并把服务端数据库驱动从 `better-sqlite3` 迁移到 Node 内置的 `node:sqlite`。

交付完成后，新用户应能下载对应平台的安装包；已安装用户应能继续通过 `electron-updater` 获取对应平台和架构的更新；已有 `sessions.db` 必须原地兼容，用户配置、对话、角色、技能和工作区数据不得丢失。

本次工作包含四条主线：

1. 用 `node:sqlite` 替代 `better-sqlite3`，消除额外的 SQLite 原生插件和 ABI 风险。
2. 把内置 Node 运行时准备逻辑从 `win-x64` 硬编码改为平台/架构驱动。
3. 把 Electron 主进程、服务进程管理、图标、安装目标和冒烟测试平台化。
4. 把单一 Windows 发布任务改成各平台原生构建、统一汇总并发布的 CI 流水线。

本文档不是“把一个 Windows EXE 直接变成跨平台程序”。每个平台仍需自己的 Electron、Node 和安装包；跨平台指绝大部分 TypeScript/React/Node 业务代码复用。

## 2. 已锁定的产品决策

后续 Agent 除非获得用户明确授权，不要重新讨论或改变以下决策。

### 2.1 支持矩阵

| 平台 | 架构 | 新用户下载 | 自动更新载荷 | 状态 |
| --- | --- | --- | --- | --- |
| Windows 10/11 | x64 | NSIS `.exe` | `.exe` + `.blockmap` + `latest.yml` | 必须 |
| macOS | arm64 | `.dmg` | `.zip` + `latest-mac.yml` | 必须 |
| macOS | x64 | `.dmg` | `.zip` + `latest-mac.yml` | 必须 |
| Linux | x64 | `.AppImage` | `.AppImage` + `latest-linux.yml` | 必须 |
| Debian/Ubuntu | x64 | `.deb` | 由新版本手动安装或系统包管理器处理 | 可选 |
| Windows | ia32 | 无 | 无 | 不支持 |
| Linux | ia32/armv7l | 无 | 无 | 不支持 |

Windows 32 位不支持的原因不是单个依赖：Node 24 已无官方 Windows x86 运行时，Electron 43 是最后一个提供 Windows x86 预编译产物的系列，Electron 44 起取消支持。因此不要通过降级 Electron/Node 的方式换取一个即将失去安全维护的版本。

### 2.2 macOS 架构策略

首版发布两个独立包：`mac-x64` 和 `mac-arm64`，不先做 Universal App。

原因：天枢额外携带独立 Node 运行时。Universal Electron 外壳并不能自动把两个 Node 运行时合成一个通用二进制；先做独立包更容易验证、签名、定位问题和控制体积。

### 2.3 Linux 分发策略

首版以 x64 AppImage 为正式自动更新渠道；`.deb` 仅作为安装便利包。不要承诺 `.deb` 通过 `electron-updater` 自更新。

### 2.4 数据库策略

保留 SQLite 文件格式和现有 `sessions.db`，只替换 Node 驱动。不得迁移到远程数据库，不得更改用户数据目录，不得要求用户导出/导入数据。

### 2.5 发布策略

所有平台共用一个版本号、一个 Git tag、一个 GitHub Release。各构建任务只上传 GitHub Actions artifact；最终发布任务是唯一有权创建 Release、上传 Release assets 和覆盖更新元数据的任务。

严禁 Windows/macOS/Linux 构建任务并发调用 `gh release create` 或直接覆盖 `latest*.yml`。

## 3. 当前实现基线

### 3.1 当前运行结构

```text
Electron main
  ├─ BrowserWindow -> 本机 HTTP 服务
  ├─ electron-updater -> GitHub Releases
  └─ ServerManager
       └─ fork(内置 Node, web/server/dist/index.js)
            ├─ Hono / Socket.IO
            ├─ SQLite
            └─ React 静态资源
```

用户数据位于 Electron `userData` 和用户选择的数据目录中，不在安装目录。更新和跨平台改造不得触碰这些数据。

### 3.2 当前 Windows/x64 硬编码

必须至少检查和修改以下位置：

| 文件 | 当前问题 | 目标 |
| --- | --- | --- |
| `dev/desktop/electron-builder.yml` | 只有 NSIS x64 | 增加 macOS、Linux 配置和架构化文件名 |
| `dev/desktop/package.json` | 只有 `dist:win` | 增加目标平台脚本 |
| `dev/package.json` | 只有 `dist:win` | 增加通用 prepare/dist 命令 |
| `dev/scripts/prepare-desktop-runtime.mjs` | 固定 `win-x64.zip`、`node.exe` | 接收 `--platform`、`--arch` 并下载对应 Node |
| `dev/scripts/smoke-packaged.mjs` | 文案和 SQLite 检查绑定 `better-sqlite3` | 检查 `node:sqlite` 和目标 Node |
| `dev/desktop/src/main.ts` | 固定 `runtime/node/node.exe` | 通过平台函数解析 Node 路径 |
| `dev/desktop/src/server-manager.ts` | 强杀固定用 `taskkill` | Windows 使用 `taskkill`，POSIX 使用进程组信号 |
| `dev/web/server/src/db/schema.ts` | 直接导入 `better-sqlite3` | 改为只基于 `node:sqlite` 的项目数据库门面 |
| `dev/web/server/package.json` | 依赖 `better-sqlite3` | 删除原生依赖及类型包 |
| `.github/workflows/desktop-release.yml` | 只有 `windows-latest` | 重构为校验、各平台构建、统一发布 |
| `publish-release.bat` | 产物验证可能只认识 Windows 三件套 | 更新为多平台资产清单或仅保留 tag 触发职责 |
| `docs/桌面客户端发布手册.md` | 只描述 Windows | 实现完成后更新，不得提前宣称支持 |

### 3.3 当前更新机制

Windows 已通过 NSIS、`latest.yml` 和 `.exe.blockmap` 使用差分下载。客户端访问的是完整 EXE URL，但 `electron-updater` 会通过 HTTP Range 只取变化的数据块，在本地重建并校验完整安装包，然后运行安装器。

跨平台后必须保留这个模型：

```text
Windows -> latest.yml
macOS   -> latest-mac.yml
Linux   -> latest-linux.yml（非 x64 架构会有架构后缀，本期不发布）
```

macOS 新用户下载 DMG，但自动更新必须发布 ZIP。一个 `latest-mac.yml` 中必须同时包含 x64 和 arm64 ZIP，且文件名必须带架构，以便 `electron-updater` 选择正确文件。

## 4. 实施总顺序

严格按以下阶段推进。每一阶段都必须能单独测试和回滚，不要一次提交所有改动。

1. Phase 0：冻结基线并增加数据库兼容测试。
2. Phase 1：升级并统一 Node 24 补丁版本。
3. Phase 2：破坏性迁移到 `node:sqlite` 并彻底删除旧驱动。
4. Phase 3：平台化内置 Node 准备脚本和服务进程管理。
5. Phase 4：增加 macOS/Linux electron-builder 配置与本地构建命令。
6. Phase 5：重构 GitHub Actions 为多平台构建和单点发布。
7. Phase 6：完善 updater 日志、差分状态和跨平台 UI 文案。
8. Phase 7：真实安装、升级、签名、公证和回滚验收。
9. Phase 8：更新用户发布手册并正式开放下载。

## 5. Phase 0：基线与数据库兼容测试

### 5.1 先保存真实兼容样本

不要提交用户真实数据库。新增测试 fixture 时，使用测试代码创建一个“旧版本结构”的最小数据库，包含：

- 一个 session；
- 至少一条自增 ID message；
- 一组 turn/run/run_event；
- 一个 character definition/revision；
- 一个 event definition/occurrence；
- WAL 模式；
- 非 ASCII 文本、emoji、空字符串、NULL、BLOB（若当前业务存在）。

测试必须验证当前 `schema.ts` 初始化后旧数据仍可读、迁移幂等、主键与自增行为不变。

### 5.2 增加驱动契约测试

建议新增：

```text
dev/web/server/src/db/sqlite-db.ts
dev/web/server/src/db/sqlite-db.test.ts
dev/web/server/test/db-compatibility.test.ts
```

契约至少覆盖：

- `exec()` 可执行多条 SQL；
- `prepare().run/get/all()`；
- 匿名 `?` 参数；
- `@name` SQL + 不带前缀的对象属性；
- `run().changes`；
- `run().lastInsertRowid`；
- `NULL`、UTF-8、BLOB；
- 正常事务提交；
- 抛错事务回滚；
- 嵌套事务的明确行为；
- `close()`；
- WAL 模式和重新打开数据库；
- 同一个旧数据库被重复初始化两次。

### 5.3 建立数据安全门禁

任何数据库迁移提交必须运行：

```powershell
cd dev
npm test --prefix web/server
```

测试不得读取默认用户数据目录。继续使用临时 `TIANSHU_DATA_DIR`，并在测试结束后关闭数据库句柄。

## 6. Phase 1：统一 Node 版本

### 6.1 版本要求

选择一个固定的 Node 24 LTS 补丁版本，不使用浮动的 `24.x` 作为打包运行时。`node:sqlite` 在 Node 24 可用；建议选择 Node 官方已将该模块标记为 Release Candidate 的版本（不低于 24.15.0），并以实施当日最新、已验证的 Node 24 补丁版为准。

必须同步修改：

- `dev/.node-version`；
- GitHub Actions `actions/setup-node`；
- 运行时准备脚本读取的版本；
- 冒烟测试期望；
- 相关文档。

唯一版本源应是 `dev/.node-version`。`prepare-desktop-runtime.mjs` 必须读取该文件并在内部加 `v`，不要再次硬编码版本。

### 6.2 版本验证

CI 中增加校验：

```text
process.version 去掉 v 后 === dev/.node-version
下载文件名中版本 === dev/.node-version
内置 Node --version === dev/.node-version
```

Node 的 `SHASUMS256.txt` 必须从同一个版本目录下载，并验证目标归档的 SHA-256。校验失败必须立即终止构建，禁止降级为“继续使用缓存”。

## 7. Phase 2：迁移到 `node:sqlite`

### 7.1 迁移原则：只保留一个驱动

Phase 2 完成后，运行时只能存在 `node:sqlite`。不得保留以下任何形式的旧驱动：

- `dependencies`、`devDependencies` 或 `optionalDependencies` 中的 `better-sqlite3`；
- `@types/better-sqlite3`；
- 动态 `import('better-sqlite3')`；
- “`node:sqlite` 失败就回退 better-sqlite3”的双驱动逻辑；
- 针对 `better_sqlite3.node` 的 ABI 检查、复制、打包或下载代码；
- 为了兼容旧驱动而保留的类型声明。

本文所说的“项目数据库门面”不是旧驱动兼容层，也不安装 `better-sqlite3`。它只是把 `DatabaseSync`、事务和项目需要的类型集中到一个模块，唯一底层实现是：

```ts
import { DatabaseSync } from 'node:sqlite'
```

允许并推荐破坏性修改所有 store 调用点，不要求继续模仿 `better-sqlite3` 的完整 API。门面只暴露天枢实际使用的能力：

```ts
export interface RunResult {
  changes: number
  lastInsertRowid: number | bigint
}

export interface TianshuStatement {
  run(...params: any[]): RunResult
  get(...params: any[]): unknown
  all(...params: any[]): unknown[]
}

export interface TianshuDatabase {
  exec(sql: string): void
  prepare(sql: string): TianshuStatement
  close(): void
}

export function withTransaction<TResult>(
  db: TianshuDatabase,
  fn: () => TResult,
): TResult
```

推荐把现有：

```ts
db.transaction(() => {
  // 多条读写
})()
```

统一重构为：

```ts
withTransaction(db, () => {
  // 多条读写
})
```

这样不会把 `better-sqlite3` 特有的“事务工厂返回函数”语义继续带入新实现。

实际实现内部使用：

```ts
import { DatabaseSync } from 'node:sqlite'
```

### 7.2 事务兼容语义

所有现有 `db.transaction(fn)()` 调用都应改成项目的 `withTransaction(db, fn)`；不保留旧调用形态。

外层事务使用 `BEGIN IMMEDIATE`、`COMMIT`、`ROLLBACK`。对于嵌套事务，推荐用 SAVEPOINT，而不是在已有事务中再次执行 `BEGIN`：

```text
外层：BEGIN IMMEDIATE / COMMIT / ROLLBACK
内层：SAVEPOINT / RELEASE / ROLLBACK TO + RELEASE
```

SAVEPOINT 名称必须由内部单调计数器生成，不接受业务输入。异常回滚后必须重新抛出原异常。

不要用“捕获所有 SQLite 错误然后忽略”的方式实现数据库门面。现有 schema 中幂等 ALTER 的局部 `try/catch` 可以在后续迁移系统重构前保留。

### 7.3 参数与返回值约束

创建 `DatabaseSync` 时明确设置与当前行为一致的选项：

- `readBigInts: false`，避免业务代码突然收到 BigInt；
- `allowBareNamedParameters: true`，兼容 SQL 的 `@id` 与对象的 `{ id }`；
- `allowUnknownNamedParameters: false`，底层保持严格；项目数据库门面在调用 `StatementSync` 前过滤 SQL 未引用的额外对象字段，使完整行对象仍可绑定，同时让 SQL 实际引用但对象缺失的参数继续报错；
- 设置合理 `timeout`，避免短暂锁竞争立即失败。

仍需在契约测试中验证这些行为，不要只依赖默认值。

`lastInsertRowid` 在写入 message ID 时继续显式 `Number(...)`。若未来 ID 可能超过 JavaScript 安全整数范围，应另立迁移任务；本次不要扩大范围。

### 7.4 schema.ts 改造

目标结构：

```ts
import { openDatabase, type TianshuDatabase } from './sqlite-db.js'

let db: TianshuDatabase | null = null

export function getDb(): TianshuDatabase {
  if (db) return db
  db = openDatabase(resolve(getDataDir(), 'sessions.db'))
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  // 保留现有建表与迁移
  return db
}
```

注意：当前注释声称外键开启时，要确认实际连接明确执行 `PRAGMA foreign_keys = ON`。这属于数据一致性修正，必须有删除/级联测试后才能启用；如果测试暴露历史孤儿数据，先设计清理迁移，不能直接导致旧数据库启动失败。

### 7.5 删除依赖

数据库门面、全部调用点和测试切换完成后，在同一个 Phase 2 中执行：

```powershell
cd dev/web/server
npm uninstall better-sqlite3 @types/better-sqlite3
```

提交 `package.json` 和 `package-lock.json`。随后确认：

```powershell
rg "better-sqlite3" dev -g "!content/**" -g "!node_modules/**"
```

允许迁移文档和历史记录中出现名称；运行代码、测试脚本、`package.json`、锁文件和打包产物不得再依赖它。仓库中的临时诊断 `.cjs` 文件如果保留，也必须迁移到 `node:sqlite` 或明确移出产品源代码。

验收时还要检查最终生产依赖树：

```powershell
cd dev/web/server
npm ls better-sqlite3
```

期望结果是依赖树中不存在该包，而不是“包存在但当前平台没有加载”。

### 7.6 冒烟测试替换

把原来的原生 ABI 检查改为：

```js
import('node:sqlite').then(({ DatabaseSync }) => {
  const db = new DatabaseSync(':memory:')
  db.exec('CREATE TABLE t(a); INSERT INTO t VALUES (1)')
  const row = db.prepare('SELECT a FROM t').get()
  if (row.a !== 1) process.exit(1)
  db.close()
})
```

冒烟测试仍必须使用“将被打进安装包的 Node”，而不是 CI runner 自带 Node。

## 8. Phase 3：平台化内置 Node 与进程管理

### 8.1 prepare 脚本命令契约

将命令改为显式目标参数：

```text
node scripts/prepare-desktop-runtime.mjs --platform win32 --arch x64
node scripts/prepare-desktop-runtime.mjs --platform darwin --arch arm64
node scripts/prepare-desktop-runtime.mjs --platform darwin --arch x64
node scripts/prepare-desktop-runtime.mjs --platform linux --arch x64
```

如果省略参数，本地开发可以默认 `process.platform/process.arch`；CI 必须显式传入。拒绝不在支持矩阵中的组合。

### 8.2 Node 归档映射

建议用一个纯函数并写单元测试：

| platform | arch | 归档 | 归档内根目录 | 可执行文件 |
| --- | --- | --- | --- | --- |
| win32 | x64 | `node-vX-win-x64.zip` | `node-vX-win-x64` | `node.exe` |
| darwin | x64 | `node-vX-darwin-x64.tar.gz` | `node-vX-darwin-x64` | `bin/node` |
| darwin | arm64 | `node-vX-darwin-arm64.tar.gz` | `node-vX-darwin-arm64` | `bin/node` |
| linux | x64 | `node-vX-linux-x64.tar.xz` | `node-vX-linux-x64` | `bin/node` |

不要为 Windows ia32 添加“隐藏支持”。官方 SHASUM 中没有目标文件时应给出清晰错误。

### 8.3 构建缓存

缓存根目录按以下优先级解析：

1. `TIANSHU_BUILD_CACHE`；
2. Windows `LOCALAPPDATA`；
3. POSIX `XDG_CACHE_HOME`；
4. `os.tmpdir()`。

缓存键必须包含 Node 版本、平台、架构和归档文件名。即使缓存命中也要重新计算 SHA-256；校验失败删除该单个缓存文件并重新下载一次，第二次仍失败则终止。

不得递归删除缓存根目录。

### 8.4 runtime manifest

在 `desktop/runtime` 中生成 `runtime-manifest.json`：

```json
{
  "schemaVersion": 1,
  "nodeVersion": "24.x.y",
  "platform": "darwin",
  "arch": "arm64",
  "archive": "node-v24.x.y-darwin-arm64.tar.gz",
  "sha256": "..."
}
```

打包前和 packaged smoke 都要校验 manifest 与目标平台/架构一致，防止在连续本地构建时把上一平台 runtime 打进下一平台安装包。

### 8.5 Electron 中解析 Node 路径

新增纯函数，例如：

```text
dev/desktop/src/runtime-paths.ts
```

接口建议：

```ts
export function bundledNodePath(resourcesPath: string, platform = process.platform): string
```

规则：

```text
win32 -> resources/runtime/node/node.exe
other -> resources/runtime/node/bin/node
```

启动前验证文件存在和 manifest 匹配。错误应进入 `server.log` 并通过现有 server status 显示可理解的信息，不能只产生 `ENOENT`。

### 8.6 POSIX 进程组

在 macOS/Linux 启动内置服务时，设置 `detached: true`，使服务成为进程组组长。正常停止仍先发送 IPC `{ type: 'shutdown' }`。

超时后：

```text
Windows -> taskkill /PID <pid> /T /F
POSIX   -> process.kill(-pid, SIGTERM)，短暂等待，仍存活再 SIGKILL
```

不要在 POSIX 调用 `taskkill`。为 `server-manager.test.ts` 增加平台注入或 kill 策略注入，避免测试真的杀本机进程。

## 9. Phase 4：electron-builder 多平台配置

### 9.1 文件名必须携带平台与架构

建议产物命名：

```text
TianShu-Setup-<version>-win-x64.exe
TianShu-<version>-mac-x64.dmg
TianShu-<version>-mac-x64.zip
TianShu-<version>-mac-arm64.dmg
TianShu-<version>-mac-arm64.zip
TianShu-<version>-linux-x64.AppImage
TianShu-<version>-linux-x64.deb
```

从旧 Windows 文件名切到带 `win` 的文件名会影响差分更新查找旧 blockmap。若要保持历史 Windows 差分链，首个跨平台版本继续沿用：

```text
TianShu-Setup-<version>-x64.exe
```

推荐 Windows 保持旧命名，只让 macOS/Linux 使用平台化文件名。

### 9.2 electron-builder 配置轮廓

以下是方向示例，Agent 必须用当前安装的 electron-builder 版本验证有效字段：

```yaml
win:
  target:
    - target: nsis
      arch: [x64]
  artifactName: TianShu-Setup-${version}-${arch}.${ext}

mac:
  category: public.app-category.productivity
  target:
    - target: dmg
      arch: [x64, arm64]
    - target: zip
      arch: [x64, arm64]
  artifactName: TianShu-${version}-mac-${arch}.${ext}
  hardenedRuntime: true
  notarize: true

linux:
  category: Utility
  target:
    - target: AppImage
      arch: [x64]
    - target: deb
      arch: [x64]
  artifactName: TianShu-${version}-linux-${arch}.${ext}
```

不要在没有证书的开发构建里强行启用生产 notarization。可以通过单独的开发配置或 CI 环境控制，但正式 Release 必须签名、公证；缺失凭据时发布任务应失败，而不是静默上传未签名 macOS 包。

### 9.3 图标

当前已有 `icon.ico` 和 `icon.png`。macOS 正式包需要 `icon.icns`；Linux 应验证 PNG 尺寸满足桌面环境要求，建议提供 16、32、48、64、128、256、512、1024 多尺寸源。

不要用简单改扩展名生成 ICNS。应从高分辨率无透明边缘错误的源图生成并在真实 macOS Dock/Finder 中验收。

### 9.4 本地脚本

建议提供：

```json
{
  "prepare:desktop": "node scripts/prepare-desktop-runtime.mjs",
  "dist:win": "... --platform win32 --arch x64 ...",
  "dist:mac:x64": "... --platform darwin --arch x64 ...",
  "dist:mac:arm64": "... --platform darwin --arch arm64 ...",
  "dist:linux:x64": "... --platform linux --arch x64 ..."
}
```

macOS 包只在 macOS 主机正式构建，Linux AppImage 只在 Linux 主机正式构建。不要把“electron-builder 命令能启动”当作跨平台产物已验证。

## 10. Phase 5：GitHub Actions 多平台发布

### 10.1 推荐工作流拓扑

```text
validate
  ├─ build-windows-x64
  ├─ build-macos-x64
  ├─ build-macos-arm64
  └─ build-linux-x64
          ↓
     assemble-release
          ↓
      publish-release
          ↓
       verify-release
```

GitHub 托管 runner 标签会变化。实施时从 GitHub 官方文档选择仍受支持的 Intel Mac 与 Apple Silicon runner，并在 workflow 注释里写明 runner 架构；不要假设 `macos-latest` 永远代表同一种 CPU。

### 10.2 validate job

职责：

- checkout 精确 tag；
- 验证 tag 与 `dev/desktop/package.json` 版本一致；
- 验证 `.node-version` 与 setup-node 一致；
- 安装三套依赖；
- 运行 server、desktop、client 相关测试；
- 构建 TypeScript/React；
- 不创建 Release。

如果各构建 job 必须重新构建，也要保留 validate 作为快速、统一门禁；不要在一个 OS 测试通过后跳过其他平台的 packaged smoke。

### 10.3 各平台构建 job

每个 job 必须在全新 runner 中：

1. checkout 同一 tag；
2. setup 固定 Node；
3. `npm ci`；
4. build server/client/desktop；
5. prepare 对应平台 runtime；
6. 使用内置 Node 运行 packaged smoke；
7. electron-builder `--publish never`；
8. 验证产物、更新元数据、哈希和签名状态；
9. `actions/upload-artifact` 上传到 workflow artifact；
10. 不调用 `gh release`。

### 10.4 macOS 签名与公证 secrets

建议使用：

```text
MAC_CSC_LINK
MAC_CSC_KEY_PASSWORD
APPLE_API_KEY
APPLE_API_KEY_ID
APPLE_API_ISSUER
APPLE_TEAM_ID
```

也可使用 Apple ID + app-specific password，但 CI 推荐 App Store Connect API Key。证书、P8、密码不得进入仓库、artifact 或日志。

正式构建至少执行：

```bash
codesign --verify --deep --strict --verbose=2 path/to/TianShu.app
spctl --assess --verbose --type exec path/to/TianShu.app
xcrun stapler validate path/to/TianShu.app
```

### 10.5 assemble-release job

该 job 下载所有 workflow artifacts 到一个空目录，然后执行确定性校验。

必须检查：

- 版本号全部相同；
- 资产名唯一；
- 每个平台新用户安装包存在；
- 每个平台 updater 元数据存在；
- metadata 内 URL 与实际文件名一致；
- metadata 内 size/sha512 与文件一致；
- macOS x64/arm64 ZIP 都出现在最终 `latest-mac.yml`；
- 不存在指向临时路径或 Actions artifact URL 的条目；
- Windows blockmap 未因重命名失去旧版本链。

建议新增脚本：

```text
dev/scripts/assemble-desktop-release.mjs
dev/scripts/verify-desktop-release.mjs
```

不要用脆弱的 shell 文本拼接 YAML。使用 YAML 解析库读取每个平台生成的 metadata，按确定顺序合并并重新写出。

### 10.6 合并 latest-mac.yml

两个 macOS 构建可能各自产生同名 `latest-mac.yml`。最终文件必须合并 `files`，而不是由最后上传的架构覆盖前一个架构。

期望概念结构：

```yaml
version: 0.x.y
files:
  - url: TianShu-0.x.y-mac-arm64.zip
    sha512: ...
    size: ...
  - url: TianShu-0.x.y-mac-x64.zip
    sha512: ...
    size: ...
path: TianShu-0.x.y-mac-x64.zip
sha512: ...
releaseDate: ...
```

`files` 是真实选择来源，文件名中的 `arm64`/`x64` 供 updater 过滤。顶层兼容字段应由合并脚本确定性生成，并通过 x64、arm64 两台真实机器更新验证。

### 10.7 publish job

只有这个 job 拥有 `contents: write`：

1. 若 Release 不存在，创建同 tag Release；
2. 上传普通安装包和更新载荷；
3. 最后上传 `latest.yml`、`latest-mac.yml`、`latest-linux.yml`；
4. 使用 `--clobber` 仅覆盖当前 tag 的同名资产；
5. 发布后重新读取资产清单并验证。

元数据最后上传，避免客户端在安装包尚未就绪时看到新版本。

## 11. Phase 6：自动更新与用户体验

### 11.1 保留现有 IPC 边界

React 不直接访问 GitHub。继续通过：

```text
renderer -> preload -> ipcMain -> UpdateManager -> electron-updater
```

不要在 renderer 中根据 `process.platform` 自己拼 Release URL。

### 11.2 updater 可观测性

当前 `updater.log` 主要记录状态机事件，没有完整记录 electron-updater 内部的差分判断。应接入一个经过脱敏的 logger，至少记录：

- 当前版本、目标版本、平台、架构；
- 选中的 metadata 文件；
- 选中的资产文件名；
- 差分下载开始/成功；
- 差分失败原因和是否回退整包；
- 实际 transferred/total；
- 校验成功；
- 安装启动；
- macOS/Linux 不支持当前安装形态时的明确原因。

日志不得包含 token、Cookie、完整 HTTP headers 或用户本地绝对路径。

### 11.3 UI 文案

设置页和更新弹窗应区分：

```text
安装包大小
本次预计/实际下载量
差分下载或完整下载
下载完成，重启以应用更新
```

不要承诺每次都是增量下载。旧 blockmap/缓存缺失、服务器 Range 异常、跨越历史版本或校验失败时可能回退完整下载。

### 11.4 Linux AppImage 判断

Linux updater 只在受支持的安装形态启用。若用户运行 unpacked、deb 或其他非 AppImage 形态，UI 应显示“当前安装方式请手动下载新版本”，并提供 Release 页面入口，而不是反复报错。

开发模式仍保持 updater disabled。

### 11.5 macOS 安装要求

macOS 自动更新必须使用签名一致的应用。旧版和新版签名身份变化应视为发布阻断。DMG 是新用户入口，ZIP 是 updater 载荷；缺任一 ZIP 或 `latest-mac.yml` 都不得发布 macOS 自动更新。

## 12. Phase 7：测试与验收

### 12.1 单元测试

必须新增或调整：

- Node 归档映射；
- runtime manifest 校验；
- Node 可执行路径解析；
- POSIX/Windows kill 策略；
- SQLite 驱动契约；
- 事务提交/回滚/嵌套；
- updater 平台禁用规则；
- metadata 合并与哈希验证；
- macOS 多架构文件选择；
- Release 资产清单验证。

### 12.2 packaged smoke

每个目标平台/架构必须在打包前使用将被打入包内的 Node 验证：

1. `node --version`；
2. `node:sqlite` 创建、写入、查询、关闭；
3. server 启动并发出 ready IPC；
4. `/health` 返回 200；
5. React 首页可访问；
6. builtin manifest 可读；
7. builtin characters/skills API 有数据；
8. shutdown IPC 后退出码为 0。

### 12.3 新安装验收

每个平台至少在一台干净虚拟机/真机验证：

| 平台 | 验收 |
| --- | --- |
| Windows x64 | 安装、启动、SmartScreen/签名、卸载保留数据 |
| macOS arm64 | DMG 拖入 Applications、Gatekeeper、Dock 图标、公证 |
| macOS x64 | Intel 真机或可靠虚拟环境启动、签名、公证 |
| Linux x64 | AppImage 权限、启动、桌面集成、常见发行版兼容 |

Linux 至少选择当前受支持的 Ubuntu LTS 和一个不同系发行版做冒烟。记录最低 glibc/系统要求，不要仅以 CI runner 能运行作为兼容结论。

### 12.4 真实更新矩阵

对每个平台执行“上一正式版 -> 候选版”：

1. 安装上一版；
2. 创建 session、角色配置和本地文件；
3. 发布仅测试可见的候选 Release 或使用本地 feed；
4. 检查更新；
5. 下载；
6. 记录差分/整包和实际字节数；
7. 重启安装；
8. 确认版本号；
9. 确认 `sessions.db`、配置、角色、技能和工作区不变；
10. 检查 updater/server 日志无敏感信息。

还要覆盖：

- 网络中断后重试；
- metadata 存在但载荷缺失；
- 磁盘空间不足；
- 服务无法优雅退出；
- 差分失败回退完整下载；
- 已是最新版；
- 旧版本跨多个版本升级；
- 错误架构资产不会被选择。

### 12.5 数据库迁移验收

同一个旧版 `sessions.db` 分别在 Windows、macOS arm64、macOS x64、Linux 上打开，验证：

- schema 初始化无错误；
- 历史对话可读；
- 新消息自增 ID 正常；
- run/event/plan 写入正常；
- 事务错误会回滚；
- 重启后 WAL 数据完整；
- 数据库再次回到旧客户端时的兼容性被明确记录。

注意：如果新版 schema 已做不可逆迁移，应用二进制回滚不等于数据库可安全降级。发布说明必须写清楚，不能笼统承诺“可随意降级”。

## 13. 发布资产验收清单

一个完整 Release 至少应有：

```text
latest.yml
latest-mac.yml
latest-linux.yml

TianShu-Setup-<version>-x64.exe
TianShu-Setup-<version>-x64.exe.blockmap

TianShu-<version>-mac-x64.dmg
TianShu-<version>-mac-x64.zip
TianShu-<version>-mac-arm64.dmg
TianShu-<version>-mac-arm64.zip
（electron-builder 实际生成的相关 blockmap 一并上传）

TianShu-<version>-linux-x64.AppImage
（AppImage updater 所需 blockmap/metadata）
TianShu-<version>-linux-x64.deb   # 可选
```

Release 正文应给新用户清晰说明：

- Windows 用户下载哪个 EXE；
- Apple Silicon 和 Intel Mac 分别下载哪个 DMG；
- Linux 用户下载 AppImage 后如何加执行权限；
- Windows 32 位不支持；
- 最低系统版本；
- SHA-256；
- 已知签名/公证状态。

## 14. 失败回滚设计

### 14.1 CI 未发布

任一构建、签名、公证、metadata 合并或校验失败，publish job 不运行，不产生半成品 Release。

### 14.2 Release 已创建但未完成

优先创建 draft Release，所有资产验证通过后再标记 latest/publish。若继续沿用直接发布，必须保证 updater metadata 最后上传。

### 14.3 客户端坏版本

不要修改并复用已被客户端看到的版本号。修复后提升 patch 版本并发布。`allowDowngrade` 继续为 false。

### 14.4 数据库问题

数据库 schema 迁移必须先备份或具备可恢复路径。建议在首次由新驱动打开数据库前，对体积合理的 `sessions.db` 创建一次带版本后缀的备份，并制定保留数量；实现前评估大数据库的磁盘成本。

不得在捕获迁移错误后创建一个空数据库覆盖原文件。

## 15. 安全要求

- 客户端不包含 GitHub token。
- 所有 Release 下载走 HTTPS。
- Node 运行时必须校验官方 SHA-256。
- updater 继续校验 electron-builder metadata 中的 SHA-512。
- macOS 证书/P8、Windows PFX 只来自 CI secrets。
- 日志脱敏本地路径、headers、Cookie 和凭据。
- 安装目录只放应用资源；用户数据只放 userData/数据目录。
- renderer 不获得 Node 权限，不直接调用 updater 或 GitHub API。
- 不为了跨平台关闭 `contextIsolation`、启用 `nodeIntegration` 或取消 sandbox。

## 16. 推荐提交序列

建议按以下粒度提交，便于代码审查和回滚：

1. `test(db): add sqlite driver compatibility fixtures`
2. `chore(runtime): pin one Node 24 LTS patch version`
3. `feat(db): add node sqlite database facade`
4. `refactor(db): replace better-sqlite3 with node:sqlite`
5. `test(runtime): replace native sqlite ABI smoke test`
6. `feat(runtime): prepare bundled Node by platform and arch`
7. `feat(desktop): resolve runtime paths cross-platform`
8. `fix(desktop): manage child process trees on Windows and POSIX`
9. `build(desktop): add macOS and Linux targets`
10. `ci(release): build platform artifacts without publishing`
11. `ci(release): assemble and verify updater metadata`
12. `ci(release): publish all platforms from one job`
13. `feat(updater): expose differential and fallback diagnostics`
14. `docs(release): document platform downloads and signing`

每个提交后运行相关测试；修改代码图后按仓库要求执行：

```powershell
cd dev
graphify update .
```

## 17. Agent 工作规范

接手 Agent 必须遵守：

1. 先运行 `git status --short`，保留用户已有改动。
2. 仓库存在 `.codegraph/`/`graphify-out/` 时，先使用 CodeGraph/graphify 定位调用关系。
3. 不修改用户真实数据目录，不用真实 `sessions.db` 做测试。
4. 不在 Windows 上宣称 macOS 签名/公证已通过。
5. 不在没有真实安装测试时勾选发布验收项。
6. 不把跨平台构建和 Windows 32 位支持混为一谈。
7. 不让多个 CI job 并发创建同一个 GitHub Release。
8. 不手写或猜测 updater metadata 哈希。
9. 不把 DMG 当作 macOS updater 唯一载荷；必须有 ZIP。
10. 不把 DEB 当作已支持 electron-updater 的 AppImage。

## 18. Definition of Done

只有全部满足才能宣告完成：

- [ ] 运行代码、测试、package manifests、锁文件和生产依赖树都不存在 `better-sqlite3`。
- [ ] 不存在双驱动、动态回退或 `better_sqlite3.node` 打包逻辑。
- [ ] 旧 `sessions.db` 兼容测试通过，事务和自增语义一致。
- [ ] Node 版本只有一个源，所有目标运行时经过 SHA-256 校验。
- [ ] Windows x64 packaged smoke 通过。
- [ ] macOS x64 packaged smoke、签名、公证和真实启动通过。
- [ ] macOS arm64 packaged smoke、签名、公证和真实启动通过。
- [ ] Linux x64 AppImage packaged smoke 和真实启动通过。
- [ ] 同一 tag 只产生一个 Release。
- [ ] Windows/macOS/Linux updater metadata 都经过文件名、size、sha512 校验。
- [ ] macOS `latest-mac.yml` 同时包含 x64/arm64 ZIP。
- [ ] 三个平台从上一正式版升级成功并保留用户数据。
- [ ] updater 日志能区分差分成功与整包回退。
- [ ] 发布页面明确告诉新用户下载哪个文件。
- [ ] 文档明确 Windows 32 位不支持。
- [ ] `graphify update .` 已运行，或记录命令不可用原因。

## 19. 外部前置条件与阻塞项

代码可以在没有证书时开发和生成测试包，但正式发布前需要用户提供或配置：

1. Apple Developer Program 账号；
2. Developer ID Application 证书；
3. Apple notarization API Key 或 Apple ID 公证凭据；
4. Windows 代码签名证书（强烈推荐，但不应阻塞 macOS/Linux代码开发）；
5. 至少一台 Apple Silicon Mac 和一个 Intel macOS 验证环境；
6. Linux x64 干净环境；
7. GitHub Actions 对所选 macOS runner 的可用额度。

若这些外部条件缺失，Agent 应完成代码、单元测试、无签名测试包和 CI 草案，并把“正式签名/公证/真机验收”保持为未完成，不得用推测代替验收。

## 20. 官方参考资料

- Node `node:sqlite`：<https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html>
- Node 发行文件与 SHA-256：<https://nodejs.org/dist/>
- Electron 43 与 32 位停止支持说明：<https://www.electronjs.org/blog/electron-43-0>
- Electron planned breaking changes：<https://www.electronjs.org/docs/latest/breaking-changes>
- electron-builder 多平台构建：<https://www.electron.build/docs/features/multi-platform-build/>
- electron-builder macOS targets：<https://www.electron.build/mac/>
- electron-builder AppImage：<https://www.electron.build/docs/appimage/>
- electron-builder macOS 签名：<https://www.electron.build/docs/features/code-signing/code-signing-mac/>
- electron-builder notarization：<https://www.electron.build/docs/notarization/>
- GitHub-hosted runners：<https://docs.github.com/actions/using-github-hosted-runners/about-github-hosted-runners>

---

交接执行原则：先保证数据库兼容和现有 Windows 发布不回退，再逐个平台增加产物。第一阶段成功标准不是“CI 生成了文件”，而是“对应平台能够安装、启动、更新、保留数据并可诊断失败”。
