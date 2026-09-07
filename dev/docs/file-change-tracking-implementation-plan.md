# 文件修改追踪（审阅侧边栏）— 实施方案 v2

> 目标：把天枢聊天页的「文件」侧边栏（FilePanel）升级为 opencode 审阅式**文件修改追踪**：
> 实时列出 agent 改动过的文件（目录树、A/M/D 状态徽标、`+N / -N` 行数），并可查看文件级 diff。
>
> **v2 修正**（相对 v1 分析版）：基线从「每会话文件副本快照」改为 **opencode 同款的「每项目 git 快照仓库」**，
> 覆盖范围从「仅 write/edit」扩展为 **全工作区（含 bash 改动）**，diff 引擎从「自写 LCS」改为 **系统 git 命令行**（零 npm 依赖）。
> v1 的「每会话副本 + 自写行数 diff」降级为 **git 不可用时的兜底路径**。

---

## 〇、总览

```
┌─ git 快照仓库（每项目一个，跨会话共享）──────────────────────────┐
│  <dataDir>/.snapshots/<hash(workspaceRoot)>/.git               │
│  --git-dir → 快照仓库；--work-tree → 真实 workspace 根           │
│  ensure(): 懒初始化（core.autocrlf=false / quotepath=false /    │
│            黑名单 exclude）                                     │
│  track():  git add -A + commit → 基线 hash                     │
│  diff():   git diff + git stats + git status                   │
│           → FileDiff[]{file, patch, additions, deletions,       │
│                        status: A|M|D}                          │
└───────────────────────────┬────────────────────────────────────┘
                            │ 全量快照 diff（run 结束时，覆盖 bash 改动）
┌─ agent 层（outer.ts run 钩子）─────────────────────────────────┐
│  run 开始：gitSnapshot.track() → 基线 hash                     │
│  run 结束：gitSnapshot.diff(基线) → 写 file_changes 表           │
│  （source='snapshot'；tool_call_id=NULL）                      │
│  实时增量：write/edit 的 tool.completed 事件带 file 字段         │
│  （source='tool'；tool_call_id 有值，前端即时展示）              │
└───────────────────────────┬────────────────────────────────────┘
                            │ SSE 事件 / REST
┌─ 前端（chatStore → FilePanel）────────────────────────────────┐
│  fileChanges 状态：按会话聚合（目录树 + 徽标 + +N/-N）            │
│  可选项目全局视图（同 workspace 多会话汇总）                     │
│  点文件 → git unified patch 直渲 diff 预览（P3）                │
└─────────────────────────────────────────────────────────────────┘
```

**设计决策（v2，对齐 opencode）**
| 维度 | opencode | 天枢 v2（本方案） | 说明 |
|---|---|---|---|
| 基线 | 每项目全局 git 快照仓库 | **同款：每项目全局 git 快照仓库** | 多会话共享基线，跨会话看同一项目改动 |
| 追踪范围 | 全工作区（含 bash） | **全工作区（含 bash）** | git 快照天然覆盖；work-tree 外文件两方都抓不到 |
| 引擎 | git | **系统 git 命令行**（`spawn('git', ...)`） | 已核实开发机 git 2.55.0 可用；零 npm 依赖，天枢 bash 工具即此模式 |
| 项目标识 | projectID | `workspace 根` → `sha256(根)[:16]` | 天枢会话即项目投影，workspace 根即项目根 |
| 会话归属 | 全局展示 | `file_changes` 双键 `project_key + session_id` | 按会话看 / 按项目全局看 两种视图都支持 |
| git 缺失 | 硬依赖 | **降级路径**：write/edit 行数 + 无全量 diff | 不因缺 git 而整体不可用 |

---

## P1 快照引擎与数据层（核心，先交付）

### P1.1 git 快照仓库模块

**新建**：`web/server/src/agent/snapshot/git-snapshot.ts`

