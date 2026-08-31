# 子代理"唤起"机制：天枢对标 Penguin 的落地改造（v2 · 代码核实修订版）

> 主题：子代理（delegate / send_message / 后台运行）的**后端唤醒链路**与**前端呈现方式**
> 参照：PenguinHarness `Prism-Shadow/penguin-harness`（`packages/core/src/environment/tools/run-subagent.ts`、`subagent/`、`packages/web/src/features/chat/subagents-view.tsx`）
> 文件：天枢 `web/server/src/agent/{sub-agent.ts,inner.ts,loop/control-router.ts,loop/loop-engine.ts}` 与 `web/client/src/...`
> 原文日期：2026-08-29
> 修订：基于当前工作区代码逐条核实后修订（原文后端章节描述的是一次旧重构前的代码，已被内部 P 系列改造覆盖，见正文「已核实」标注）

---

## 0. 一句话结论（v2 修订）

天枢当前**已不存在原文所说的"唤醒重跑"**——`wakeParentSession` 已被删除（代码注释 `control-router.ts:128`：「wakeParentSession 已删除，P1-2」），两条子代理路径（`delegate_to_agent` 批量、`send_message_to_subagent` 续跑）现在都走**同一父 Run 内的同步 barrier + `return {kind:'continue'}`**（`loop-engine.ts:388-418`），父 Run **不重启**，只是会**同步挂起等子代理跑完**。

真正的差距只剩两块：
1. **后端**：批量 `delegate` 仍用 `Promise.all` 同步 barrier 阻塞父（被最慢子代理拖死），需要"去阻塞 + 后台化"——而代码里已有可复用的 resume 范式（`ask_user` 的 `break`+`checkpoint`+`createResumedRun`）。
2. **前端**：子代理仍是"主聊工具卡片 + 跳转子会话 toast"，**没有** chip + 调用图 + 独立流式面板 + 独立输入框（报告前端章节描述准确，且这部分能力确实未建）。

**好消息未变**：子代理是真子 Session、事件已按 `run_id` 多路复用下发给前端（传输层具备"每子代理实时流"），缺的只是后端去阻塞与前端面板渲染。

---

## 1. 现状：天枢的子代理链路（已逐条核实）

### 1.1 后端（已核实当前代码）

**a) 批量 delegate（`control-router.ts:24 handleSubAgentBatchRequest`）——"同步 barrier + 阻塞父"【仍是痛点】**
- `control-router.ts:60-65` 先逐个 emit `tool.started`（前端出 N 张"执行中"卡片）。
- `control-router.ts:67-79` `await Promise.all(batch.map(spawnAndRunSubAgents))` **并行拉起所有子会话，等全部结束**（成功/失败都收集，见 `sub-agent.ts:358-398` 的 `SpawnOutcome` 不 throw 设计）。
- 全部完成后 `:81-114` 把每个子结果作为 tool 消息落库 +  emit `tool.completed` / `sub_agent.completed`，最后 `return {kind:'continue'}`。
- 上层 `loop-engine.ts:388-402`：`await handleSubAgentBatchRequest(...)` → `messages.push(...outcome.messages)` → `continue`，即**父主循环在同一 Run 内继续下一轮**。
- 痛点（与原文一致，且仍成立）：① 同步阻塞 → 父被最慢子代理拖死；② 父只拿到最终一次性 text，子中间过程不回流主聊；③ 失败项也需等它跑完才解除阻塞。

**b) 续跑 send_message（`control-router.ts:130 handleSubAgentMessageRequest`）——"同步 barrier（已无唤醒重跑）"【原文痛点已修复】**
- `control-router.ts:170` `const subResult = await continueSubAgentWithMessage(...)` **同步等待子会话续跑完成**，随后 `:180-205` 回注工具结果 + `sub_agent.completed`，`return {kind:'continue'}`。
- `control-router.ts:128` 注释明确：`不再 fire-and-forget + wake 新 Run（wakeParentSession 已删除，P1-2）`。
- 核实结论：**原文 P0-B（去掉 send_message 唤醒重跑）已经在代码中完成**，实现方式是"同 Run 内同步 barrier"（比原文建议的 harness 消息方案更简单、且保证结果准确回注）。父 Run 不再从头重跑。
- 注意：当前仍是**同步等**（不是后台）。原文认为的"fire-and-forget + 唤醒重跑"两种旧行为都已不存在。

