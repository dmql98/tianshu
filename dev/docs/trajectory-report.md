# tianshu 轨迹展示：调研报告与实现方案

> 调研对象：`deepseek-harness`（@deepseek-ai/dsh-client-ui-trajectory 包）
> 对标项目：`tianshu`（web/client + web/server）
> 目标：在 tianshu 实现同样详细（乃至更详细，含完整 LLM 输入输出）的轨迹展示
> 日期：2026-08-18（本机时间）

---

## 0.5 实现状态（2026-08-18 更新）

**M0（运行轨迹增强）、M1（debug 后端 API）、M2（调试详情视图）已全部实现并通过验证**
（前端 162 个单测、服务端 224 个单测、`npm run build` 均通过；M1 接口已对本机真实
`devdata/debug` 数据 curl 验证）。

新增/改动文件：

| 层 | 文件 | 说明 |
|---|---|---|
| 折叠层 | `web/client/src/features/trajectory/trajectory-layout.ts` | Turn→Group（消息/Step N）→行 三层模型 + 请求编号 + 累计用量 |
| 时间线 | `web/client/src/features/trajectory/timeline.ts` | sequence/duration 投影、三车道、拖选交集（仿 timeline.ts） |
| 组件 | `web/client/src/features/trajectory/TimelineBar.tsx` | 顶部 Overview 时间线（模式切换/拖选联动/轮次边界） |
| 视图 | `web/client/src/features/trajectory/TrajectoryView.tsx` | 集成：分组折叠、`#N` 编号、累计用量 chips、搜索 `<mark>` 高亮、焦点 dimming、「运行轨迹/调试详情」子页切换 |
| 组件 | `web/client/src/features/trajectory/DebugTimelineBar.tsx` | 调试视图 turn 粒度时间线 |
| 视图 | `web/client/src/features/trajectory/DebugTrajectoryView.tsx` | 调试详情：SYSTEM（完整 system prompt + 工具目录）/助手/工具记录、toolCall 结果跨轮关联、消息历史、懒加载 |
| 纯函数 | `web/client/src/features/trajectory/debugTrajectory.ts` | debug turn → 视图记录、汇总、时间线 |
| API | `web/client/src/api/debug.ts` | 四个 debug 接口的客户端封装 |
| 后端 | `web/server/src/routes/debug.ts` | `GET /api/debug/sessions[/:id][/turns][/turn/:n]`（只读、白名单防穿越、64KB 截断、工具按名去重），注册于 `app.ts` |
| 样式 | `web/client/src/index.css` | `tjs-*` 新增时间线/轮次/分组/debug 系列 |
| 测试 | `trajectory-layout.test.ts`、`timeline.test.ts`、`debugTrajectory.test.ts` | 纯函数层单测 |

使用方法：聊天页「轨迹」分页顶部新增「运行轨迹 / 调试详情」切换；调试详情默认读取
`devdata/debug` 全部会话（含每轮完整请求/响应），支持会话/会话段选择、时间线拖选、
搜索高亮与按需展开。M3（虚拟化/导出/并排对照）未做，如需可续。

---


## 0. 结论摘要

- **deepseek-harness 轨迹的本质**：一个"轮次感知的事件账本"。数据管道为四层：
  `运行时事件快照 → 布局折叠（Turn→Group→Cell）→ 时间线投影（4 模式 3 车道）→ 虚拟化表格 + 局部检查器`。
  核心契约是统一记录模型 `TrajectoryCellProps`（7 种 kind），所有能力（时间线、搜索、折叠、检查器）都只依赖这一层。
- **tianshu 现状**：已有一个 274 行的 `TrajectoryView` + 246 行的 `trajectory.ts` 纯函数层，基于
  `GET /api/runs/:id/trajectory`（messages + 非流式 events），覆盖"运行选择 + 汇总 chips + 可展开流水账 + 搜索"，
  但缺时间线、轮次分组、请求编号、系统提示/工具目录展示、虚拟化。
