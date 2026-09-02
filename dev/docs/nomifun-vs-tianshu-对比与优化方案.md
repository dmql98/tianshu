# NomiFun vs 天枢（TianShu）—— 深度对比与优化方案

> 生成时间：2026-09-04 | 数据来源：两个仓库的源码结构、架构文档、Git 历史

---

## 一、项目画像

| 维度 | NomiFun Desktop | 天枢（TianShu） |
|---|---|---|
| **定位** | 本地优先的"超级 AI 工作站"，覆盖 Agent + 知识库 + 浏览器自动化 + 创意工作台 + 终端 + SSH + 定时任务 | 多角色 AI Agent 工作台，覆盖 Agent 会话 + 角色系统 + 技能包 + MCP + 事件系统 |
| **后端语言** | **Rust (edition 2024)** — 52 个 crate，约 76,000 行 | **TypeScript (Node.js 24)** — 单一 server 包，约 30,500 行 |
| **桌面壳** | **Tauri 2**（WebView2/WebKit，原生轻量） | **Electron 43**（Chromium + Node，约 150-250MB 内存基线） |
| **前端** | React 19 + Vite 6 + Arco Design + UnoCSS + SWR | React 18 + Vite 6 + Zustand（手写 UI，无组件库） |
| **前端代码量** | ~45,000 行 TS/TSX | ~25,000 行 TS/TSX |
| **数据库** | SQLite via `sqlx`（Rust 编译期校验）+ 正式 migration 系统 | SQLite via `better-sqlite3`（Node）+ `ALTER TABLE ADD COLUMN` 式增量 schema |
| **Git 提交数** | ~3,770（自 2024 年初至今） | ~190（同一时间段） |
| **版本** | pre-1.0，当前 v0.7.5 | v0.9.1（Electron 版） |
| **跨平台** | macOS / Windows / Linux（Tauri 原生打包） | Windows 为主，macOS/Linux 有脚本但非优先 |
| **开源协议** | Apache 2.0 | 未标注 |

---

## 二、架构对比

### 2.1 后端架构

```
NomiFun (Rust)                          天枢 (TypeScript/Node)
┌─────────────────────────┐             ┌─────────────────────────┐
│ nomifun-app (composition │             │ app.ts (单一入口)        │
│ root, axum router)      │             │ Hono HTTP server        │
│                         │             │ Socket.IO WS            │
│ 34 nomifun-* crates     │             │                         │
│   ↕ 接缝 (SEAM)         │             │ 1 个 server 包          │
│ 15 nomi-* crates        │             │   agent/ loop + tools   │
│   (AI 引擎, 自包含)      │             │   db/ store 层          │
│                         │             │   llm/ client            │
│ SQLx (编译期校验)        │             │   tools/ definitions    │
│ 正式 migration 系统      │             │ better-sqlite3 (运行时)  │
│ 排他服务器锁             │             │ ALTER TABLE 迁移        │
│ Repository trait 模式    │             │ 无排他锁               │
└─────────────────────────┘             └─────────────────────────┘
```

**NomiFun 的 Rust crate 拆分（52 个）：**

| 分组 | 数量 | 代表 crate |
|---|---|---|
| `crates/agent/` (nomi-*) | 15 | nomi-agent, nomi-providers, nomi-tools, nomi-mcp, nomi-browser, nomi-computer, nomi-a11y, nomi-memory, nomi-skills, nomi-compact |
| `crates/backend/` (nomifun-*) | 34 | nomifun-app, nomifun-db, nomifun-conversation, nomifun-ai-agent, nomifun-mcp, nomifun-knowledge, nomifun-terminal, nomifun-ssh, nomifun-cron, nomifun-miniapp, nomifun-robot, nomifun-companion, nomifun-channel, nomifun-extension, nomifun-creation, nomifun-customer-service |
| `crates/shared/` | 3 | nomifun-common, nomifun-net, nomifun-idmm |

**天枢的 Node.js 模块（扁平目录）：**

| 目录 | 职责 |
|---|---|
| `agent/` | 核心 Agent 循环（outer → loop-engine → inner）+ 压缩 + 计划/目标 |
| `llm/` | LLM 客户端 |
| `tools/` | 工具定义 + MCP 客户端 |
| `db/` | SQLite store 层（session/message/character/provider/tool/turn） |
| `character/` | 角色系统 |
| `evolution/` | 角色进化 |
| `event/` | 事件/定时任务 |
| `transport/` | IPC/WebSocket 广播 |
| `routes/` | HTTP 路由 |
| `config/` | 配置管理 |

