# 天枢（TianShu）

<p align="center">
  <img src="./dev/web/client/public/logo.png" alt="天枢 Logo" width="120">
</p>

<p align="center">
  面向桌面工作的多角色 AI Agent 系统
</p>

天枢是一个本地运行的 AI Agent 工作台。它不只提供对话，还允许 Agent 读取项目、调用工具、执行命令、委托子 Agent、管理长期目标，并通过角色、技能和 MCP 服务扩展能力。

当前项目主要面向 Windows，已经提供 `setup.bat` 和 `run.bat`，首次安装后可以直接通过批处理脚本启动。

## 桌面客户端（Windows 安装版）

普通用户建议直接使用桌面客户端，**不需要安装 Node.js、npm 或打开浏览器**。

### 安装

1. 打开 GitHub Releases：<https://github.com/dmql98/tianshu/releases>
2. 下载 `TianShu-Setup-<版本>-x64.exe`（安装包目录：`dev/desktop/release/` 用于本地构建产物）。
3. 双击安装（可自选安装目录），安装后从开始菜单或桌面快捷方式启动“天枢”。
4. 未签名的测试包会被 SmartScreen 提示，选择“仍要运行”。

### 数据目录位置

- **应用配置**：`%APPDATA%\tianshu-desktop\config.json`（记录数据根目录，不在安装目录内）。
- **数据根目录**：默认沿用旧版 `C:\.Tianshu`（若已存在数据）；全新环境默认 `%APPDATA%\tianshu-desktop\data`。可在「设置 → 系统 → 配置路径」修改，或用「选择目录」按钮选择。
- 数据库、模型服务、角色、技能、MCP 配置等都保存在数据根目录下。
- 卸载/覆盖安装/自动更新都**不会删除**上述数据。

### 检查更新

- 启动后自动静默检查一次；有更新会提示，不会自动下载。
- 「设置 → 关于」可手动【检查更新】；发现新版本后【下载更新】→【立即重启安装】或稍后退出时安装。

### 日志位置

- 内置服务日志：`%APPDATA%\tianshu-desktop\logs\server.log`
- 更新日志：`%APPDATA%\tianshu-desktop\logs\updater.log`（升级失败时据此定位原因）

### 开发者：Electron 开发模式

```powershell
cd dev
npm ci --prefix web/server
npm ci --prefix web/client
npm ci --prefix desktop
npm run dev
```

`npm run dev` 会启动 Hono/Socket.IO（:3456）、Vite（:3457）并打开一个 Electron 窗口指向 Vite；关闭窗口自动清理。开发模式下自动更新被禁用。

### 发布与维护（开发者）

- 发布流程详见 [`docs/桌面客户端发布手册.md`](docs/桌面客户端发布手册.md)。
- 一键发布脚本（仓库根目录）：`publish-release.bat`（显示当前版本 → 输入更新版本 → 同步 package/lockfile → 确认改动 → commit → 打 tag → 重试推送触发 CI）；`publish-release.bat --dry-run 0.1.3` 可预演，`publish-release.bat --verify` 校验 Release 三文件是否齐全可下载。
- 安装包、`latest.yml` 等构建产物生成在 `dev/desktop/release/`。


## 主要功能

- **Agent 会话**：流式回复、思考内容、工具执行过程、Token 用量与生成速度。
- **消息交互**：复制、编辑用户消息，以及从 Agent 回复创建独立分支会话。
- **角色系统**：为不同角色配置人格、模型、工具、技能、头像和角色资源。
- **执行策略**：支持只读、风险操作确认和自动批准等不同权限策略。
- **子 Agent**：主 Agent 可以委托子任务，并在独立上下文中执行。
- **目标与规划**：支持 Goal、运行状态、计划步骤和长任务管理。
- **工具系统**：内置文件读取、写入、编辑、命令执行、搜索和网页访问等工具。
- **MCP 扩展**：可以接入外部 MCP Server，为 Agent 增加新的工具能力。
- **事件系统**：支持一次性任务、定时任务和事件执行会话。
- **本地数据**：会话、角色、配置和运行数据保存在用户指定的本地目录中。

## 界面预览

### 新建会话

创建会话时，可以在右侧详情面板中选择角色、模型、思考强度、执行模式与审批模式。

<p align="center">
  <img src="./dev/assets/readme/new-chat-character-model.png" alt="新建会话并选择角色与模型" width="100%">
</p>

### 角色配置

角色页面集中管理角色立绘、基础信息、Soul（人格）、User（用户画像）、默认审批模式与运行限制。

<p align="center">
  <img src="./dev/assets/readme/character-profile.png" alt="角色基础信息、Soul 与 User 配置" width="100%">
