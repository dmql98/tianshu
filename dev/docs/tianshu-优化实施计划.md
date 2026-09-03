# 天枢优化·详细实施计划

> 上游文档：`docs/nomifun-vs-tianshu-对比与优化方案.md`（战略层对比）
> 本文件：把对比报告的 P0/P1/P2 落成**可执行的里程碑（M0–M7）**，每项含目标 / 现状（代码实测）/ 具体任务 / 涉及文件 / 验收标准 / 工时。
> 核对日期：2026-09-03（本机仓库 `web/server` + `web/client` + `desktop`，Node 24 / Electron 43 / better-sqlite3）

---

## 0. 执行摘要

### 0.1 一句话结论
**先修地基（migration + 锁），再补差异化（进化解耦 + 进化工作台），然后按收益从高到低补功能（知识库 → 终端 → 浏览器 → 跨平台/加密）。不引入 Rust，不换 Tauri（短期）。**

### 0.2 对对比报告的代码级纠偏（写计划前先对齐事实）
以下 5 处是**代码实测**与对比报告不一致/需补充的地方，直接影响了优先级：

| # | 对比报告说法 | 代码实测 | 影响 |
|---|---|---|---|
| 1 | P0-1「schema 已有 30+ 条 ALTER」 | `db/schema.ts`（544 行）共 **50 条 `ALTER TABLE`**，全部 `try/catch` 包裹，**无版本号、无回滚、无审计** | 方向不变，工作量比报告预估略大；需把现有 50 条固化进 migration 清单 |
| 2 | §五-8「SkillGenerator 仅被事件 run 间接使用」 | `OfflineMiner` / `InsightExtractor` / `SkillGenerator` / `trajectoryStore.save` 在 `web/server/src` 中**均无任何调用者**（`trajectories` 表已建但恒空）——纯死代码 | 后端闭环不是「接通」而是「从头接线」，工作量为中等 |
| 3 | §五-8「需角色 `selfEvolution` 开关」 | `outer.ts:429` 确实读 `charMeta.memory?.selfEvolution`（`characterStore.ts:31`），且还要 `evolutionConfig.character_id` 非空才进分支 | 与 `知识体系构建/04-0期` 的 **M0.3 进化解耦**高度重合，应合并执行 |
| 4 | P0-3「前端没有宿主抽象，Electron IPC 和 HTTP 混用」 | 已有 `api/eventBus.ts` 做了 **ipc / SSE 传输抽象**（`window.tianshuDesktop` 优先）；但 **HTTP 层仍是裸 fetch**（`api/client.ts`） | 适配层工作收窄：只需把 HTTP 也纳入传输接口，不必新建整套 adapter |
| 5 | P1-5「知识库无后端路由」 | 确认：`routes/` 无 knowledge 路由，`KnowledgePage.tsx` 仅 59 行纯占位；但 `知识体系构建/02-第二期` 与 `04-0期 M0.2（FTS5/Embedding 探针）` 已有较完整设计 | 直接复用既有设计文档，按 M0.2 → CRUD → 前端接线推进 |

### 0.3 优先级重排理由
1. **进化工作台从 P1 提到与「进化解耦」合并做（M1–M2）**：天枢的差异化叙事核心是「角色会长出新技能」，而后端骨架已存在、改动量小、收益（可见/可配/可干预）最大；对比报告也承认这是「本次对标中最重要的发现」。
2. **知识库用「最小可用」而非全量**：先 FTS5 探针 + 文件夹/文本检索跑通闭环，再补分块/向量（向量留到后续），避免 0 期贪大。
3. **终端、浏览器自动化降为 P2**：`node-pty` 在 Electron 打包下的原生依赖成本和 Playwright 的 Chromium 下载都是额外负担，先以「工具能力」形式落地，暂不做独立页面。
4. **数据加密排到 M7**：本地单机场景风险可控，且需要 keychain 依赖决策，放最后不阻塞主线。

---

## 1. 里程碑总览