- **debug 目录是金矿**：`devdata/debug/*/merged_*.json` 记录了**每次 LLM 调用的完整请求**
  （system prompt、完整消息历史、工具定义 tools）与响应（text / reasoning / toolCalls / usage / error），
  且带 `fp`（system prompt 指纹）和 `turn` 序号。这是 deepseek-harness 轨迹里 SYSTEM 记录才能看到的
  "完整输入"信息，tianshu 的 runs 接口没有。
- **建议路线**：M0 先用现有 runs 数据补"骨架"（时间线 + 分组折叠 + 请求编号 + 累计用量，纯前端，
  与 deepseek-harness 对齐）→ M1 新增 debug 后端 API → M2 debug 前端视图（完整输入输出可视化）→ M3 交互增强。
  M0 与 M1/M2 数据源独立，可并行或串行，互不阻塞。

---

## 1. deepseek-harness 轨迹实现剖析

### 1.1 包结构与职责

`packages/client/ui-trajectory/src/client/`（约 7.9k 行源码）：

| 文件 | 行数 | 职责 |
|---|---|---|
| `TrajectoryTable.tsx` | 3074 | 事件账本表格：虚拟化、折叠、局部检查器、diff 高亮 |
| `layout.ts` | 1126 | 布局折叠：节点流 → Turn→Group→Cell 三层模型 |
| `TrajectoryTimeline.tsx` | 731 | 顶部 Overview 时间线：拖选、缩放、边缘平移、tooltip |
| `TrajectoryView.tsx` | 507 | 视图编排：状态管理、请求编号、折叠集合、搜索索引调度 |
| `trajectory-assistant-definition.ts` | 406 | 从共享会话事件组装 assistant 业务记录（含取消冻结） |
| `trajectory-snapshot-builder.ts` | 284 | 构建 trajectory 专属快照（eventNodes / partial / runningCalls） |
| `trajectory-tool-definition.ts` | 273 | 工具调用记录的组装与折叠 |
| `timeline.ts` | 200 | 时间线投影：sequence / duration / time / actual 四模式 |
| `trajectory-record.ts` | 130 | **核心数据契约** `TrajectoryCellProps` + recordId 稳定性 |
| 其余 | ~1k | 搜索索引、虚拟行、折叠定义、toolbar、单元格渲染等 |

### 1.2 四层数据管道（核心架构）

```
① 会话快照（runtime 包）
   ConversationSnapshot.nodes        —— 语义节点（user/assistant/tool/context…），带 seq 顺序
   partial / runningCalls            —— 流式进行中的内容与工具调用
   requests[]                        —— 每次 LLM 请求的元数据（turn/step/status/usage/retry/promptChange）
   callSchemas                       —— 调用时的工具 schema

② 布局折叠 layout.ts
   deriveTrajectoryLayout()          —— 合并 nodes+requests+compaction，排序后折叠成：
     Turn(turn号) → Group(「Message」或「Step N」) → Cell(TrajectoryCellProps)
   pushStepInput() 支持把「请求输入」插到 Step 组头部（requestOnly 分隔行）

③ 时间线投影 timeline.ts
   deriveTrajectoryTimeline(turns, mode)
     mode: 'sequence' 等宽序列 | 'duration' 真实时长 | 'time' 含 idle | 'actual' 压缩 idle
     三车道: lane0=system/user/context, lane1=message/compacted, lane2=tool/subtool

④ 渲染层
   TrajectoryTable   —— 虚拟化行（tanstack/react-virtual），VIRTUALIZATION_THRESHOLD=100
   TrajectoryTimeline—— 顶部 Overview，与表格双向联动（选择/缩放/焦点）
   TrajectoryToolbar —— 折叠全部/搜索
```

### 1.3 核心数据契约：`TrajectoryCellProps`（trajectory-record.ts）

7 种 kind 统一建模，是全部功能的单一数据源：