</p>

每个角色可以独立启用工具和技能包，让不同角色拥有不同的工作能力。

<p align="center">
  <img src="./dev/assets/readme/character-tools.png" alt="为角色启用或停用工具" width="49%">
  <img src="./dev/assets/readme/character-skills.png" alt="为角色绑定或解绑技能包" width="49%">
</p>

### MCP 服务

MCP 页面支持检测本机 MCP、导入 JSON 配置，或手动添加服务。

<p align="center">
  <img src="./dev/assets/readme/mcp-import.png" alt="检测本机 MCP 与导入 JSON 配置" width="100%">
</p>

### 数据存储目录

在“设置 → 系统”中选择天枢的数据根目录；修改后点击刷新，使后端重新加载配置。

<p align="center">
  <img src="./dev/assets/readme/data-directory.png" alt="在系统设置中选择数据存储目录" width="100%">
</p>

## 环境要求

- Windows 10/11
- Node.js 24 LTS（仅开发/构建需要；桌面客户端用户无需安装）
- npm（随 Node.js 一起安装）
- 可用的 OpenAI 兼容模型服务及 API Key

`dev/.node-version` 指定 Node.js `24.14.0`。

## 快速开始

### 1. 安装依赖

进入仓库的 `dev` 目录，双击：

```text
setup.bat
```

也可以在命令行运行：

```bat
cd dev
setup.bat
```

该脚本会：

1. 检查 Node.js 是否可用；
2. 安装后端依赖；
3. 安装前端依赖。

安装只需要在首次使用、依赖发生变化或 `node_modules` 被删除后重新执行。

### 2. 启动天枢

双击：

```text
run.bat
```

脚本会启动两个终端窗口，并自动打开浏览器：

| 服务 | 地址 | 用途 |
|---|---|---|
| 前端 | <http://localhost:3457> | 天枢操作界面 |
| 后端 | <http://localhost:3456> | REST API 与 Socket.IO |
| 健康检查 | <http://localhost:3456/health> | 后端运行状态 |

> [!WARNING]
> `run.bat` 启动前会强制结束正在监听 `3456` 和 `3457` 端口的进程。如果这两个端口正在运行其他程序，请先修改脚本端口或手动启动。

### 3. 完成首次配置

第一次打开天枢时，界面会要求配置数据存储路径：

1. 打开“设置”；
2. 在“系统”中选择数据存储目录；
3. 添加模型服务；
4. 填写服务地址、API Key，并拉取或添加模型；
5. 回到会话页，选择角色和模型后开始使用。

如果没有显式配置数据目录，后端默认使用：

```text
C:\.Tianshu
```

数据目录也可以通过环境变量覆盖：

```bat
set TIANSHU_DATA_DIR=D:\TianShuData
run.bat
```

优先级为：`TIANSHU_DATA_DIR` / `DATA_DIR` → `web/server/config.json` → `C:\.Tianshu`。

## 停止服务

关闭 `run.bat` 启动的以下两个终端窗口：

- `TianShu Server`
- `TianShu Client`

如果端口仍被占用，可以在 PowerShell 中检查：

```powershell
Get-NetTCPConnection -LocalPort 3456,3457 -State Listen
```

## 手动开发

不使用批处理脚本时，可以分别启动前后端。

### 后端

```bat
cd dev\web\server
npm install
npm run dev
```

后端默认监听 `3456`。可以通过 `PORT` 修改：

```bat
set PORT=4000
npm run dev
```

### 前端

为了与 `run.bat` 保持一致：

```bat
cd dev\web\client
npm install
npm run dev -- --port 3457 --host
```

Vite 配置文件中的默认端口是 `5173`；`run.bat` 会在启动时覆盖为 `3457`。前端会把 `/api` 和 `/socket.io` 代理到 `http://localhost:3456`。

## 构建

分别构建前后端：

```bat
cd dev\web\server
npm run build

cd ..\client
npm run build
```

构建结果：

- 后端：`web/server/dist`
- 前端：`web/client/dist`

当前的 `run.bat` 面向开发环境，直接使用 `tsx` 和 Vite 启动，并不读取上述生产构建目录。

## 项目结构