| 里程碑 | 主题 | 对应对比报告 | 预计工时 |
|---|---|---|---|
| M0 | 数据层地基：正式 Migration 系统 + 排他服务器锁 | P0-1 / P0-2 | 2–3 天 |
| M1 | 进化解耦 + 后端闭环（轨迹保存 / 定时挖掘 / 技能草稿） | P1-8 后端部分 + `04-0期 M0.3` | 3–5 天 |
| M2 | 进化工作台前端（EvolutionPage） | P2-8 前端部分 | 3–5 天 |
| M3 | 知识库最小可用（FTS5 + CRUD + 前端接线） | P1-5 + `04-0期 M0.2` | 5–7 天 |
| M4 | 终端集成（node-pty + xterm.js 工具能力） | P1-4 | 4–5 天 |
| M5 | 浏览器自动化轻量版（Playwright 工具） | P2-9 | 3–4 天 |
| M6 | 跨平台 CI（GitHub Actions 三平台构建） | P2-10 | 2–3 天 |
| M7 | Provider 密钥加密 + HTTP 适配层收口 | P2-12 / P0-3 | 2–3 天 |

> 依赖：M0 → M1 → M2（数据层先行，进化闭环依赖 trajectories 表/migration）；M3 可与 M1/M2 并行；M4/M5 独立；M6/M7 收尾。

---

## 2. M0 — 数据层地基（2–3 天）

### 目标
把 `ALTER TABLE ... try/catch` 的隐式 schema 演进，升级为**有版本号、可审计、可回滚、可重现**的正式 migration；并给多实例启动加**排他锁**，防止写同一个 `sessions.db`。

### 现状（实测）
- `web/server/src/db/schema.ts`（544 行）：`getDb()` 里 50 条 `try { db.exec('ALTER TABLE ...') } catch {}`，无版本表、无顺序保证、无幂等清单；同文件还混着建表 + 数据回填 + 历史兼容。
- 多实例可同时打开同一 WAL 数据库，存在并发写风险；无 advisory lock。

### 任务

#### M0.1 抽 `db/migrator.ts`
```typescript
// web/server/src/db/migrator.ts
export interface Migration {
  version: number
  name: string
  up: (db: TianshuDatabase) => void
  down?: (db: TianshuDatabase) => void
}
export function runMigrations(db: TianshuDatabase, migrations: Migration[]): void
```
- 建 `_migrations (version INTEGER PRIMARY KEY, name TEXT, applied_at TEXT)` 表。
- 逐个执行未应用 migration，在**同一事务**内 `up(db)` + 记录版本；失败回滚并抛错（启动即失败，不静默）。
- 提供 `getPendingMigrations` / `listApplied` 供审计与测试。

#### M0.2 把现有 50 条 ALTER 固化进 migration 清单
- 新建 `web/server/src/db/migrations/`，按 `0001_init.ts ... 0050_*.ts` 组织；`0001_init` = 现有全部 `CREATE TABLE IF NOT EXISTS`（sessions/messages/events/trajectories/runs/run_events/…），其余每条 ALTER/回填一个文件。
- 迁移顺序 = 原 `schema.ts` 的执行顺序；新增列迁移全部写成**幂等**（`ADD COLUMN` 前先查 `PRAGMA table_info` 或依赖 migrator 的版本记录，二选一，不要再用 `try/catch` 掩盖错误）。
- 迁移入口：`getDb()` 中先 `runMigrations(db, migrations)` 再走业务初始化。

#### M0.3 排他服务器锁
- 新增 `web/server/src/db/server-lock.ts`：
  - 打开 `<dataDir>/.server.lock`，用 `proper-lockfile` 或 `fs.openSync('wx')` 抢占；失败时等待/提示「已有实例在运行」并退出。
  - 锁带 `stale`（如 60s），崩溃后自动过期；进程退出/`close()` 时释放。
  - 只在**独立启动**（`node dist/index.js`）时强制，避免影响测试进程。
- 在 `app.ts` 的 `startTianshuServer()` 开头获取，`close()` 里释放。

