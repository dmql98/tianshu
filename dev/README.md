<p align="center">
  <img src="./assets/yi-logo.png" alt="弈 Logo">
</p>

# 弈 (Yì) — AI Agent 系统

> 弈者，坐照全局，执棋而不执子；授势于AI，行其意而不尽其言。庙算于先，机变于后，方寸之间，自有山河。

**弈**是一个 AI Agent 对话与自动化平台。每个 Agent 拥有独立人格、工具集和技能，可执行代码操作、调用 MCP 服务、委托子任务，并能基于运行轨迹自动沉淀技能。

## 核心特征

- **有灵魂**——每个 Agent 有独立人格（Soul）、记忆（Memory）、用户画像（User），用户可与不同角色对话
- **有策略**——Plan（只读分析）/ Ask（执行前确认）/ Bypass（自主执行）三种模式手动切换，L1+L2 两阶段权限校验
- **有分身**——主 Agent 可委托 Sub-agent 并行处理子任务，结果自动回收，最多 3 层递归
- **有工具**——插件式工具系统，内置 read/write/edit/bash/grep/glob/webfetch/websearch 等，支持 MCP 扩展
- **有事件**——统一事件引擎，用户/Agent/系统三者平等投递，可观测只读会话，支持 Cron 定时
- **会进化**——在线洞察检测 + 离线 LCS 聚类，自动从执行轨迹中生成 Skill
- **藏经阁**（规划中）——知识库模块，典籍编纂、语义检索、图谱扩散
- **弈林**（规划中）——生态市场，组件发现、一键安装、排行榜与知识交易

## 架构

```
apps/
├── client/          Vue 3 前端 — Chat 界面、角色管理、事件中心、设置面板
└── server/          Hono + Socket.IO 后端
    ├── agent/           双循环 Agent 引擎（outer + inner）、Sub-agent、技能加载
    ├── event/           事件引擎（调度器、执行器、CRUD）
    ├── evolution/       进化引擎（在线检测、离线聚类、洞察提取、技能生成）
    ├── tools/           插件式工具（每个工具独立目录，tool.json + index.ts）
    ├── routes/          8 个 REST API 模块
    ├── db/              SQLite 数据层（sessions/messages/events/trajectories）
    ├── llm/             SSE 流式 LLM 客户端
    ├── scheduler/       每日 2:00 离线复盘 Cron
    └── ws/              Socket.IO 事件处理（chat-run/abort/strategy）
```

**Agent 引擎**采用双层循环架构：外层（Session Loop）管理会话状态、MCP 连接、上下文压缩与 Sub-agent 信号；内层（Processor Loop）处理 LLM 推理（流式+重试）、工具调用（只读并行/写入串行）与 L1+L2 权限校验。

## 快速开始

```bash
# 第一步：安装依赖并构建前端
setup.bat

# 第二步：启动服务端和前端
run.bat
```

`setup.bat` 依次安装 server、client 依赖并构建前端；`run.bat` 同时启动服务端（:3001）和前端开发服务器（:5173）。

## 手动启动

```bash
# 终端 1 — 启动服务端
cd apps/server
npx tsx src/index.ts

# 终端 2 — 启动前端开发服务器
cd apps/client
npx vite
```

依赖：Node.js 18+，SQLite（better-sqlite3 内置）。

## 设计纲领

系统设计以三份纲领文档驱动，建议从 **[弈设计总纲.md](./弈设计总纲.md)** 开始阅读：

| 文档 | 范围 |
|:---|:---|
| [弈设计总纲.md](./弈设计总纲.md) | 核心引擎：身份/策略/调度/能力/进化引擎 + 两阶段权限模型 |
| [弈林设计总纲.md](./弈林设计总纲.md) | 生态市场：组件发现、一键安装、排行榜与知识交易预留 |
| [藏经阁设计总纲.md](./藏经阁设计总纲.md) | 知识库模块：典籍编纂、语义检索、图谱扩散（独立可选） |

## 项目文档

基于实际代码生成的项目文档请参见 **[项目文档.md](./项目文档.md)**，涵盖目录结构、核心架构、数据模型、API 参考与数据流。

## 项目状态

v0.1.0，核心功能基本完成。已实现：Agent 双循环引擎、插件式工具系统、L1+L2 权限模型、Sub-agent 分形、技能系统、MCP 集成、事件引擎（调度器+只读会话）、进化引擎（在线检测+离线聚类）、国际化（中/英）。待实现：集成测试、藏经阁（知识库模块，已有设计文档）、弈林市场（已有设计文档）。