### 2.2 前端架构

```
NomiFun                                  天枢
ui/src/                                  web/client/src/
├── common/        (纯逻辑, 无 React)    ├── api/          (API 客户端)
│   ├── adapter/   (HTTP/WS/Tauri 适配)  ├── components/   (Chat 相关组件)
│   ├── types/     (DTO 类型镜像)         ├── features/     (按功能分组)
│   └── ...                              ├── hooks/        (自定义 hooks)
├── platform/      (桥接/日志/存储)       ├── pages/        (页面)
├── renderer/      (React 应用)           ├── stores/       (Zustand store)
│   ├── pages/     (18 个功能页)          ├── views/        (视图)
│   ├── components/ (复用组件)            ├── types/        (类型)
│   ├── hooks/                         │   └── i18n/       (国际化)
│   └── styles/                        │
└── shims/                             └──

页面数: 18                              页面/视图: ~8
组件库: Arco Design                     组件库: 无 (手写)
CSS 方案: UnoCSS + 主题 CSS             CSS 方案: 单文件 index.css
路由: react-router v7 HashRouter        路由: react-router v6
数据获取: SWR                           状态: Zustand
```

### 2.3 功能矩阵

| 功能模块 | NomiFun | 天枢 | 差距评估 |
|---|---|---|---|
| **Agent 会话** | ✅ 流式 + 思考 + 工具 + 子Agent | ✅ 流式 + 思考 + 工具 + 子Agent | 功能相当 |
| **角色系统** | ✅ Companion 系统 | ✅ 角色 + Soul/User/Memory | 功能相当 |
| **技能包** | ✅ 懒加载 + skill tool | ✅ 懒加载 + 技能包 | 功能相当 |
| **MCP 扩展** | ✅ stdio + HTTP + OAuth | ✅ stdio + HTTP | NomiFun 有 OAuth |
| **知识库** | ✅ 完整 CRUD + 多源 + 持久化树 | ⚠️ 前端占位页（KnowledgePage 无 API 调用）+ 无后端路由，设计文档有 | **差距大** |
| **浏览器自动化** | ✅ 自托管 Chromium + CDP + 4 种身份模式 | ❌ 无 | **NomiFun 独有** |
| **桌面操作** | ✅ Computer-use (a11y) | ❌ 无 | **NomiFun 独有** |
| **终端** | ✅ xterm.js + PTY | ❌ 无 | **NomiFun 独有** |
| **SSH** | ✅ 远程 SSH 会话 | ❌ 无 | **NomiFun 独有** |
| **定时任务** | ✅ Cron 系统 | ✅ 事件系统 (onetime/scheduled) | 功能相当 |
| **计划/目标** | ✅ Plan + Goal | ✅ Plan-first + Goal 模式 | 功能相当 |
| **创意工作台** | ✅ Canvas + 图/视频工作台 + 提示词库 | ❌ 无 | **NomiFun 独有** |
| **Mini Apps** | ✅ Agent 生成的小应用运行时 | ❌ 无 | **NomiFun 独有** |
| **多渠道接入** | ✅ Telegram/Lark/DingTalk/WeChat 插件 | ❌ 无 | **NomiFun 独有** |
| **远程访问** | ✅ WebUI + 认证 + 深链接 | ✅ Web 客户端可远程 | 功能相当 |
| **模型管理** | ✅ 多 Provider + 加密凭证 | ✅ Provider + API Key | NomiFun 有加密存储 |
| **自动更新** | ✅ Tauri updater + CrabNebula | ✅ electron-updater | 功能相当 |
| **跨平台** | ✅ macOS/Win/Linux | ⚠️ Windows 为主 | **差距大** |
| **主题系统** | ✅ 深色/浅色/自定义 | ✅ 浅色/深色/图片取色 | 功能相当 |
| **国际化** | ✅ i18next (中/英) | ✅ i18n (中/英) | 功能相当 |
| **Companion 进化** | ✅ 完整的多层进化体系（详见 §3.2） | ✅ detectInsight + 进化系统 | **NomiFun 更深** |
| **Companion 记忆** | ✅ 6 维记忆分类 + FTS5 搜索 + 半衰期衰减 + 自动归档 | ✅ 跨会话记忆（读/写/归档） | **NomiFun 更深** |
| **Companion 游戏化** | ✅ XP 系统 + 等级曲线 + 心情 + 日记 | ❌ 无 | **NomiFun 独有** |
| **Companion 形象** | ✅ DIY 自定义形象 + 剪裁上传 + 动画 | ✅ 角色立绘 + 皮肤系统 | 功能相当，路径不同 |
| **技能自进化** | ✅ 从重复工具调用模式挖掘 → LLM 起草 → 评审 → 物化为 SKILL.md | ❌ 无 | **NomiFun 独有** |
| **OpenAI 兼容 API** | ✅ `/v1` 入站 | ❌ 无 | **NomiFun 独有** |
| **数据层质量** | ✅ 编译期校验 + 正式 migration + 排他锁 | ⚠️ 运行时 ALTER TABLE + 无锁 | **差距大** |