### 涉及文件
- 新增：`web/server/src/db/migrator.ts`、`web/server/src/db/server-lock.ts`、`web/server/src/db/migrations/*.ts`
- 修改：`web/server/src/db/schema.ts`（迁移接入点）、`web/server/src/app.ts`（锁）、`web/server/package.json`（+`proper-lockfile`）

### 验收
- `web/server/test/migrator.test.ts`：空库全量迁移 → 版本表齐全；重跑幂等；注入一个失败 migration → 事务回滚且版本不回写。
- 新库与旧库（含历史 devdata）打开均正常，`PRAGMA user_version` 或 `_migrations` 版本一致。
- 双开 `node dist/index.js` 第二个实例被锁拦截并友好退出。
- `npm test --prefix web/server` 全绿。

### 风险
- 迁移顺序写错会导致已有用户库打不开 → 用 `db-compatibility.test.ts` + 一份旧库快照做回归。
- `node-pty`/锁这类 native 依赖在 Electron 打包下要进 `extraResources`，注意随包体积。

---

## 3. M1 — 进化解耦 + 后端闭环（3–5 天）

> 直接复用 `知识体系构建/04-0期-地基与进化解耦-可执行步骤.md` 的 **M0.3** 设计，二者合并执行。

### 目标
1. 把进化开关 `memory.selfEvolution` 解耦到顶层 `skillMining`（进化解耦，与记忆配置分离）。
2. 把 evolution 后端从**死代码**变成**闭环**：run 结束存轨迹 → 定时离线挖掘 → 生成技能**草稿**（不直接落盘）→ 用户批准后才物化为技能。

### 现状（实测）
- 触发点 `outer.ts:429`：`toolCallHistory.length > 0 && charMeta.memory?.selfEvolution`，且需 `evolutionConfig.character_id` 非空。产出是 `fireOnceEvent`（丢给角色自动跑），**用户无任何把关**。
- `trajectoryStore.save` / `OfflineMiner.mine` / `InsightExtractor.extract` / `SkillGenerator.generate` 均无调用者；`trajectories` 表已建、恒空。
- `SkillGenerator.generate` 直接写 `<dataDir>/skills/<slug>/SKILL.md`，无草稿/审批。
- `event-scheduler` 已有 `start/stop/scheduleImmediate`，可复用作定时挖掘载体。

### 任务

#### M1.1 进化解耦（照 04-0期 M0.3）
- `characterStore.ts`：`CharacterMemory` 删 `selfEvolution`，`CharacterRecord` 加 `skillMining?: { enabled: boolean; charLimit?: number; maxEntries?: number }`。
- `outer.ts:429` 改读 `charMeta.skillMining?.enabled`。
- 新增 `character/migrate-self-evolution.ts` 一次性迁移（值搬移 + 物理删除旧字段），在 `app.ts` 启动链调用；内置角色 `content/builtin/characters/*/character.json` 同步清理。
- 新增 `web/server/test/self-evolution-migration.test.ts`。

#### M1.2 run 结束保存轨迹
- 新增 `evolution/run-trajectory-recorder.ts`：run 结束时（`outer.ts` 收尾段，与现有 insight 检测同一位置）从 `run_events`/`messages`/`llm_calls` 汇总该 run 的工具调用序列 + user 目标 + 成功率，调 `trajectoryStore.save()`。
- 去重：同一 session 多次 run 各自存一条（`trajectories` 按 `session_id` + `id` 区分）。

#### M1.3 定时离线挖掘
- 新增 `evolution/evolution-scheduler.ts`：复用 `startEventScheduler` 的 tick 模式，每 N 小时（N 可配，默认 12h）执行 `OfflineMiner.mine(trajectoryStore.getRecent(7))`。
- 挖掘产物（`TrajectoryCluster[]`）写入新表 `skill_drafts`：
  ```sql
  CREATE TABLE IF NOT EXISTS skill_drafts (
    id TEXT PRIMARY KEY,
    character_id TEXT,
    origin_run_id TEXT,
    signature TEXT,
    skill_name TEXT,
    content TEXT,            -- SKILL.md 草稿全文
    status TEXT NOT NULL DEFAULT 'pending',  -- pending|approved|rejected
    created_at INTEGER NOT NULL,
    decided_at INTEGER
  );
  ```