```text
TianShu/
├─ .github/workflows/        # CI：desktop-release.yml（tag 触发构建+发布）
├─ publish-release.bat       # 一键发布脚本（--dry-run / --verify）
├─ docs/                     # 方案与发布手册
└─ dev/
   ├─ package.json           # 统一命令（build/test/dev/dist:win）
   ├─ setup.bat              # 首次安装依赖
   ├─ run.bat                # 开发模式启动前后端并打开浏览器
   ├─ .node-version          # 固定 Node.js 24.14.0
   ├─ shared/                # 桌面与渲染进程共享的强类型契约
   ├─ desktop/               # Electron 客户端
   │  ├─ src/                # main / preload / server-manager / updater
   │  ├─ test/               # 单元测试（fake updater、server-manager）
   │  ├─ assets/             # 图标
   │  ├─ electron-builder.yml# NSIS 安装包配置
   │  └─ release/            # 构建产物（exe/blockmap/latest.yml，gitignore）
   ├─ scripts/               # dev-desktop / prepare-desktop-runtime / smoke / verify
   └─ web/
      ├─ client/             # React + TypeScript + Vite 前端
      │  └─ src/
      │     ├─ api/          # REST 与 Socket 客户端
      │     ├─ components/   # 通用及会话组件
      │     ├─ features/     # 功能模块（含 update 更新面板）
      │     ├─ pages/        # 页面
      │     ├─ stores/       # Zustand 状态管理
      │     └─ views/        # 组合视图
      └─ server/             # Hono + Socket.IO 后端
         └─ src/
            ├─ agent/        # Agent Loop、运行控制、子 Agent
            ├─ character/    # 角色包与角色资源
            ├─ db/           # SQLite 数据层与迁移
            ├─ event/        # 事件定义、调度与执行
            ├─ evolution/    # 轨迹与进化能力
            ├─ llm/          # OpenAI 兼容流式模型客户端
            ├─ routes/       # REST API
            ├─ tools/        # 内置工具注册表
            └─ ws/           # Socket.IO 会话事件
```

## Agent 执行模型

天枢采用分层 Agent Loop：

1. 会话层负责加载角色、历史、工作区、目标和执行策略；
2. 模型层通过流式接口生成思考、文本或工具调用；
3. 工具层执行文件、命令、网页和 MCP 操作；
4. 运行层记录状态、Token 用量、错误和完成结果；
5. 子 Agent 在独立会话中处理委托任务，再把结果返回主会话。

写入文件、执行命令等操作仍受当前会话的权限策略和工作区范围限制。

## 数据与配置

用户选择的数据目录中通常包含：

- SQLite 会话数据库；
- 模型服务与模型配置；
- 角色、角色资源与记忆文件；
- MCP Server 配置；
- 工具输出、附件和调试数据；
- 事件、目标和运行记录。

请不要把包含真实 API Key、私人会话或项目附件的数据目录提交到 Git。

### API Key 安全

- 仅在受信任的本地电脑上运行天枢；
- 不要把 `web/server/config.json` 或用户数据目录分享给他人；
- 不要将前后端端口直接暴露到公网；
- 配置 MCP Server 前，确认其来源和命令内容可信。

## 常见问题

### `Node.js not found`

安装 Node.js 18+，重新打开终端后执行：

```bat
node --version
npm --version
```

两条命令都有版本输出后，再运行 `setup.bat`。

### `Server dependencies not found` 或 `Client dependencies not found`

在 `dev` 目录重新运行：

```bat
setup.bat
```

### 页面能打开，但无法发送消息

依次检查：

1. `TianShu Server` 窗口是否仍在运行；
2. <http://localhost:3456/health> 是否返回 `{ "ok": true }`；
3. 设置中的模型服务地址和 API Key 是否正确；
4. 当前会话是否已经选择可用模型；
5. 模型服务是否支持 OpenAI 兼容的 `/chat/completions` 流式接口。

### 端口被占用

`run.bat` 会尝试结束监听 3456/3457 的进程。若仍然失败，可检查端口：

```powershell
Get-NetTCPConnection -LocalPort 3456,3457 -State Listen |
  Select-Object LocalPort, OwningProcess
```

然后确认进程身份，再决定是否结束或修改启动端口。

### 修改数据目录后没有生效

保存设置后重启后端。也可以确认以下文件中的 `dataDir`：

```text
dev/web/server/config.json
```

如果设置了 `TIANSHU_DATA_DIR`，环境变量会覆盖该文件。

### `better-sqlite3` 安装失败

优先使用 Node.js LTS 版本，并删除对应目录中的 `node_modules` 后重新运行 `setup.bat`。如果 npm 无法下载预编译包，可能还需要可用的网络环境或 Windows C++ 构建工具。

## 当前状态

天枢已提供 **Windows 桌面客户端**（Electron + 内置 Node + electron-updater 自动更新），可从 GitHub Releases 安装。开发模式仍可使用 `setup.bat`/`run.bat` 或 `npm run dev`。接口、数据结构和角色包格式可能继续调整。重要数据请定期备份，升级前建议先备份用户数据目录。