**c) 深度/并发/工具过滤（已核实，与原文一致）**
- `MAX_DEPTH=1`（`sub-agent.ts:21`）、`MAX_INSTANCES=5`（`sub-agent.ts:22`）。
- 子会话工具过滤：`delegate_to_agent` 在 `sub-agent.ts:287` 被滤掉；`send_message_to_subagent` 在 `sub-agent.ts:433` 被滤掉 → 孙代理结构上不可能再委托/续跑（层级硬控终点）。与 Penguin `MAX_SUBAGENT_DEPTH=1` 方向一致。

**d) 父主循环机制（`loop-engine.ts`）——决定"去阻塞"改法的关键（原文未展开）**
- 父 Run 是一个 `while` 循环：处理 `result.type`。子代理两类请求都是 `await handle... → messages.push(outcome.messages) → continue`（同一 Run 内同步继续）。
- 但循环**已支持**另一范式：`ask_user` 路径（`:453-466`）`await handleAskUser(...)` 后直接 `break` 结束本 Run，注释写明"答案通过 `POST /runs/:id/inputs` 启动一个全新的 resumed Run"。即：**挂起父 Run + 落 checkpoint + 后续输入触发 `createResumedRun` 续跑** 是现成模式。
- 服务端 `createResumedRun` 存在（`outer.ts:316`，来自 `runtime/run-resume-service.ts`），用于冷恢复与自动续跑；`checkpointStore`（`control-router.ts:9` 已 import）用于落锚。
- **推论（重分析核心）**：要把批量 delegate 改造成"非阻塞后台"，应**镜像 `ask_user` 的 resume 范式**，而不是从零造唤醒机制——fire 子代理、父 Run `break`、子完成时 `createResumedRun` 注入一条 `[background_task_done]` harness 消息作为续跑输入。这样"父 Run 不从头重跑（基于 checkpoint 续跑）"与"非阻塞后台"可同时成立。

**e) 子代理运行/事件（已核实，前端可行性基础）**
- `runSubAgentLoop`（`sub-agent.ts:131-200`）经 `enqueueRun` 把子 run 进 run-coordinator；`sub-agent.ts:151/184/191` emit `run.started`/`run.completed`/`run.failed`；`sub-agent.ts:275/466` emit `sub_agent.started`。
- 子 run 事件通过父会话的 rawStream 多路复用：`publishRunEvent(rawStream, childRun.id, ...)` + `createDurableStream(rawStream, childRun.id)`（`sub-agent.ts:307-314, 478-485`）。父会话 transport 订阅者会收到带 `run_id`（子 run）的事件。
- `agent_tasks` 表有 `status`（`queued/running/completed/failed/cancelled`）与 `mode`（`foreground`/`continue`），**尚无 `background` 模式** → 后台化语义（P1-A）尚未建。

### 1.2 前端（已核实，与原文一致且准确）

- 子代理呈现为主聊天流里的**工具卡片**：`web/client/src/components/Chat/ToolCall.tsx:64` 识别 `delegate_to_agent`/`send_message_to_subagent`，`tool-card-subtask`（`:80`）显示任务摘要与状态。
- `web/client/src/stores/chatStore.ts:654` 收 `sub_agent.started` 创建独立子会话（`id: sub_session_id`、`title: Sub: ...`、`parent_id: data.session_id`），`:675` 置 `subAgentNotice` 触发可点击 toast。
- `web/client/src/components/Chat/ChatArea.tsx:84` `subagent-toast` 3s 可点击跳转子会话。
- 事件总线按 `session_id`+`run_id` 接收（`chatStore.ts:548 bus.on(type, ...)`、`api/eventBus.ts:213` 含 `sub_agent.started`）。**子 run 的 `run.started`/`run.completed`/`message.delta` 已下发到客户端，只是当前只用于全局 presence/trajectory，未渲染到子代理专属面板** → P0-D 在传输层可行。
- **不存在**独立的子代理侧栏面板 / 调用图 / 子代理输入框组件（glob 确认 `client/src` 下无 `*[Ss]ubagent*` 文件）。

---

## 2. Penguin 的做法（外部参照，原文保留）