- `SkillGenerator.generate` 改为**写 `<dataDir>/evolution-drafts/<id>/SKILL.md` + 插一条 `skill_drafts`**，不再直接进 `skills/`。

#### M1.4 批准/驳回 API
- 扩展 `routes/evolution.ts`：
  - `GET /api/evolution/drafts`（列表 + 预览）
  - `POST /api/evolution/drafts/:id/approve`（批准 → 调 `createSkillPackage`（已有 `agent/skill-package-writer.ts`）物化到 `<dataDir>/skills/`，状态置 approved）
  - `POST /api/evolution/drafts/:id/reject`
- `app.ts` 挂载 `/api/evolution`。

### 涉及文件
- 新增：`evolution/run-trajectory-recorder.ts`、`evolution/evolution-scheduler.ts`、`character/migrate-self-evolution.ts`、`db/migrations/0051_skill_drafts.ts`、`routes/evolution.ts`（扩展）、`test/self-evolution-migration.test.ts`、`test/evolution-closed-loop.test.ts`
- 修改：`agent/outer.ts`、`db/characterStore.ts`、`evolution/generators/skillGenerator.ts`、`app.ts`、内置角色 JSON

### 验收
- `grep -rn "selfEvolution" web/server/src content/` 除迁移脚本与 `skillMining` 外无残留。
- 跑一个带工具调用的会话 → `trajectories` 有数据；手动触发 scheduler → 产生 `skill_drafts` 草稿行 + `evolution-drafts/` 文件，`skills/` **不新增**。
- `POST /approve` 后 `skills/` 出现包，`drafts` 状态变 approved；`/reject` 不变物化。
- `npm test --prefix web/server` 全绿。

### 风险
- 定时挖掘是后台任务，**失败只记日志不得干扰前台**（沿用 NomiFun 的安全红线，也符合天枢事件系统惯例）。
- 草稿物化要校验 SKILL.md 格式合法（走 `createSkillPackage` 既有校验），避免产出坏技能包。

---

## 4. M2 — 进化工作台前端（3–5 天）

### 目标
把 evolution 从「设置页隐藏表单 + 2 秒 toast」升级为**可见、可配、可干预**的一整页，对标 NomiFun EvolutionTab。

### 现状（实测）
- 前端 `api/evolution.ts` 已有 `fetchEvolutionConfig/saveEvolutionConfig/clearEvolutionConfig`，**可直接复用**。
- 无 `EvolutionPage`；`chatStore.ts` 有 `evolutionNotification`（2 秒 toast，`evolution:insight_created` 事件驱动）。
- 路由在 `App.tsx`（react-router v6，页面已按 `lazy` 分包）。

### 任务

#### M2.1 新增 `features/evolution/`
```
web/client/src/features/evolution/
├── EvolutionPage.tsx        # 新页面（路由 /evolution）
├── sections/
│   ├── LearningSection.tsx      # 开关(notify_enabled) + 模型/窗口/阈值/重复次数等 config 表单
│   ├── InsightHistorySection.tsx# 洞察历史（insight_type/描述/时间 → 跳转会话）
│   ├── DraftsSection.tsx        # 技能草稿：来源 run/签名/内容预览 → 批准/驳回
│   └── MiningSection.tsx        # 离线挖掘出的套路列表（可选一键固化为技能）
└── hooks.ts                     # useEvolutionConfig / useDrafts / useInsightHistory
```
- 样式沿用现有手写 CSS（`index.css`），组件风格与 `SettingsPage`/`EventsPage` 一致，**不引入组件库**。

#### M2.2 后端补两个只读接口
- `GET /api/evolution/insights`：洞察历史（可从 `run_events` 里筛 `evolution:insight_created` 事件，或落一张 `insights` 表——优先复用 run_events，少建表）。
- `GET /api/evolution/drafts`（M1.4 已有）。