---

## 三、NomiFun 的进化亮点（值得借鉴）

### 3.1 架构层面

1. **Rust 后端 + 双宿主模型**：同一份 Rust 后端既能跑 Tauri 桌面，也能跑独立 Web 服务器。前端通过 HTTP/WS 通信，不依赖任何平台 IPC，实现了真正的前后端解耦。

2. **52 个 Rust crate 的模块化**：agent 引擎（nomi-*）和后端服务（nomifun-*）通过明确的"接缝"（SEAM）分离，agent crate 不依赖任何后端框架，边界清晰。

3. **适配层（Adapter）**：前端 `common/adapter/` 将 HTTP/WS/Tauri IPC 抽象为统一的 `ipcBridge`，应用代码完全不知道自己跑在什么宿主上。这是天枢最应该学习的设计。

4. **Repository trait 模式**：数据层通过 trait 定义接口，SQLite 实现具体逻辑，便于测试和未来切换存储引擎。

5. **排他服务器锁**：OS 级 advisory lock 防止多实例冲突，崩溃后由 OS 自动释放，不需要清理逻辑。

### 3.2 Companion 系统（桌面伙伴）

NomiFun 的 Companion 是一个**完整的 AI 伙伴生态系统**，不仅仅是"角色"，而是有独立生命周期、记忆、技能进化、游戏化的"数字伙伴"。核心文件位于 `crates/backend/nomifun-companion/src/`，包含 30+ 个 Rust 源文件。

#### 3.2.1 记忆系统（Learner）

**定时学习循环**：每个 Companion 有独立的 `learn` 配置，每 60 秒 tick 一次，读取未消费的工具调用事件，用 LLM 蒸馏成结构化记忆。

**六维记忆分类**：

| 记忆类型 | 衰减半衰期 | 用途 |
|---|---|---|
| `profile` | 不衰减 | 画像/稳定事实 |
| `preference` | 60 天 | 偏好/风格口味 |
| `knowledge` | 60 天 | 可复用结论 |
| `episode` | 7 天 | 带时间的经历 |
| `task` | 14 天 | 未完成事项/口头承诺 |
| `affective` | 21 天 | 情绪轨迹 |

**记忆衰减机制**：每条记忆有 `strength` 字段，随时间衰减，低于阈值（0.05）自动归档。用户可通过 UI 恢复。

**记忆去重**：
- `reinforce_memory_ids`：新事件印证已有记忆时，强化而非重复创建
- `supersede_memory_ids`：新事件与旧记忆矛盾时，生成新记忆并标记旧记忆为被取代

**FTS5 全文搜索**：`memory_search.rs` 实现 BM25 排序 + 重要性加权（`rank = -bm25 + pinned*2.0 + importance*0.5 + strength*0.5`），支持 trigram 分词和中文 LIKE 回退。

**独立数据库**：每个 Companion 有自己的 `memory.db`，与主应用数据库隔离，避免写竞争。

#### 3.2.2 技能进化系统（EvolutionEngine）

**挖矿 → 起草 → 评审 → 物化** 的四步管线：

1. **挖矿（miner.rs，确定性，无 LLM）**：从工具调用事件中挖出"做过多次的多步套路"（2-5 步窗口），按会话分组 → 折叠连续重复 → 滑窗聚合 → 跨会话去重。