- **子代理是真子 Session**：`run_subagent`（入参 `prompt`；可选 `agent_id`/`model_id`+`provider`/`thinking_level`/`run_in_background`/`yield_time_ms`/`description`）经 `SubagentRunner.spawn` 创建可恢复子 Session（`subagentDepth+1`、`source:"subagent"`）。
- **结果回流两条路，父 Run 永不重启**：前台（`yield_time_ms` 默认 300s 窗口）把子 delta 拷为 tool output，结束作为 tool result 进父同一 Run 下一轮；后台（`run_in_background` 或超时）spawn 立即返回 `subagent_id`，子 settle 时 `Session.handleBackgroundDone` 仅 `pendingNotices.push(event)`，下次输入装配编译成 `[background_task_done]` harness 用户消息（运行中 steering、空闲新 Task 输入）。
- 父在子运行期间可继续指示：模型通道 `input_subagent`、面板通道 `sendToBackgroundSubagent`，汇合到 `ManagedSubagentSession.steer/startRun/abortRun`。
- 审批不丢：origin-tagged + 常驻 approval sink，后台也升级到人类。
- 硬约束：`MAX_SUBAGENT_DEPTH=1`、`MAX_SESSIONS=8`（运行中不驱逐）、默认窗口 300s、poll 10s。
- 前端：主聊快捷 chip（`subagent-chip.tsx`）+ 侧栏 `subagents-view.tsx`（顶部 `AgentTopologyView` 调用图、选中子代理用 `MessageStream`、底部 `SubagentComposer` 输入框）+ 完成横幅 `background-done-banner.tsx` + `stream-model.ts routeNested` 嵌套流。

---

## 3. 天枢落地改造清单（v2 修订）

> 目标（不变）：从"同步阻塞 + 仅卡片" → "可后台并行 + 可实时呈现/干预"。
> 修订点：① P0-B 标记为**已完成**；② P0-A 改法明确为**镜像 `ask_user` 的 resume 范式**；③ 新增"后端张力"说明；④ 行号全部按当前代码校正。

### 后端

**P0-B 去掉 send_message 的"唤醒重跑" —— ✅ 已完成（代码中 `wakeParentSession` 已删除，改为同 Run 同步 barrier）**
- 无需再做。仅提示：当前实现是"同步等"而非"后台"，若后续要并行续跑多个子会话，可纳入 P1-A 的后台化一并处理。

**P0-A 批量 delegate 去同步阻塞（`control-router.ts:67` + `loop-engine.ts:388`）—— 真正的后端剩余工作**
- 改法（v2 明确）：**镜像 `ask_user` resume 范式**——
  1. `handleSubAgentBatchRequest` 改为逐子代理 fire-and-forget（`spawnAndRunSubAgents` 去掉外层 `await Promise.all`，改为各自 `enqueueRun` / 各自落 `tool_status:'running'` 卡片后 `return`）；
  2. 父 Run 在 `loop-engine.ts:388` 处不再 `await` 全部完成，而是 `break`（结束本 Run），并用 `checkpointStore` 落锚（参考 `ask_user`）；
  3. 每个子代理完成时**单点回注**（覆盖 `:81-114` 的批量回注为增量回注）；全部（或部分 + 超时）完成后，仿 `POST /runs/:id/inputs` 调 `createResumedRun`（`outer.ts:316`），注入一条 `[background_task_done]` harness 用户消息作为续跑输入，父 Run 基于 checkpoint 续跑——而非从头重跑。
- 复用现有基建（`checkpointStore`、`createResumedRun`、run-coordinator），**不是从零造唤醒机制**。
- 若保留 barrier 兜底，至少加"部分完成即回注 + 超时降级后台"，避免被最慢项拖死。

**P1-A 补充后台化语义（对齐 `run_in_background`）**
- 给 `delegate_to_agent`/`send_message_to_subagent` 增 `run_in_background`（或超时自动降级）；spawn 立即返回 `sub_session_id` + note；父模型下一轮可再 spawn，实现多子代理并行（`MAX_INSTANCES=5` 已够）。
- 需在 `agent_tasks` 增 `background` mode（当前仅 `foreground`/`continue`），并由 `sub_agent.completed`（已存在）驱动"通知父会话下一个输入边界"——与 P0-A 的 resume 注入共用同一通道。

**P1-B 子代理审批不丢**
- 确认子代理的读写工具审批是否走独立 approval sink；参考 penguin origin-tagged + 常驻 sink，避免后台子代理因无人 poll 卡在审批队列（现有 `approval.requested` 事件已下发，需核对后台子 run 的审批提升路径）。

**P1-C 子代理结果回注格式优化**
- 复用 `summarizeAndMerge`（`sub-agent.ts:75`）保留"结论/关键文件"结构；`sub_session_id` 已在回注内容最前（`control-router.ts:87,183`），父模型可凭它直接 `send_message_to_subagent` 追问（保持）。

### 前端

**P0-C 主页升级为"快捷 chip + 并行面板"**
- 主聊天流：把子代理工具卡片升级为快捷 chip（头像 + agent 名 + 短 id + 运行中 spinner + 待审批琥珀点），点击打开子代理面板并聚焦（对应 `subagent-chip.tsx`）。保留 `ToolCall.tsx:64/80` 的任务摘要 + 状态。