#### M2.3 洞察通知可回溯
- `chatStore` 收到 `evolution:insight_created` 时，除现有 toast 外，写入本地 store 的 `insightHistory[]`（上限如 50 条），页面可查；toast 增加「查看详情」跳转 `/evolution`。

#### M2.4 路由与导航
- `App.tsx` 加 `/evolution` 路由（lazy），侧边栏加入口（与 知识库/事件 同级）。

### 涉及文件
- 新增：`web/client/src/features/evolution/**`、`web/client/src/api/evolution.ts`（扩展 insights/drafts）
- 修改：`web/client/src/App.tsx`、`web/client/src/stores/chatStore.ts`、侧边栏组件、`i18n/dict.ts`（新增条目）

### 验收
- 手动制造一次 insight（或 mock 事件）→ toast + 历史列表都出现，历史可回溯、可跳转。
- 页面能改 evolution 配置并 `PUT` 成功，重启后配置保留。
- 有草稿时能在页面预览内容并批准/驳回，`skills/` 变化符合预期。
- `npm run build --prefix web/client`（tsc + vite）通过。

### 风险
- 这是纯增量页面，风险低；注意懒加载分包避免首屏体积增加。

---

## 5. M3 — 知识库最小可用（5–7 天）

> 复用 `知识体系构建/02-第二期-独立文件知识库.md` 与 `04-0期 M0.2`。本期只做 **FTS5 + 文件/文本检索** 的闭环，**不做** Embedding 向量（留到后续）。

### 目标
把 `KnowledgePage` 从占位页变成可用功能：文件夹树 + 文档上传 + 全文搜索 + 预览，Agent 侧提供 `knowledge_search` 工具。

### 现状（实测）
- `KnowledgePage.tsx` 59 行纯占位，无 API 调用；`routes/` 无 knowledge 路由。
- 已具备：`better-sqlite3`、`@mozilla/readability`（网页提取）、`turndown`（HTML→MD）、`htmlparser2` —— 文件转换/网页抓取的基础能力**已在依赖里**。
- `04-0期 M0.2` 已定义 `EmbeddingProvider` / `VectorStore` / `KnowledgeRetrievalService` 接口与 `createLexicalOnlyRetrieval(fts)` 回退设计（未实现）。

### 任务

#### M3.1 FTS5 探针（先卡门槛，照 04-0期 2.1）
- `web/server/test/fts5-contract.test.ts`：通过 `sqlite-db.ts` 门面建临时库执行 `CREATE VIRTUAL TABLE ... USING fts5(...)` + `MATCH`，确认打包版 better-sqlite3 支持 FTS5。**不过则先升级 SQLite 构建再继续。**

#### M3.2 数据层
- 新表（随 migration 增加）：
  ```sql
  CREATE TABLE IF NOT EXISTS knowledge_docs (
    id TEXT PRIMARY KEY, path TEXT NOT NULL, title TEXT,
    content TEXT NOT NULL, source TEXT, size_bytes INTEGER,
    hash TEXT, created_at INTEGER, updated_at INTEGER
  );
  CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_docs_fts USING fts5(title, content, content='knowledge_docs', content_rowid='rowid');
  ```
- `web/server/src/knowledge/knowledge-store.ts`：CRUD + upsert（写库 + 同步 FTS 索引）+ 删除。
- 文本抽取：`knowledge/extract.ts`，支持 md/txt/html（readability+turndown）/pdf 先行 PDF 文本，其余类型登记不支持。

#### M3.3 路由
- `web/server/src/knowledge/routes.ts`：`GET /api/knowledge/tree`（文件夹树）、`GET /api/knowledge/docs`、`POST /api/knowledge/upload`（multipart 或 base64）、`GET /api/knowledge/docs/:id`（含 FTS 摘要）、`DELETE /api/knowledge/docs/:id`、`GET /api/knowledge/search?q=`（BM25，lexical-only 回退）。
- `app.ts` 挂载 `/api/knowledge`。