2. **起草（prompt.rs + engine.rs）**：用 LLM 将挖出的套路蒸馏成 SKILL.md 草稿。支持"重水合"——从会话库中提取真实对话片段作为上下文（最多 40 行）。

3. **评审（engine.rs）**：另一个 LLM 调用审查草稿质量，决定是否物化。

4. **物化**：生成待审草稿 + `create_skill` 建议卡，用户确认后正式创建技能。

**安全红线**：后台副任务失败只记日志，绝不 `emit_error` 干扰用户。

#### 3.2.3 游戏化（gamify.rs）

**等级曲线**：`Lv = floor(sqrt(xp/100)) + 1`

| XP | 等级 |
|---|---|
| 0 | Lv.1 |
| 100 | Lv.2 |
| 400 | Lv.3 |
| 1600 | Lv.5 |

学习、进化、互动都会产生 XP，驱动 Companion 成长。

#### 3.2.4 伙伴形态系统（figure.rs + characters/）

- 内置多个伙伴形态：Bolt、Mochi、Ink、CustomFigure
- 支持用户上传自定义形象（WebP/PNG，最大 10MB，最大 4096×4096）
- 前端抠图管线处理后存储为 `figure.webp`
- 每个形态有独立的动画和交互行为

#### 3.2.5 心情系统（prompt.rs）

5 种心情：`happy` / `content` / `sleepy` / `worried` / `excited`

学习蒸馏时 LLM 会根据事件内容选择心情，前端映射到对应动画。

#### 3.2.6 日记系统

每次学习蒸馏生成一句话日记（第一人称），如："今天主人修了一下午 bug，我记住了他喜欢先看报错"。

### 3.3 其他功能层面

1. **内置浏览器自动化**：自托管 Chromium + CDP，支持 headless/可见/匿名/隔离四种模式，Agent 可以直接操作网页。

2. **终端 & SSH**：Agent 可以打开 PTY 终端，甚至连接远程 SSH 服务器。

3. **知识库系统**：持久化树形结构 + 多源（本地/远程/网页）+ CRUD + 全文搜索。

4. **Mini Apps**：Agent 生成的小应用有运行时，不是一次性输出。

5. **多渠道接入**：Telegram/Lark/DingTalk/WeChat 作为插件接入。

6. **Creative Studio**：Canvas-based 创意工作台，支持图片/视频工作台和提示词库。

---

## 四、天枢的相对优势（值得保留/强化）

> ⚠️ **修正**：NomiFun 的 Companion 系统在进化/记忆/游戏化方面远比天枢成熟。天枢的 `detectInsight` + `evolutionConfig` 是轻量版实现，差距明显。

1. **角色皮肤系统**：完整的皮肤管理 + 取色生成主题。NomiFun 有 figure 系统但风格不同（伙伴形态 vs 皮肤换装）。这是差异化的视觉体验。

2. **Agent 执行链路更轻**：Node.js 单进程，启动快，调试方便。对于个人/小团队场景足够。

3. **已有子 Agent + 计划/目标系统**：Plan-first / Goal 模式已实现，功能完整度不输 NomiFun。

4. **WorkGroup 协作**：主 Agent 委托子 Agent 在独立上下文中执行，NomiFun 也有但天枢的实现更显式。

---

## 五、天枢优化方案

基于以上对比，按优先级分为 **P0（必须做）、P1（应该做）、P2（可以做）** 三个层次。

### P0 —— 架构基础加固（1-2 周）

#### 1. 数据层迁移：引入正式 Migration 系统

**现状**：`schema.ts` 用 `ALTER TABLE ADD COLUMN` + `try/catch` 做增量迁移，已有 30+ 条 ALTER 语句，无版本号，无回滚。

**方案**：