```ts
type TrajectoryCellKind = 'system' | 'user' | 'context' | 'compacted' | 'message' | 'tool' | 'subtool'

interface TrajectoryCellProps {
  index: number            // 1-based 记录号 #N
  recordId?: string        // 投影稳定标识（向前补页不漂移）
  kind: TrajectoryCellKind
  text: string             // 单行摘要（CSS ellipsis）
  previewMarkdown?: string // Markdown 预览源
  inputDetail?: string     // 完整请求/消息内容（检查器）
  outputDetail?: string    // 完整助手/工具结果（检查器）
  thinkingDetail?: string  // 完整 reasoning（检查器）
  schemaDetail?: string    // 调用时工具 schema（检查器）
  promptDetail?: ConversationPromptSnapshot  // SYSTEM 记录：完整 system prompt + 工具目录
  sourceBlocks / outputBlocks: TrajectorySourceBlock[]
  assistantMetrics?: { timingRecorded, stepStartTime, firstTokenTime, completedTime, usageProvided, outputTokens }
  timeSeconds: number | null   // 自有耗时（秒）
  startedAt?: number | null    // 实际开始时刻（epoch ms）
  input?: number; cacheRead?: number; cacheWrite?: number; output?: number; think?: number  // usage
  callId?: string; isError?: boolean; result?: string; requestOnly?: boolean
}
```

**recordId 稳定性规则**（trajectory-record.ts:105）：`recordId` 优先，其次 `kind\0call\0{callId}`，
再其次 `kind\0seq\0{sourceSeq}`，最后才退回 `kind\0index\0{index}`。这是"向前加载更早历史时
行键/ARIA 索引不变"的基础。

### 1.4 时间线设计（timeline.ts）

- **4 种投影模式**（工具栏切换）：
  - `sequence`：按记录序号等宽排布，不看真实时间
  - `duration`：按记录真实耗时排布，压缩空闲（idle）
  - `time`：完整墙钟时间（含 idle 空隙）
  - `actual`：真实耗时 + 压缩 idle（实际时长视图）
- **三车道**：操作（tool/subtool）在 lane2，助手消息（message/compacted）在 lane1，输入（system/user/context）在 lane0。
- **拖选区间** → `trajectoryTimelineFocusIndexes()` 求出与区间重叠的记录集合 → 表格只高亮这些记录。
- **助手 TTFT/解码分段**：`assistantMetrics.stepStartTime → firstTokenTime → completedTime`，
  悬停 500ms 显示 tooltip（精确时刻 + TTFT 与解码耗时）。

### 1.5 表格 / 虚拟化 / 检查器（TrajectoryTable.tsx）

- **虚拟化**：少于 100 行不虚拟化；以上按窗口渲染（overScan 12 行）。流式帧只更新内容不重建行键。
- **折叠两级**：Turn 级（整轮折叠成摘要行）、Assistant 级（把其下 tool calls 折叠进消息行）。
- **SYSTEM 记录**：`promptChange.kind === 'initial'` 排在最前；更新时展示变更 diff（structuredPatch）。
- **请求编号**：requests 与 assistant nodes 按 seq 归并排序，非 compaction 请求编号 `#N`（Step N），
  compaction 单独编号并显示在轮次之间；累计用量随编号递进。
- **局部检查器**：点记录打开面板，显示 inputDetail / outputDetail / thinkingDetail / schemaDetail / sourceBlocks，
  即"这个记录当时的完整输入输出"。

### 1.6 可借鉴的交互能力清单（tianshu 对照用）

| 能力 | deepseek-harness | tianshu 现有 |
|---|---|---|
| 轮次分组（Turn 边界线） | ✅ Turn→Group 折叠 | ❌ 平铺流水账 |
| 顶部时间线 Overview | ✅ 4 模式/拖选/缩放 | ❌ |
| 请求编号 + 累计用量 | ✅ `#N` + cumulativeUsage | ❌（只有行内 usage） |
| 助手 TTFT/解码分段 | ✅ 时间条分段 + tooltip | ⚠️ 有数据（ttft_ms/decode_ms）但未可视化 |
| 完整 system prompt/工具目录 | ✅ SYSTEM 记录 | ❌ runs 接口无此数据 |
| 工具 schema 展示 | ✅ schemaDetail | ❌ |
| 虚拟化 | ✅ tanstack/react-virtual | ❌ 全量渲染 |
| 搜索 | ✅ 索引 + 高亮 | ⚠️ 有过滤但无高亮 |
| 局部检查器 | ✅ | ⚠️ 展开行内展示（等效简版） |

---

## 2. tianshu 现状

### 2.1 现有轨迹页（数据源：runs 接口）