#### M3.4 前端接线
- 改 `KnowledgePage.tsx`：用 `api/knowledge.ts` 拉真实数据，替换占位树/列表/预览；上传走 `POST /upload`。

#### M3.5 Agent 工具（可选，P1 加分项）
- `tools/definitions` 加 `knowledge_search(query)` 工具（复用检索服务），让 Agent 能引用知识库。

### 涉及文件
- 新增：`web/server/src/knowledge/**`、`db/migrations/0052_knowledge.ts`、`web/client/src/api/knowledge.ts`、`test/fts5-contract.test.ts`、`test/knowledge-store.test.ts`、`test/knowledge-api.test.ts`
- 修改：`KnowledgePage.tsx`、`app.ts`、`i18n/dict.ts`

### 验收
- FTS5 探针绿。
- 上传若干 md/txt → 树/列表/预览正常，搜索中文与英文关键词均命中（中文需确认 FTS5 默认分词是否够用，不够则加 `unicode61` tokenizer 或 LIKE 回退）。
- 删除文档后 FTS 同步清除（无悬挂索引）。
- `npm test --prefix web/server` + `npm run build --prefix web/client` 通过。

### 风险
- **中文分词**是最大不确定点：FTS5 默认 tokenizer 对中文按整句切分效果差。M3 里先做「FTS5 + LIKE 回退」双通道，后续再评估 jieba/ngram。这与 `04-0期` 的判断一致。

---

## 6. M4 — 终端集成（4–5 天，工具能力优先）

### 目标
Agent 能执行 shell 命令并流式拿到输出，先以**工具**形式落地（不承诺完整 PTY 页面）。

### 现状（实测）
- server 无 terminal 模块；`agent/` 的工具体系成熟（`tools/registry.ts` + 各工具定义），加工具是既有模式。
- Electron 打包需要 native 模块，`node-pty` 需随 `extraResources` 进包。

### 任务
- `web/server/src/terminal/pty-manager.ts`：`node-pty` 启动会话（按 workspace 目录）、超时/配额（防无限运行）、kill 清理。
- `web/server/src/tools/terminal.ts`：注册工具 `terminal_run(cmd, cwd?, timeout?)` / `terminal_kill(id)`，输出截断到上限。
- 工具纳入角色可用工具白名单（默认**关闭**，角色启用才可见——安全默认）。
- 前端**暂不做**独立终端页（P2 后置）；输出通过既有 tool 消息展示。

### 涉及文件
- 新增：`web/server/src/terminal/**`、`web/server/src/tools/terminal.ts`、`test/terminal-tool.test.ts`
- 修改：`web/server/package.json`（+`node-pty`）、`tools/registry.ts`、角色工具默认配置

### 验收
- 单测：`terminal_run('echo hi')` 返回输出；超时命令被 kill；危险命令需 approval（走既有 approval 机制）。
- `npm test --prefix web/server` 绿；桌面打包产物能加载 node-pty（打包冒烟）。

### 风险
- `node-pty` 在 Windows/mac/Linux 需对应预编译二进制；若打包失败，降级为 `child_process.spawn` + `shell:true`（丧失真实 TTY，但命令执行闭环可先成立）。

---

## 7. M5 — 浏览器自动化轻量版（3–4 天）

### 目标
Agent 可打开网页、点击、抽取文本，用 Playwright（脚本化）而非维护常驻 Chromium 进程树。

### 现状（实测）
- server `tools/` 无浏览器工具；根 `package.json` 已有 `@playwright/cli` 依赖（预留信号）。
- 对比报告建议即「Playwright 作为 Agent 工具」，本期照做。

### 任务
- `web/server/src/browser/browser-manager.ts`：Playwright 启动（headless，默认拒绝下载/弹窗，注入超时与并发上限，每个 run 结束强制 close）。
- `web/server/src/tools/browser.ts`：`browser_open(url)` / `browser_snapshot()`（文本化页面）/ `browser_click(selector)` / `browser_type(selector,text)` / `browser_close()`，上下文按 run 隔离。
- 安全：默认只放行 http/https，`file://` 与局域网跳转记录并提示；纳入 approval 风险级别。
- 前端：可选只读「浏览器快照」视图（Markdown 渲染即可），不做实时预览。