```ts
export interface SnapshotFileDiff {
  file: string
  patch: string            // unified diff 文本
  additions: number
  deletions: number
  status: 'added' | 'deleted' | 'modified'
}

/** patch 单文件上限：超过只给行数不给 patch，防 1MB 文件撑爆内存/传输 */
export const MAX_PATCH_BYTES = 512 * 1024

export const gitSnapshot = {
  /** 探测 git 可用性（模块加载时一次）：git --version 成功 → true */
  available(): boolean,

  /** 快照仓库就绪。不存在则 init（--bare 或 --separate-git-dir 均可，
   *  配置 core.autocrlf=false、core.quotepath=false，并把黑名单写入
   *  core.excludesfile，见下）。workTree 必须是已存在的绝对路径。 */
  ensure(projectKey: string, workTree: string): Promise<void>,

  /** 记基线：git add -A + commit；无任何改动时返回 undefined（不产生空 commit） */
  track(projectKey: string): Promise<string | undefined>,

  /** diff 基线 commit → 当前工作区：git diff <base>（含 status）+
   *  git status 抓 untracked（新增文件）。返回 FileDiff[]。 */
  diff(projectKey: string, base: string): Promise<SnapshotFileDiff[]>,

  /** diff 最新 commit → 当前工作区（项目全局视图：所有未提交改动） */
  diffWorking(projectKey: string): Promise<SnapshotFileDiff[]>,

  /** 回滚：git read-tree <base> 还原工作区（对齐 opencode restore；本版可选实现） */
  restore(projectKey: string, base: string): Promise<void>,
}
```

**实现要点**
- **命令形式**：`git --git-dir=<快照仓库> --work-tree=<workspace根> <cmd>`；`cwd` 设 workspace 根；`windowsHide: true`（桌面端无控制台窗口）；超时（首次 add 大目录可放宽到 120s，后续 30s）。
- **黑名单**：快照仓库的 `core.excludesfile` 指向仓库内 `.gitignore`，内容（对齐天枢 dev/.gitignore + 常见噪音）：
  ```
  node_modules/
  dist/
  build/
  *.db *.db-shm *.db-wal *.sqlite*
  .git/
  .codegraph/
  .snapshots/
  .cache/
  ```
  工作区自带的 `.gitignore` 在 `--work-tree` 下会自然生效（git 相对 work-tree 读），快照仓库黑名单做兜底。
- **untracked 大文件保护**：`git status` 先扫 untracked，`statSync` 超阈值（如 >1MB）的文件不进快照（对齐 opencode `large` 集合过滤）。
- **中文/CRLF**：`core.quotepath=false`（中文路径 patch 可读）、`core.autocrlf=false`（行数统计与 patch 稳定）。
- **首次性能**：懒初始化（首个会话 run 开始才 ensure+track）；node_modules 等被排除后 add 量级可控；可加 `TIANSHU_SNAPSHOT_MAX_BYTES` 环境变量兜底。

**验证**：vitest 单测用临时目录（`mkdtemp`）造一个迷你 git 仓库：init → 写文件 → track → 再改 → diff 返回正确 `additions/deletions/status`；untracked 新增文件被计入；黑名单目录不计入。

### P1.2 数据库 migration v6 — `file_changes` 表（双键）

**文件**：`web/server/src/db/migrations/index.ts`（数组末尾追加）