- 前端：`web/client/src/features/trajectory/`
  - `TrajectoryView.tsx`（274 行）：运行下拉（`?run=` URL 深链）+ 状态/汇总 chips + 可展开流水账 + 搜索框。
    渲染 `TrajectoryRowView`：行 = user / assistant / tool，assistant 展开显示 reasoning/text/元信息，
    tool 展开显示参数/结果（>4000 字符截断可展开）。
  - `trajectory.ts`（246 行）：纯函数层。
    - `buildTrajectory(data)`：messages → rows（按 id 顺序），事件富化
      - `message.metrics` → llm_ms / ttft_ms / decode_ms / token_speed / cache{hit,miss}
      - `usage` 先落库于 metrics 的配对机制：用 `pendingUsage` 缓存，等 metrics 到达再挂上
      - `tool.completed` → 按 tool_call_id 或顺序匹配 `duration_ms`
      - 生命周期事件（run.* / approval.* / ask_user）单独成 lifecycle 条 + 重试计数
    - `summarizeTrajectory`：轮次/工具数/LLM 时长/工具时长/TTFT 均值/解码速率
    - `filterTrajectory`：文本匹配过滤（无高亮）
  - 样式：`web/client/src/index.css` 的 `tjs-*` 系列（1297-1334 行）。
- 后端：`web/server/src/routes/runs.ts:75` `GET /:id/trajectory` → `{ run, messages, events }`
  - messages 表行：`role(user/assistant/tool), content, reasoning_content, tool_name, tool_input, tool_output, tool_status, is_error, token_speed, created_at`
  - events：排除高流量流式类型（`message.delta`/`tool.output`），含 `message.metrics`/`usage`/`tool.completed`/`run.*`/`approval.requested`/`ask_user`
  - **局限**：没有 system prompt、没有工具定义、没有请求消息历史——这是 debug 目录独有的信息。

### 2.2 debug 数据管道

- **写入**：`web/server/src/debug/llm-logger.ts` — 每次 LLM 调用同步落盘到
  `{getDataDir()}/debug/{sessionId}/merged_N.json`：
  ```json
  { "turns": [ { "request": {"model","messages":[{role,content}...],"tools":[...]},
                 "response": {"text","reasoning","toolCalls":[{"id","index","type","function":{"name","arguments"}}],
                              "usage": {"input","output","cacheHit","cacheMiss"} | null},
                 "error": string | undefined,
                 "timestamp": ms, "turn": n, "fp": "sha256前12位" } ] }
  ```
  - `fp` = system prompt 前 500 字符的 sha256 前缀；**fp 变化时开新 merged_N.json**（agent/工具/技能被修改的会话段）。
- **合并**：`web/server/src/debug/merge-turns.ts` — 旧 `<ts>_turn<n>.json` 按轮次分组合并为 merged 文件；25 天自动清理。
- **消费**：`web/server/src/tools/debug_sessions/index.ts` — 纯文本渲染给模型看（debug_sessions 工具），**无 UI、无 HTTP API**。

### 2.3 debug 实际数据结构（本机样例）

| 会话 | turn | model | tools 数 | messages 数 | toolCalls | text | reasoning | usage | fp |
|---|---|---|---|---|---|---|---|---|---|
| msy3mj5n6xb5j0 | 0 | deepseek-v4-flash | 16 | 3 | 2 | 0 | 517 | 5117/398 | 0ea4bda9bbf0 |
| msy3mj5n6xb5j0 | 1 | deepseek-v4-flash | 16 | 6 | 0 | 311 | 109 | 11064/233 | 0ea4bda9bbf0 |
| msxzmay9knw366 | 0 | minimax-m3 | 19 | 3 | 0 | 498 | 0 | 6339/122（cacheHit 128） | 1cdc5d24c0c7 |
| msxzmay9knw366 | 2 | deepseek-v4-flash | 19 | 7 | 0 | 30 | 229 | 6780/67（cacheHit 6656） | 1cdc5d24c0c7 |