### 涉及文件
- 新增：`web/server/src/browser/**`、`web/server/src/tools/browser.ts`、`test/browser-tool.test.ts`
- 修改：`web/server/package.json`（+`playwright`）、`tools/registry.ts`

### 验收
- 单测/冒烟：打开本地测试页 → snapshot 含标题文本 → click/type 生效 → close 后无残留进程。
- 打包冒烟确认 Chromium 可随包/或按平台下载并缓存。

### 风险
- 包体积（Chromium ~150MB）。对策：`playwright-core` + 按需下载，或让用户首次使用时在设置页触发下载（对标 NomiFun「自托管但可按需」）。

---

## 8. M6 — 跨平台 CI（2–3 天）

### 目标
三平台（win/mac/linux）构建与发布自动化，避免手工出包。

### 现状（实测）
- **无 `.github/workflows`**。
- `desktop/electron-builder.yml` 已含 win(nsis)/mac(dmg+zip)/linux(AppImage+deb) 配置与发布源（官网 + GitHub）；`electron-builder.yml` 注释已声明 mac 需要 `-c.mac.notarize=true` 与 `icon.icns`（当前缺）。
- 根 `package.json` 已有 `dist:win/mac:x64/mac:arm64/linux:x64` 脚本；`scripts/assemble-desktop-release.mjs` 等发布辅助脚本已存在。

### 任务
- 新增 `.github/workflows/build-release.yml`：三平台矩阵 job，各自 `npm ci` → `build` → `prepare-desktop-runtime` → `electron-builder --publish never` → 上传 artifact；`release` 标签触发 `gh release upload`（沿用 electron-builder.yml 的 publish 配置与 assemble 脚本）。
- mac job：`-c.mac.notarize=true`，凭据走 secrets（`APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID`）；生成 `assets/icon.icns` 前置任务（或用 electron-builder 自动转 png→icns）。
- 加一个 `smoke` job：win 上跑 `scripts/smoke-packaged.mjs` 验证打包产物可启动。

### 涉及文件
- 新增：`.github/workflows/build-release.yml`
- 修改：`desktop/electron-builder.yml`（若需调整 icns 生成/notarize 开关）、`docs/` 发布清单

### 验收
- push 后三平台 artifact 出现；`release` tag 后产物发布到 GitHub + 官网源。
- `scripts/verify-desktop-release.mjs` / `verify-release-version.mjs` 在 CI 上通过。

### 风险
- mac 构建需 macOS runner + 签名证书（付费）；无证书时先出**未签名**包并在 README 标注，不阻塞其他平台。

---

## 9. M7 — 密钥加密 + HTTP 适配层收口（2–3 天）

### 目标
1. Provider API Key 不再明文落盘。
2. HTTP 层也纳入传输抽象，为将来 Tauri/纯 Web 部署铺路。

### 现状（实测）
- `providerStore.ts` 的 Provider 记录 `api_key` **明文**存 SQLite；`has_api_key` 只是布尔标记。
- `api/eventBus.ts` 已有 ipc/SSE 传输抽象；`api/client.ts` 的 HTTP 仍是裸 `fetch` + `VITE_API_URL`。

### 任务

#### M7.1 密钥加密
- `web/server/src/providers/crypto.ts`：`crypto.createCipheriv('aes-256-gcm')`，密钥来源优先级：`TIANSHU_MASTER_KEY` 环境变量 → `<dataDir>/config/.master-key`（首次生成，chmod 600）→ keychain（可选）。
- `providerStore`：`api_key` 列存密文（`enc:v1:<iv>:<tag>:<cipher>`），读取时仅回显掩码 + `has_api_key`；真正用 key 只在 LLM 调用内解密。
- 迁移：已有明文 key 启动时一次性加密（`db/migrations` 或启动迁移）。
- `provider-oauth.ts` 的 token 同样加密。