```typescript
// 新建 db/migrator.ts
interface Migration {
  version: number
  up: (db: Database) => void
  down?: (db: Database) => void
}

const migrations: Migration[] = [
  { version: 1, up: db => { /* 原始建表 */ } },
  { version: 2, up: db => { db.exec('ALTER TABLE sessions ADD COLUMN parent_id TEXT') } },
  // ...
  { version: 31, up: db => { db.exec('ALTER TABLE messages ADD COLUMN llm_ms INTEGER') } },
]

export function runMigrations(db: Database) {
  db.exec('CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, applied_at TEXT)')
  const applied = db.prepare('SELECT version FROM _migrations').all().map(r => r.version)
  for (const m of migrations) {
    if (!applied.includes(m.version)) {
      db.transaction(() => {
        m.up(db)
        db.prepare('INSERT INTO _migrations (version, applied_at) VALUES (?, ?)').run(m.version, new Date().toISOString())
      })()
    }
  }
}
```

**收益**：可审计、可回滚、可重现的 schema 演进。不再依赖 `try/catch ALTER TABLE`。

#### 2. 服务器排他锁

**现状**：多实例启动可能同时写同一个 `sessions.db`。

**方案**：在 `app.ts` 启动时用 `proper-lockfile` 或文件锁：

```typescript
import lockfile from 'proper-lockfile'
import path from 'path'

const lockPath = path.join(getDataDir(), '.server.lock')
await lockfile.lock(lockPath, { realpath: false, stale: 60_000 })
```

**收益**：防止数据损坏，崩溃后锁自动过期释放。

#### 3. 前端适配层抽离

**现状**：`api/client.ts` 直接 fetch，没有宿主抽象。Electron IPC 和 HTTP 混用。

**方案**：参考 NomiFun 的 `common/adapter/` 设计：

```
web/client/src/
├── adapter/
│   ├── types.ts          # 统一的 Bridge 接口定义
│   ├── httpBridge.ts     # HTTP + WebSocket 实现
│   ├── electronBridge.ts # Electron IPC 实现（桌面壳）
│   └── ipcBridge.ts      # 根据环境选择实现
├── api/                  # 基于 ipcBridge 的类型化 API
└── ...
```

**收益**：未来切换到 Tauri 或纯 Web 部署时，应用代码零改动。

---

### P1 —— 功能追赶（2-4 周）

#### 4. 终端集成

**现状**：Agent 无法操作本地终端。

**方案**：在 server 端新增 `terminal/` 模块，基于 `node-pty` 开 PTY，前端用 `xterm.js`：

```
web/server/src/terminal/
├── pty-manager.ts    # PTY 进程管理
├── routes.ts         # /api/terminal/* 路由
└── ws-handler.ts     # 终端输出流推送到前端

web/client/src/features/terminal/
├── TerminalView.tsx   # xterm.js 封装
└── useTerminal.ts     # WebSocket 连接 hook
```

**收益**：Agent 可以执行命令、查看输出，是"AI 工作站"的基础能力。

#### 5. 知识库系统

**现状**：`docs/知识体系构建/` 有设计文档，但 server 端没有独立的知识库模块。

**方案**：

```
web/server/src/knowledge/
├── knowledge-store.ts    # SQLite CRUD
├── indexer.ts            # 文本索引 (FTS5)
├── routes.ts             # /api/knowledge/* 路由
└── sources/              # 数据源适配
    ├── local-folder.ts   # 本地文件夹
    └── web-crawler.ts    # 网页抓取

web/client/src/features/knowledge/
├── KnowledgeList.tsx
├── KnowledgeDetail.tsx
└── useKnowledge.ts
```

**收益**：Agent 可以搜索、引用项目文档，减少重复上下文输入。

#### 6. 前端 UI 组件化

**现状**：手写 UI，`Chat/` 下的组件混杂了大量逻辑和样式。

**方案**：引入轻量组件库（如 Radix UI + Tailwind CSS 或 Shadcn/ui），逐步替换：

- 优先改造：对话列表、消息气泡、设置面板
- 保持现状：ChatInput（已有增量 Markdown 渲染优化）

**收益**：开发效率提升，UI 一致性改善，无障碍支持。

#### 7. i18n 完善

**现状**：`i18n/` 目录存在但覆盖不完整，部分字符串硬编码。

**方案**：扫描所有 `zh`/`en` 硬编码字符串，补全语言包。参考 NomiFun 的 `i18next` + `react-i18next` 方案。

---

### P2 —— 差异化增强（4-8 周）

#### 8. 进化工作台页面（对标 NomiFun EvolutionTab）