要点：
- 每 turn 的 `request.messages` 是**完整消息历史**（3→6→7 递增），含 system prompt（可达 5000+ tokens）→ 体积大，前端需懒加载/默认折叠。
- `tools` 定义每个 turn 都冗余（16-19 个工具全量）→ 显示时按 fp 去重即可。
- 无 TTFT/解码分段/工具耗时（usage 只有总量）→ 时间线只能到 turn 粒度，或由 M0 的 runs 数据补充。

---

## 3. 差距分析（一句话版）

deepseek-harness 把"**会话事件**"折叠成"**轮次+记录**"并投影到"**时间线+账本**"；
tianshu 把"**最终消息+非流式事件**"平铺成"**流水账**"。
tianshu 缺的不是数据（runs 有 metrics/usage，debug 有完整输入输出），而是**折叠与投影层**；
而 debug 目录独有完整输入（system prompt/工具定义/消息历史），是 runs 接口没有的。

---

## 4. 实现方案（目标：完整复刻 + debug 详情）

### 4.1 总体架构（复用 deepseek-harness 四层，适配 tianshu 数据）

```
tianshu 数据源（二选一/并行）:
  A. GET /api/runs/:id/trajectory  → messages + events   （现有，M0 用）
  B. GET /api/debug/sessions/:id    → turns[]（完整请求/响应）（新增，M1-M2 用）

统一折叠层 trajectory-model.ts（新增，仿 layout.ts）:
  runTurns → Turn{ turn, groups: Group[] } → Cell（仿 TrajectoryCellProps，精简版）
  debugTurns → 每个 turn 折叠成 Step 组：SYSTEM 记录 + assistant 记录 + tool 记录（按 toolCalls 展开）

渲染层（改造现有 TrajectoryView）:
  TrajectoryTimelineBar（新增，顶部时间线）
  TrajectoryLedger（改造现有流水账 → 分组/折叠/编号/高亮）
  DebugTrajectoryPanel（新增，debug 详情：完整请求/响应 JSON + 分块展示）
```

### 4.2 M0 — 现有轨迹页增强（纯前端，对齐骨架，可独立上线）

> 目标：runs 数据下也能"看到整个过程"，数据不动、只加展示层。工作量：1 个工作日。

1. **轮次分组**（`trajectory.ts` 扩展）：
   - 在 `buildTrajectory` 输出上按 `step` 分组：`Turn N → [Message 组, Step 1 组(user→assistant→tool), Step 2 组…]`。
   - Turn 级折叠 + Assistant 级折叠（折叠其下 tool 行），折叠状态复用现有 `expanded` 思路。
2. **时间线 Overview**（新组件 `TimelineBar.tsx` + `timeline.ts` 纯函数）：
   - 输入 rows（含 `startedAt`≈createdAt、`llmMs`、`ttftMs`、`decodeMs`、`durationMs`），输出 spans。
   - 模式：`sequence`（默认，等宽）/ `duration`（按耗时）。两模式先做，`time/actual` 可选。
   - 车道：assistant 一行、tool 一行；assistant 条内**TTFT/解码分段**（有 ttft_ms/decode_ms 数据）。
   - 拖选区间 → 高亮表格中重叠记录（参考 `trajectoryTimelineFocusIndexes`）。
3. **请求编号 + 累计用量**：assistant 行加 `#N`，汇总 chips 加累计 input/output；TTFT 均值已有。
4. **搜索高亮**：现有 `filterTrajectory` 保留，加 `<mark>` 高亮（文本/参数/结果）。
5. **虚拟化**（可选，M3）：行数 >200 时启用简单窗口渲染（不引 tanstack，先手写固定行高窗口即可）。

**验证**：`web/client` 下 `npm test`（trajectory.test.ts 扩展） + `npm run build` + 手工打开轨迹页截图。

### 4.3 M1 — debug 后端 API（新路由）

> 目标：把 `devdata/debug` 暴露成结构化接口。工作量：0.5 个工作日。

新增 `web/server/src/routes/debug.ts`（挂到现有 router 装配处）：