```ts
{
  version: 6,
  name: 'file_changes',
  up: (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS file_changes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_key TEXT NOT NULL,          -- sha256(workspace根)[:16]；无 workspace 会话不写快照行
        session_id TEXT NOT NULL REFERENCES sessions(id),
        run_id TEXT,
        tool_call_id TEXT,
        source TEXT NOT NULL DEFAULT 'tool'
          CHECK(source IN ('tool','snapshot')),  -- tool=write/edit 实时行；snapshot=run 结束全量行
        path TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('created','updated','deleted','noop')),
        additions INTEGER NOT NULL DEFAULT 0,
        deletions INTEGER NOT NULL DEFAULT 0,
        hash TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_file_changes_session
        ON file_changes(session_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_file_changes_project
        ON file_changes(project_key, created_at);
      CREATE INDEX IF NOT EXISTS idx_file_changes_run
        ON file_changes(run_id);
    `)
  },
},
```

**设计要点**
- `project_key` 是**第一键**：快照基线按它管理；`session_id` 是展示键：按会话过滤。
- `source` 区分两类来源；聚合时**按 path 取最新一条**（`ORDER BY id DESC LIMIT 1`），run 结束的 snapshot 全量行（git 校准后的权威数字）自然覆盖 tool 实时行。
- 会话删除语义（**重要修正**）：`sessionStore.delete()` 事务里只追加 `DELETE FROM file_changes WHERE session_id = ?`；**快照仓库不删**（同一 workspace 其他会话共享基线，删了即断）。快照仓库的清理走独立策略（见 P1.7）。

**验证**：`npm test`（migrations 相关）+ dev server 起库后 `PRAGMA table_info(file_changes)` 12 列。

### P1.3 会话 run 钩子（outer.ts）

**文件**：`web/server/src/agent/outer.ts`

在 `sessionLoop()` 中：
1. **run 开始**（`const workspace = resolveWorkspace(...)` 之后）：
   ```ts
   let snapshotBase: string | undefined
   if (workspace && gitSnapshot.available()) {
     const projectKey = projectKeyFor(workspace)
     await gitSnapshot.ensure(projectKey, workspace).catch(() => {})
     snapshotBase = await gitSnapshot.track(projectKey).catch(() => undefined)
   }
   // snapshotBase === undefined 且 git 可用但 track 无改动 → 本次 run 无新改动，跳过结束 diff
   ```
2. **run 结束**（loop 返回后、`run.completed` 前）：
   ```ts
   if (workspace && snapshotBase) {
     const diffs = await gitSnapshot.diff(projectKey, snapshotBase).catch(() => [])
     fileChangeStore.recordSnapshotBatch(sessionId, runId, projectKey, diffs)
   }
   ```

**新建**：`web/server/src/db/fileChangeStore.ts`

```ts
export interface FileChangeRow {
  id: number; project_key: string; session_id: string; run_id: string | null
  tool_call_id: string | null; source: 'tool' | 'snapshot'; tool_name: string | null
  path: string; status: string; additions: number; deletions: number
  hash: string | null; created_at: number
}

export const fileChangeStore = {
  recordTool(row: {...}),                       // P1.4 实时行
  recordSnapshotBatch(sessionId, runId, projectKey, diffs: SnapshotFileDiff[]): void,  // 批量写
  listBySession(sessionId: string, limit = 1000): FileChangeRow[],
  /** 聚合：按 session 内 path 取最新行 → 侧边栏直接渲染 */
  aggregateBySession(sessionId: string): FileChangeView[],
  /** 聚合：按 project 全局（可选视图） */
  aggregateByProject(projectKey: string): FileChangeView[],
  deleteBySession(sessionId: string): void,
}
```

`aggregateBySession` SQL 核心（最新行胜出 + 行数累加只对 tool 实时行做，snapshot 行直接覆盖）：

```sql
SELECT path,
       (SELECT status   FROM file_changes f2 WHERE f2.session_id = ? AND f2.path = f.path ORDER BY id DESC LIMIT 1) AS status,
       (SELECT additions FROM file_changes f2 WHERE f2.session_id = ? AND f2.path = f.path ORDER BY id DESC LIMIT 1) AS additions,
       (SELECT deletions FROM file_changes f2 WHERE f2.session_id = ? AND f2.path = f.path ORDER BY id DESC LIMIT 1) AS deletions,
       MAX(created_at) AS updated_at