> ⚠️ 这是本次对标中**最重要的发现**：NomiFun 把"进化"做成了一整页可配置、可查看、可干预的界面（companion workspace 的 EvolutionTab，约 1,400 行 UI），而天枢的进化引擎**后端有骨架、前端完全隐形**——用户看不到进化发生了什么，也无法配置或把关。

**天枢 evolution 现状审计（代码级）：**

| 组件 | 文件 | 状态 |
|---|---|---|
| 在线洞察检测 `detectInsight` | `web/server/src/evolution/detectors/onlineDetector.ts` (89 行) | ✅ 已接线：run 结束时调用（`outer.ts` L432），需角色 `selfEvolution` 开关 + 全局 evolutionConfig 命中 |
| 配置 CRUD | `web/server/src/evolution/evolutionConfig.ts` + `routes/evolution.ts` | ✅ 有 REST，但只在设置页一个隐藏表单中暴露 |
| 轨迹挖掘 `OfflineMiner` (LCS 聚类) | `detectors/offlineMiner.ts` (133 行) | ❌ **从未被调用**（死代码） |
| 轨迹存储 `trajectoryStore` | `storage/trajectoryStore.ts` (53 行) | ❌ **无任何 save 调用者** → trajectories 表恒空，miner 无数据可挖 |
| 技能抽取/生成 | `InsightExtractor` / `SkillGenerator` | ❌ 仅被事件 run 间接使用，产物直接落盘 SKILL.md，**无草稿/审批环节** |
| 前端 API | `web/client/src/api/evolution.ts` | ✅ 有 fetch/save/clear 配置 |
| 前端页面 | — | ❌ **无**：仅在 `SettingsPage` 有孤零零的配置表单；`CharacterDetailPage` 只有 selfEvolution 布尔开关 |
| 洞察通知 | `chatStore.evolutionNotification` | ⚠️ 2 秒 toast，看完即无，无历史记录 |

**与 NomiFun EvolutionTab（6 个 Section）的差距**：
采集来源（CollectionSources）/ 学习模型与开关（Learning + LearningModelRow）/ 休眠时段（QuietHours）/ 记忆保留衰减策略（Retention）/ 技能生成上限（SkillGeneration）/ 一键全停（StopAll）——**天枢一个都没有**，而且 NomiFun 每个 companion 单独配置，天枢是"全局一份 config + 角色布尔开关"，维度少一层。

**方案（先接通后端闭环，再补 UI）：**

```
A. 后端闭环（1-2 天）
  1. run 结束时保存轨迹：outer.ts 中调 trajectoryStore.save（session/goal/工具序列/成功率）
  2. 增加定时任务：每 N 小时跑 OfflineMiner.mine(trajectoryStore.getRecent(7))
  3. SkillGenerator 产物改为写入「草稿目录」+ 一条 drafts 记录（含 origin run/insight/签名），
     用户批准后才注册为角色可用技能（对标 NomiFun 的 create_skill 建议卡）

B. 前端页面（对标 EvolutionTab 结构）
web/client/src/features/evolution/
├── EvolutionPage.tsx        # 新页面/侧边栏入口（或 ChatPage 右侧 tab）
├── sections/
│   ├── LearningSection.tsx      # 开关 + 模型选择 + 窗口/阈值/重复次数等现有 config
│   ├── InsightHistorySection.tsx# 洞察历史列表（insight_type/描述/时间/跳转会话）
│   ├── DraftsSection.tsx        # 技能草稿列表：来源 run / 签名 / 内容预览 → 批准 / 驳回
│   └── MiningSection.tsx        # 离线挖掘出的重复套路（供用户一键固化为技能）
└── useEvolutionConfig.ts / useInsightHistory.ts / useDrafts.ts
```

**验收标准**：用户能在新页面看到"系统最近进化了什么 / 正在提议哪些新技能"，能配置每个角色的进化参数（模型、窗口、阈值、通知），能批准/驳回技能草稿；洞察触发后不只 2 秒 toast，而是进入历史列表可回溯。

**收益**：把天枢已有的 evolution 后端（416 行）从"半接线状态"变成可见、可配、可干预的完整功能；这是天枢角色系统差异化叙事的关键一环——角色会"长出新技能"，且用户看得到。

#### 9. 浏览器自动化（轻量版）**现状**：无。NomiFun 有完整的自托管 Chromium。