```ts
// GET /api/debug/sessions
// → [{ session_id, merged_files: [{ file, turns, first_ts, last_ts, fp }], total_turns }]
// GET /api/debug/sessions/:id?file=merged_1.json
// → { session_id, file, turns: DebugTurn[] }
//   DebugTurn = { turn, timestamp, fp, model,
//                 system_prompt: string,           // request.messages 中 role=system
//                 messages: Message[],              // 完整消息历史（懒加载时省略 content）
//                 tools: ToolDef[],                 // 工具定义
//                 response: { text, reasoning, toolCalls[], usage },
//                 error?: string }
// GET /api/debug/sessions/:id/turn/:turn            // 单 turn 详情（懒加载用）
```

实现要点：
- 直接复用 `llm-logger.ts` 的目录约定（`DEBUG_DIR()` 同源），不加新写入逻辑。
- `merged_N.json` 可能很大（多 turn × 完整历史）：列表接口**只返回元数据**（fp/turn/时间/usage 摘要），
  单 turn 详情按需拉取；`messages` 的 content 超长（如 >64KB）时先返回摘要 + `truncated: true`。
- 对 `tools` 按 fp 分组去重返回（前端展示"该会话段的工具目录"）。

**验证**：curl 三个接口，检查返回结构与大小；对照 `debug_sessions` 工具输出人工核对。

### 4.4 M2 — debug 前端视图（核心交付：完整输入输出可视化）

> 目标：每次 LLM 调用都能看到完整请求（system prompt、工具定义、消息历史）与响应（text/reasoning/toolCalls/usage/error）。
> 工作量：1.5-2 个工作日。

**入口**：轨迹页顶栏加"调试详情"切换（或独立 Tab），默认收起。

**视图结构**（仿 deepseek-harness 布局）：

```
┌ DebugTrajectoryView ─────────────────────────────────────┐
│ [会话选择] [merged 文件/会话段选择] [搜索] [折叠全部]       │  ← toolbar
│ ┌ TimelineBar（turn 粒度，sequence/duration）──────────┐ │
│ └──────────────────────────────────────────────────────┘ │
│ 轮次 1（fp 0ea4bda9bbf0）  ▼ 折叠                        │  ← Turn 头
│   ├─ [SYSTEM] 系统提示 · 16 工具 · sha256:0ea4bda9bbf0   │  ← SYSTEM 记录
│   │      ▸ 展开:完整 system prompt + tools JSON          │
│   ├─ [Step 1] 助手 · 5,117→398 tok · 2 次工具调用        │  ← assistant 记录
│   │      ▸ 展开: text / reasoning / toolCalls 列表       │
│   │      ├─ [TOOL] skill_manager(list_packages)         │  ← tool 记录
│   │      │      ▸ 参数 JSON ▸ 结果（取自下一轮 tool 消息）│
│   │      └─ [TOOL] skill_manager(activate)              │
│ 轮次 2 …                                                 │
└──────────────────────────────────────────────────────────┘
```

**数据映射**（debug turn → 记录，核心设计）：

| debug 字段 | 折叠后记录 | 说明 |
|---|---|---|
| `request.messages[0]`(system) + `tools` | SYSTEM 记录 | fp 变化时标"系统提示变更"，tools 只随 fp 展示一次 |
| `response.text` | assistant 记录.text | 空则显示"（无文本，仅工具调用）" |
| `response.reasoning` | assistant 记录.thinkingDetail | 默认折叠，可展开 |
| `response.toolCalls[]` | tool 记录 ×N | 每项显示 `function.name` + `arguments` JSON；`id` 保留用于关联 |
| `response.usage` | assistant 记录 usage | input/output/cacheHit/cacheMiss；cacheHit 显示命中率 |
| `response.toolCalls[i]` 的结果 | 下一 turn `messages` 中 role=tool 且 id 匹配的 content | 展示"结果"；无下一 turn 或匹配失败则显示"（未记录结果）" |
| `error` | assistant 记录 isError | 红色标识 + error 文本 |
| `timestamp` | 记录 startedAt | 相邻 turn 差 = 轮次间隔，供 duration 模式 |
| `fp` | 会话段标识 | 切换 merged 文件 = 切换 agent 配置段 |

**样式**：新增 `debug-*` CSS（或复用 `tjs-*` 基调 + 差异色），SYSTEM 用金色边框、TOOL 用琥珀色。

**验证**：用 `devdata/debug/msy3mj5n6xb5j0`（含 2 个 toolCalls 的真实数据）做验收样例，逐项核对。