#### M7.2 HTTP 适配层收口（轻量）
- 新增 `web/client/src/adapter/types.ts` 定义最小 `HttpBridge` 接口（`request(method, path, body)`）；`httpBridge.ts` 实现 fetch 逻辑（把 `client.ts` 的超时/JSON 逻辑搬入）；`ipcBridge.ts` 在桌面壳时把 `window.tianshuDesktop` 的可用能力映射进来（如打开目录/读取本地文件）。
- `api/client.ts` 改为消费 `HttpBridge`，其余 api 文件**零改动**。

### 涉及文件
- 新增：`web/server/src/providers/crypto.ts`、`web/client/src/adapter/**`
- 修改：`db/providerStore.ts`、`llm/` 调用链、`api/client.ts`、`desktop` preload（如需暴露文件能力）

### 验收
- 存库后直接 `SELECT api_key` 看到密文；UI 显示掩码；LLM 调用用密钥正常。
- 重启/换机后配置了 `TIANSHU_MASTER_KEY` 仍可解密；未配置时用本机 `.master-key`。
- `npm run build`（server+client+desktop）通过；既有 `provider-api.test.ts` 等测试按新加解密适配后全绿。

### 风险
- 密钥丢失 = 数据不可读。对策：`.master-key` 备份提示 + 设置页「导出/导入密钥」的提示文案，不做自动找回。

---

## 10. 依赖与并行关系

```
M0 数据地基 ──► M1 进化解耦+闭环 ──► M2 进化工作台
    │
    ├──────────► M3 知识库最小可用（可与 M1/M2 并行）
    │
    ├──────────► M4 终端（独立）
    │
    ├──────────► M5 浏览器（独立）
    │
    └── M6 跨平台 CI（不依赖代码，随时可做）
        └── M7 加密 + 适配层（依赖 M0 的 migration 基座）
```

- **必须串行**：M1 依赖 M0（trajectories/skill_drafts 走 migration）；M2 依赖 M1（草稿 API）。
- **可并行**：M3、M4、M5、M6 彼此独立，也与 M1/M2 解耦。
- **建议节奏**（单人）：M0→M1→M2 连做（地基+差异化主线），期间穿插 M6（CI 早建早用）；M3 排在 M2 后；M4/M5 按兴趣与打包风险选择先后；M7 最后收口。

## 11. 各里程碑验收汇总（可勾选）

- [ ] M0：`_migrations` 表存在且版本齐全；双开被锁拦截；`migrator.test.ts` 绿
- [ ] M1：`selfEvolution` 全仓无残留；`trajectories` 有数据；定时挖掘产出 `skill_drafts`；批准/驳回 API 生效且 `skills/` 只在批准后变化
- [ ] M2：`/evolution` 页面可用，配置可存、洞察可回溯、草稿可审
- [ ] M3：FTS5 探针绿；知识库 CRUD+搜索（中英）通过；`KnowledgePage` 不再占位
- [ ] M4：`terminal_run` 工具可执行、可超时 kill、危险命令走审批
- [ ] M5：浏览器工具能开页/点击/抽取，无残留进程
- [ ] M6：三平台 artifact + release 自动发布
- [ ] M7：`api_key` 存储为密文；HTTP 走 `HttpBridge`

---

## 12. 未纳入本期（明确不做）

- **Electron → Tauri 迁移**：只在 M7 把适配层收口，为将来零成本切换做准备，不在本期动手。
- **Rust 后端**：不引入。
- **Embedding/向量检索**：M3 只做 lexical-only，向量接口（`04-0期` 已定义）留待后续。
- **多渠道接入（Telegram/Lark/微信）**：对比报告 P2-11，本期不做（依赖事件系统的入站适配，另立专题）。
- **创意工作台 / Mini Apps / Companion 游戏化**：属于产品方向决策，超出「优化」范畴，另行立项。