FROM file_changes f
WHERE f.session_id = ?
GROUP BY f.path
ORDER BY updated_at DESC
```

**注意**：opencode 快照是「每次工具批次后 diff 增量」；天枢取「run 为最小单位」（会话多 run 各自 diff 其基线），对同一会话连续 run，后续 run 的基线 = 前一个 run 结束后的状态，diff 结果自然接续，不会重复计数。跨会话共享同一 project_key 时，会话 B 的 run 基线可能包含会话 A 的改动 → 会话 B 的 file_changes 里会出现 A 改的文件（status=modified、行数为 B 视角）。**这是特性不是缺陷**：对齐 opencode 的「项目全局改动视图」；若只要「本会话改动」，展示层按「该 path 在本会话内首次出现的时间窗口」过滤（简单版：聚合结果里剔除 created_at 早于本会话首个 run 的行——P2 再细化，先按最新行展示）。

### P1.4 tool.completed 实时增量（write/edit）

**文件**：`web/server/src/tools/write/index.ts`、`web/server/src/tools/edit/index.ts`
- write 的 noop/正常分支 `metadata` 增加 `additions/deletions`（改前 `readFileSync` 拿旧内容，`diffLines` 计算；失败回退 0/0）；
- edit 的 `metadata` 增加 `status:'updated'` + `additions/deletions`（复用 `matchers.ts` 命中信息：`lineCount(newString)/lineCount(old)`，replaceAll 时近似）。

**文件**：`web/server/src/agent/inner.ts` `runOne()`
- `rec` 之后：`meta.path && changed && sessionId` → `fileChangeStore.recordTool({...})`（source='tool'）；
- `tool.completed` 事件 payload 追加 `file: { path, status, additions, deletions }`。

**保留**：`web/server/src/tools/diff-utils.ts`（v1 的 P1.2 行级 diff）——既用于上面 write/edit 行数计算，也是 **git 缺失时的降级主路径**（P1.6）。

**验证**：dev server 让 agent 执行 write/edit → SSE `tool.completed.file` 可见 + file_changes 出现 source='tool' 行。

### P1.5 REST 接口

**文件**：`web/server/src/routes/sessions.ts`

```ts
// GET /api/sessions/:id/file-changes?scope=session|project
router.get('/:id/file-changes', (c) => {
  const id = c.req.param('id')
  const scope = c.req.query('scope') === 'project' ? 'project' : 'session'
  const files = scope === 'project'
    ? fileChangeStore.aggregateByProject(projectKeyForSession(id))
    : fileChangeStore.aggregateBySession(id)
  return c.json({ scope, files })
})