**P0-D 新增子代理侧栏面板（对齐 `subagents-view.tsx`）—— 传输层已具备**
- 顶部调用图 `AgentTopologyView`（每子代理一节点、按深度分列、`description` 第二行、实时计时），纯函数布局。
- 选中子代理用主聊同款消息流组件渲染：按 `run_id`（子 run）过滤事件总线已下发的 `run.started`/`run.completed`/`message.delta`/`tool.*`，各自流式 delta + 嵌套卡片。**无需改后端传输，只在前端路由子 run 事件到面板**。
- 底部子代理独立输入框（`ChatInput` 变体）：发送即 `send_message_to_subagent`，停止即 abort；预留"打开为会话"入口。

**P1-D 后台完成横幅**
- 新组件渲染 `[background_task_done]`（运行中父 Task 内显示），对应 `background-done-banner.tsx`。需后端 P0-A/P1-A 先产出该 harness 消息。

**P1-E 子会话消息流接入**
- 现有 `chatStore.ts:654` 已创建子会话 + toast；补齐：按子 `run_id` 把子代理消息路由到子会话自己的流（互不污染父流），各子会话独立统计。

---

## 4. 对照速览（v2 修订）

| 维度 | 天枢（现状·已核实） | Penguin | 天枢改造 |
|---|---|---|---|
| 父 Run 生命周期 | send_message **已不重启**（同 Run 同步 barrier）；delegate 同步等 | 从不重启，同 Run 或下一输入边界消费 | send_message 已达标；delegate 改 resume 续跑（P0-A） |
| 是否阻塞父 | delegate `Promise.all` 同步阻塞；send_message 同步等 | 前台窗口化、后台立即返回 | 改 fire-and-forget + `break` + `createResumedRun`（P0-A） |
| 多子代理并行 | `Promise.all` 并行但等全部 | 后台并行（上限 8） | 补 `run_in_background`（P1-A） |
| 运行中可干预 | send_message（续跑，同步） | input_subagent + 面板通道 | 补齐 abort/steer/resume（P0-D/P1-A） |
| 审批 | 需核对 | origin+常驻 sink | 补审批透传（P1-B） |
| 前端呈现 | 工具卡片 + 子会话 + toast（无面板） | chip + 调用图 + 独立流式面板 + 独立输入框 | 补 SubagentsView/AgentTopologyView（P0-C/D） |
| 后台完成通知 | 无横幅 | `[background_task_done]` 横幅 | 补完成横幅（P1-D，依赖 P0-A/P1-A） |
| resume 基建 | `ask_user` 已有 `break`+`checkpoint`+`createResumedRun` | 原生 | **P0-A 直接复用，免造** |

---

## 5. 权衡与边界（v2 修订）

- **原文最大的失真点**：后端"两处痛点"已收窄为"一处"。`wakeParentSession` 删除 + 两条路径改为同步 barrier，意味着"唤醒重跑"痛点**已不存在**；原文 P0-B 应标记完成。报告若照旧执行会做一件已经做过的事。
- **后端张力（原文未点破）**："父 Run 不重启"与"后台非阻塞"并非天然兼容。当前同步 barrier 是用"阻塞"换取"同 Run 准确回注"。要非阻塞，父 Run 必须结束并续跑——这正是 `ask_user` 已有的 `break`+`checkpoint`+`createResumedRun` 范式。**P0-A 的本质 = 把 delegate 从"同步 continue"改成"异步 break + resume 注入 harness 消息"**，复用 `ask_user` 基建，而非从零造唤醒。这样"不从头重跑（基于 checkpoint 续跑）"与"非阻塞"可同时成立。原文 P0-B（删唤醒）与 P0-A（后台化）原本看似独立，实则共享同一 resume 机制——删唤醒后若要做后台化，需把"轻量 resume（harness 消息，非全量重跑）"以 `ask_user` 同款形式请回来。
- **不要丢掉"子代理是真会话 + 事件已多路复用"的资产**：前端 P0-D 的实时流在传输层已具备（`run_id` 分流），主要工作量在前端渲染与事件路由，后端改动小。
- **前端工作量排序建议（与原文一致）**：先做 P0-A（去阻塞，收益最直接）与 P0-C/D（chip+面板，可视化收益最直观），再补 P1-A 后台化 / P1-B 审批 / P1-D 横幅 / P1-E 嵌套流。
- **一致性**：`MAX_INSTANCES=5` 与子会话工具过滤（无 `delegate`/`send_message`）两层硬控已与 penguin 对齐，保留。
- **行号基准**：本文所有行号基于修订时的当前代码；原文行号（如 `control-router.ts:108/151/214/47`）整体偏后约 80–100 行，因文件已从 `agent/outer.ts` 迁出重构并叠加 P4/P5 改造，以本文为准。