### 4.5 M3 — 交互增强（可选）

- 时间线拖选 → 表格高亮联动（M0 已做基础版，此处加缩放/平移）。
- 表格虚拟化（行数 >200 时窗口渲染）。
- debug 与 runs 数据并排对照（同一 run 的 runs 轨迹 + debug 原始请求）。
- 导出：整段 debug 会话导出为 Markdown/JSON。

---

## 5. 里程碑与工作量

| 里程碑 | 内容 | 工作量 | 依赖 | 验收 |
|---|---|---|---|---|
| M0 | runs 数据增强：时间线+分组+编号+高亮 | ~1 天 | 无 | 轨迹页可见时间线/折叠/编号 |
| M1 | debug 后端 API | ~0.5 天 | 无 | curl 三接口通过 |
| M2 | debug 前端视图（完整输入输出） | ~1.5-2 天 | M1 | msy3mj5n6xb5j0 全量核对 |
| M3 | 虚拟化 + 联动 + 导出 | ~1 天 | M0,M2 | 大会话流畅 |

建议执行顺序：**M0 → M1 → M2**（M0 先交付可见价值；M1 很小，为 M2 铺路）。

---

## 6. 风险与注意事项

1. **体积**：每 turn `request.messages` 是完整历史（样例已到 11k tokens/turn）。列表接口必须只给元数据，
   单 turn 按需拉取，system prompt / tools 默认折叠。必要时加 `truncated` 摘要。
2. **数据冗余**：tools 每 turn 全量重复。按 fp 去重展示，避免渲染 19 个工具 × 10 轮。
3. **时间精度**：debug 无 TTFT/解码/工具耗时，时间线只能到 turn 粒度。若需要细分，
   后续在 `llm-logger.ts` 的调用处补 `timing` 字段（llm 调用点有 `performance` 可测）。
4. **并发写**：`logLLMCall` 同步读改写 merged 文件。单进程内串行调用，目前安全；
   但 M1 接口并发读同一文件无风险（只读）。若未来多进程，需加锁。
5. **隐私**：debug 含完整 system prompt（可能含敏感配置），视图默认折叠 + 需要显式展开。
6. **实时性**：M1 直接读文件系统，新 turn 写入后立即可见；无缓存一致性问题（每请求读盘，
   merged 文件小，可接受）。
7. **不做的事**：不把 deepseek-harness 代码直接拷入 tianshu（其依赖 runtime 包的快照模型，
   tianshu 数据源不同）；按"纯函数折叠层 + 轻量组件"重写，保持 tianshu 现有 tjs-* 风格。

---

## 7. 附录：关键参考文件索引

**deepseek-harness**
- `packages/client/ui-trajectory/src/client/TrajectoryView.tsx` — 编排层
- `packages/client/ui-trajectory/src/client/layout.ts` — 折叠层（1126 行，核心）
- `packages/client/ui-trajectory/src/client/timeline.ts` — 时间线投影（200 行，可直接参考移植）
- `packages/client/ui-trajectory/src/client/trajectory-record.ts` — 数据契约（131 行）
- `packages/client/ui-trajectory/src/client/TrajectoryTable.tsx` — 表格/虚拟化/检查器
- `packages/client/ui-trajectory/README.zh.md` — 能力清单（18 行，浓缩）

**tianshu**
- `web/client/src/features/trajectory/TrajectoryView.tsx` — 现有视图
- `web/client/src/features/trajectory/trajectory.ts` — 现有折叠/汇总/过滤
- `web/client/src/features/trajectory/trajectory.test.ts` — 现有测试
- `web/server/src/routes/runs.ts:75` — trajectory 接口
- `web/server/src/debug/llm-logger.ts` — debug 写入（merged_N.json 格式）
- `web/server/src/debug/merge-turns.ts` — 旧 turn 合并/清理
- `web/server/src/tools/debug_sessions/index.ts` — 现状（纯文本消费）
- `web/client/src/index.css:1297-1334` — tjs-* 样式
- 样例数据：`devdata/debug/msy3mj5n6xb5j0/merged_1.json`（含 toolCalls）、`devdata/debug/msxzmay9knw366/merged_1.json`