// GET /api/sessions/:id/file-changes/:path/diff  → 该文件 unified patch
// 实现：git diff <基线> -- <path>；基线取该会话最近一次 run 的 snapshot 基线
//      （runs 表或 file_changes 里 run 行关联）；拿不到基线时用 diffWorking 单文件
router.get('/:id/file-changes/:path/diff', ...)
```

**客户端类型**（`web/client/src/types/index.ts`）：

```ts
export interface FileChange {
  path: string
  status: 'created' | 'updated' | 'deleted'
  additions: number
  deletions: number
  updatedAt?: number
}
```

### P1.6 git 缺失降级路径

- **探测**：`gitSnapshot.available()`（模块加载时 `git --version`，缓存结果）。
- **降级行为**：
  - 快照层（P1.1/P1.3/P1.5 diff）整体跳过；
  - 保留 P1.4 的 write/edit 行数实时追踪（`file_changes` 只有 source='tool' 行）；
  - 前端 FilePanel 顶部显示「git 不可用，仅追踪 write/edit」提示条（P2 加）。
- **恢复**：探测是每次服务启动时做一次；git 装上后重启即恢复全量能力。

### P1.7 快照仓库生命周期与清理

- **位置**：`<dataDir>/.snapshots/<projectKey>/`（`projectKey = sha256(workspace根).slice(0,16)`）。
- **清理策略**（对齐现有 `sweepDataRetention` 模式，`web/server/src/app.ts` 启动钩子处追加）：
  - 每启动扫描一次：删除「最近 30 天（`TIANSHU_SNAPSHOT_RETENTION_DAYS` 可配）内没有任何会话活跃」的项目快照仓库；
  - 会话删除**不**级联删仓库（理由见 P1.2）；
  - 仓库本身体积保护：`.git` 只存 commit 对象，黑名单已排除大目录；必要时 `git gc --aggressive` 定期执行（低频，先不做）。
- **项目活跃度**：以 `file_changes` 按 project_key 的 MAX(created_at) 或 sessions.updated_at 为准。

**验证**：手测——删会话后快照仓库仍在（diff 基线不断）；改 workspace 下文件 30 天无会话后仓库被清。

---

## P2 侧边栏 UI：对齐 opencode 审阅文件树

### P2.1 FilePanel 重写

**文件**：`web/client/src/components/Chat/FilePanel.tsx`（重写，保留「附件」分组与「打开所在目录」）

```
┌ 文件改动  (+12 −3 · 4)        [✕]
├─ src/
│  ├─ A  new-file.ts        +8
│  └─ M  chatStore.ts      +4 −3
├─ docs/
│  └─ D  old-plan.md        −12
├─ 附件（保留原分组）
└─ [git 不可用提示条，仅降级时显示]
```

**要点**
- **文件树**：自写 `buildTree(paths)`（`/`、`\` 切分；目录节点本地 `useState<Set<string>>` 控制展开）；
- **状态徽标**：`A`(绿) / `M`(金) / `D`(红)，CSS 小方块，对齐 opencode `fileTreeRowStatus`；
- **+N/-N**：右对齐，`+N` 用 `--diff-added`（绿）、`-N` 用 `--diff-removed`（红）。**注意：index.css 目前无这两个变量，P2.2 需新增并随明暗主题联动**；
- **汇总**：头部 `+N −N · 文件数`；>N 个文件时列表默认折叠（对齐 opencode `list().length > 2`）；
- **视图开关（可选）**：会话 / 项目全局 两个 tab（`scope=session|project`，对应 P1.5 接口）；默认会话视图；
- **空态**：「本次会话暂无文件改动」。

### P2.2 样式与文案

**文件**：`web/client/src/index.css` — 追加 `.fp-tree-*`、`.fp-status-A/M/D`、`.fp-diff-stat`、`--diff-added/--diff-removed` 变量（明暗主题各分支）；
**文件**：`web/client/src/i18n/dict.ts` — 新增键：`'文件改动'`、`'本次会话暂无文件改动'`、`'会话'`/`'项目'`（视图 tab）、`'git 不可用，仅追踪 write/edit'`。

**验证**：`npm run build`（web/client tsc+vite）+ 手测树形/徽标/折叠/空态。

---

## P3 diff 查看器（对齐 opencode diff-viewer）

### P3.1 数据源
- **主路径**：`GET /api/sessions/:id/file-changes/:path/diff` → git unified patch（P1.5），前端直渲。
- **降级路径**：git 缺失时该接口返回 501 + 前端提示「git 不可用，无法查看 diff」。

### P3.2 前端渲染

**文件**：`web/client/src/components/Chat/FileDiffViewer.tsx`（新建，FilePanel 内联展开）
- 点文件 → 行内展开 `<pre>` 渲染 unified diff（`+`绿 / `-`红 / 上下文灰），手写按行首字符着色（不引依赖，复用 TrajectoryView 思路）；
- 工具条：`path · +N −N` + 关闭；同一时刻只展开一个文件；
- 缓存：`chatStore.fileDiffs: Record<sessionId, Record<path, string>>`，同文件只拉一次。

**验证**：手测——bash 改文件 + write/edit 改文件后均能看 diff；切会话清展开态。

---

## 四、验收标准（全量）

1. agent 执行 write/edit **或 bash 改工作区文件**后，`file_changes` 出现正确行（status/additions/deletions 与 git 一致）；
2. write/edit 的 `tool.completed` SSE 携带 `file` 字段，前端无刷新即时更新；
3. run 结束快照 diff 校准后，bash 改动也出现在侧边栏（带正确行数）；
4. 侧边栏呈现目录树 + A/M/D 徽标 + `+N/-N`，折叠/展开、会话/项目视图可用；
5. 点文件看到 unified diff（git 路径）；git 缺失时界面友好降级；
6. 会话删除只清 file_changes 该会话行，项目快照仓库保留；
7. `npm test` 全绿、`tsc --noEmit` 干净、**不新增 npm 依赖**（git 走系统命令行）。

## 五、改动文件总清单

**服务端（web/server/src/）**
| 文件 | 动作 |
|---|---|
| `agent/snapshot/git-snapshot.ts`（+ test）| 新增 |
| `agent/snapshot/project-key.ts`（或并入 git-snapshot）| 新增（projectKeyFor） |
| `db/migrations/index.ts` | 改（v6 建表） |
| `db/fileChangeStore.ts`（+ test）| 新增 |
| `db/sessionStore.ts` | 改（delete() 追加 file_changes 清理） |
| `tools/diff-utils.ts`（+ test）| 新增（write/edit 行数 + git 缺失降级） |
| `tools/write/index.ts` / `tools/edit/index.ts` | 改（metadata 行数） |
| `agent/inner.ts` | 改（recordTool + tool.completed.file） |
| `agent/outer.ts` | 改（run 开始 track / 结束 diff 落库） |
| `routes/sessions.ts` | 改（file-changes + file-changes/:path/diff） |
| `app.ts` | 改（启动钩子：快照仓库 retention 清理） |

**前端（web/client/src/）**
| 文件 | 动作 |
|---|---|
| `types/index.ts` | 改（FileChange、RunEvent.file） |
| `api/sessions.ts` | 改（fetchFileChanges / fetchFileDiff） |
| `stores/chatStore.ts` | 改（fileChanges state + 增量 upsert + refresh） |
| `components/Chat/FilePanel.tsx` | 重写（文件树+徽标+统计+折叠+视图开关） |
| `components/Chat/FileDiffViewer.tsx` | 新增（P3） |
| `index.css` / `i18n/dict.ts` | 改 |

## 六、风险与回退

| 风险 | 应对 |
|---|---|
| git 首次 add 大目录慢 | 懒初始化 + 黑名单（node_modules/dist/*.db）+ untracked >1MB 跳过 + 环境变量兜底超时 |
| 快照仓库膨胀 | 黑名单 + 30 天活跃度清理 + 会话删除不清仓库（保基线） |
| bash 改 work-tree 外文件抓不到 | 与 opencode 一致（worktree 范围），如实标注 |
| 跨会话文件归属（会话 B 的 diff 含 A 的改动） | 对齐 opencode「项目全局视图」语义；「仅本会话」视图用时间窗口过滤（P2 细化） |
| CRLF/中文路径行数偏差 | `core.autocrlf=false` + `core.quotepath=false`（opencode 同配置） |
| git 不可用 | 降级：write/edit 行数实时追踪 + UI 提示条；重启探测恢复 |
| patch 体积 | 单文件 patch >512KB 只给行数不给 patch |

## 七、排期建议

| 阶段 | 内容 | 预估 |
|---|---|---|
| P1.1–P1.2 | git-snapshot 模块 + 建表 + store | 1 天 |
| P1.3–P1.5 | run 钩子 + 实时增量 + REST | 0.5 天 |
| P1.6–P1.7 | 降级路径 + 生命周期清理 | 0.5 天 |
| P2 | 文件树侧边栏（含视图开关） | 0.5–1 天 |
| P3 | diff 查看器 | 0.5 天 |
| 收尾 | 验收 + 文档 + 清理 | 0.5 天 |