**方案**：天枢不需要做到 NomiFun 的程度，可以用更轻的方案：

- 集成 `Playwright` 作为 Agent 工具
- Agent 调用 `browser_open` / `browser_click` / `browser_extract` 工具
- 前端提供可选的浏览器预览面板

**收益**：Agent 可以自动化网页操作，但不需要维护 Chromium 进程树。

#### 10. 跨平台优化

**现状**：Electron 打包主要面向 Windows。

**方案**：
- 验证 macOS/Linux 打包流程
- 配置 GitHub Actions 多平台 CI
- 考虑未来迁移到 Tauri（Electron → Tauri 是渐进式迁移，适配层已准备好）

#### 11. 多渠道接入

**现状**：仅 Web 客户端。

**方案**：参考 NomiFun 的 channel 插件模式：

```
web/server/src/channels/
├── plugin-registry.ts    # 渠道插件注册
├── telegram.ts           # Telegram Bot
├── lark.ts               # 飞书
└── wechat.ts             # 企业微信
```

**收益**：Agent 可以跨平台响应消息，不局限于桌面客户端。

#### 12. 数据加密存储

**现状**：Provider API Key 明文存储在 SQLite。

**方案**：
- 用 `crypto.createCipheriv` 加密敏感字段
- 密钥从 OS keychain（`keytar`）或环境变量获取
- NomiFun 的 Rust 版用系统级加密，天枢可以用 Node.js 的 `crypto` 模块

**收益**：安全性提升，符合企业级要求。

---

## 六、实施优先级路线图

```
Week 1-2:  [P0] 数据层 migration + 排他锁 + 适配层抽离
           ↓
Week 3-4:  [P1] 终端集成 + 知识库基础 + 进化后端闭环（轨迹保存 + 定时挖掘 + 草稿机制）
           ↓
Week 5-6:  [P1] 前端 UI 组件化 + i18n 完善
           ↓
Week 7-8:  [P2] 进化工作台页面（对标 EvolutionTab）+ 浏览器自动化轻量版
           ↓
Week 9+:   [P2] 跨平台 CI + 多渠道 + 数据加密 + 持续迭代
```

---

## 七、关键决策点

| 决策 | 建议 | 理由 |
|---|---|---|
| **是否从 Electron 迁移到 Tauri？** | 短期不迁移，中期评估 | Electron 已经工作，Tauri 迁移需要重写桌面壳 + 引入 Rust 构建链。先用适配层做好隔离，未来迁移成本低。 |
| **是否引入 Rust 后端？** | 不建议 | 天枢的核心竞争力在 Agent 能力和角色系统，不在性能。Node.js 的 3 万行代码已经够用，引入 Rust 会大幅增加维护成本。 |
| **是否引入完整组件库？** | 引入轻量级（Radix/Shadcn） | 不用 Arco Design（太重），手写 UI 维护成本高。Shadcn/ui 是当前趋势，可定制性强。 |
| **知识库用 SQLite FTS5 还是外部搜索引擎？** | 先用 FTS5 | 本地优先原则，FTS5 够用，不需要额外部署 Elasticsearch。 |

---

## 八、总结

**NomiFun 是一个更成熟的项目**（3,770 提交 vs 190 提交，52 个 Rust crate vs 1 个 Node 包，93 万行 Rust + 4.5 万行 TS vs 3 万行 TS + 2.5 万行 TS），在架构模块化、数据层质量、跨平台支持和功能广度上都明显领先。

**但天枢有自己的差异化优势**：角色皮肤系统（NomiFun 是形态换装，路线不同）、更轻的 Agent 执行链路、事件式调度（fireOnceEvent 把洞察转成独立任务）等。**注意：角色进化不再是天枢独有** —— NomiFun 的 Companion 进化（Learner + EvolutionEngine）在深度、可视化与人工把关上都领先，详见 §3.2。天枢已具备 evolution 后端骨架（detectInsight/OfflineMiner/SkillGenerator），缺的是**前端展示与配置入口**（详见 §五-8）。

**优化核心思路**：不做 NomiFun 的复制品，而是在保持天枢轻量特色的同时，补齐架构基础（数据层、锁、适配层）和关键功能短板（终端、知识库、**进化工作台页面**、跨平台）。中期可以通过适配层为未来的 Tauri 迁移做好准备。
