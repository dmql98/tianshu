# 子代理"唤起"机制：天枢对标 Penguin 的落地改造

> 主题：子代理（delegate / send_message / 后台运行）的**后端唤醒链路**与**前端呈现方式**
> 参照：PenguinHarness `Prism-Shadow/penguin-harness`（`packages/core/src/environment/tools/run-subagent.ts`、`subagent/`、`packages/web/src/features/chat/subagents-view.tsx`）
> 文件：天枢 `web/server/src/agent/{sub-agent.ts,inner.ts,loop/control-router.ts}` 与 `web/client/src/...`
> 日期：2026-08-29

---

## 0. 一句话结论

天枢的"唤起"本质是**"子代理结束 → 新建一个 Resume Run 把父会话从头再跑一遍"**（`send_message_to_subagent` 路径），以及批量委托时的**同步 barrier 阻塞父**（`delegate_to_agent` 路径）。Penguin 的做法是**"父 Run 全程不重启"**：前台委托把子代理结果作为 **tool 结果注入父的同一 Run 的下一轮**；后台委托立即返回 `subagent_id`、父继续跑，子完成时用一条 **`[background_task_done]` 用户消息**通知父会话的下一个输入边界。**前端**则是主聊天流只留一条快捷 chip，真正的**并行实时过程**放在独立的**子代理侧栏面板**（调用图 + 每个子代理各自的流式消息流 + 独立输入框）。

**好消息**：天枢的批量 `delegate` 已经是"结果回注父同一 Run"的雏形（`{kind:'continue'}`），差的只是"去掉同步阻塞 + 后台化 + 前端并行呈现"。真正要动手改的是 `send_message_to_subagent` 的唤醒路径和整个前端子代理视图。

---

## 1. 现状：天枢的子代理链路（两处痛点）

### 1.1 后端

**a) 批量 delegate（`control-router.ts:108 handleSubAgentBatchRequest`）——"同步 barrier + 阻塞父"**
- `control-router.ts:151-163` 用 `Promise.all(batch.map(spawnAndRunSubAgents))` **同时拉起所有子会话，等全部结束**（含失败项）。
- 期间父模型**挂起等待**，`runSubAgentLoop` 里子会话最多 `maxSteps||50` 轮（`sub-agent.ts:157`）。
- 全部完成后，`control-router.ts:165-200` 把每个子结果作为 tool 消息落库 + `emit tool.completed`，最后 `return {kind:'continue'}` —— **父 Run 在同一 Run 里继续**（这点是对的方向）。
- 痛点：① 同步阻塞 → 父被最慢的子代理拖死，无法响应"部分完成"；② 子代理的中间过程不流回父/前端，父只拿到最终一次性 text；③ 失败项也得等它跑完才解除阻塞。

**b) 续跑 send_message（`control-router.ts:214 handleSubAgentMessageRequest`）——"fire-and-forget + 唤醒重跑"**
- `control-router.ts:262` `void continueSubAgentWithMessage(...)` **立即返回"已派发"**，不阻塞父。
- 子代理跑完后在 `.then()` 回注结果（`control-router.ts:271-293`），随后 `control-router.ts:295` 与 `313` 调 **`wakeParentSession`**。
- `control-router.ts:47 wakeParentSession`：`createResumedRun({ previousRunId, trigger:'sub_agent_callback' })` + `sessionLoop(...)` + 注入 `systemAlerts:[wakeAlert]`（`control-router.ts:77-80`，内容是"请合并整理输出给用户"）。
- 痛点：**这是真正的"唤醒重跑"**——父会话虽能从 DB/checkpoint 重建上下文，但**父 Run 的整个循环从头再跑一遍**（`outer.ts` 全链路），只为产出一段"整理总结"。多一轮完整上下文请求 + 重新推理，且父 Run 中途产出的结构/状态需重新推算。

**c) 深度/并发**：`MAX_DEPTH=1`（`sub-agent.ts:21`）、`MAX_INSTANCES=5`（`sub-agent.ts:22`）。子会话工具过滤掉 `delegate_to_agent`（`sub-agent.ts:286-288`、`432-434`），与 Penguin 的 `MAX_SUBAGENT_DEPTH=1` / `MAX_SESSIONS=8` 相近，方向 OK。

### 1.2 前端

- 子代理呈现为主聊天流里的一张**工具卡片**：`web/client/src/components/Chat/ToolCall.tsx:64` 识别 `delegate_to_agent`/`send_message_to_subagent`，`tool-card-subtask` 显示任务摘要（`搜科技 / 搜财经…`）、状态（执行中/成功/失败）。
- `web/client/src/stores/chatStore.ts:653-679` 收到 `sub_agent.started` 时**创建一个独立子会话**（`id: sub_session_id`、`title: Sub: ...`、`parent_id`），并弹一个 3s 可点击 **toast**（`ChatArea.tsx:82-99`）跳转子会话。
- 痛点：① 子代理**完整过程**只在一个"跳转子会话"里看到，主聊天没有并行的**实时多子代理进度**；② 没有"调用图/拓扑"视图，多个并行子代理各自状态不可一眼审视；③ 子代理没有**独立的可交互输入面板**（steer/续跑/恢复/中止）；④ 后台化（`run_in_background` 语义）缺对应完成横幅与"可随时 steer"的通道。

---

## 2. Penguin 的做法（对照）

### 2.1 后端
- **子代理是真子 Session**：`run_subagent`（必需入参 `prompt`；可选 `agent_id`/`model_id`+`provider`/`thinking_level`/`run_in_background`/`yield_time_ms`/`description`）通过 `SubagentRunner.spawn`（`interfaces/environment.ts:163`）创建可恢复的子 Session，带 `subagentDepth+1`、`source:"subagent"`、`session_created` 注册。
- **结果回流两条路，父 Run 永不重启**：
  - **前台（默认，`yield_time_ms` 默认 300s 窗口内）**：`collectWindow` 把子代理文本 delta 拷贝为该 tool 的 output delta 喂给父，子代理结束 → 终结状态作为 **tool result 进入父的同一 Run 的下一轮**（`stopReason:'completed'/'failed'`）。
  - **后台（`run_in_background` 或超时）**：spawn 立即返回 `subagent_id` + note，父模型下一轮可继续 spawn 别的子代理（**并行，上限 8**）；子代理 settle 时，`armSubagentDoneReport` → `Session.handleBackgroundDone`（`session.ts:869` 只 `pendingNotices.push(event)`）→ 下次输入装配时把事件编译成 **`[background_task_done]` 的 harness 用户消息**（`session.ts:195`），运行中作为 steering 注入当前 Task、空闲时成为新 Task 输入。仍**同一父 Session**。
- **父在子运行期间可继续指示**：模型通道 `input_subagent`（轮询 / 空闲续跑 / 正在跑走 steering 队列 / `abort`），宿主面板通道 `sendToBackgroundSubagent`，二者汇合到 `ManagedSubagentSession.steer/startRun/abortRun`。
- **审批不丢**：子代理审批走独立 origin-tagged approval sink + 常驻 approval sink（后台也升级到人类，不会因没人 poll 卡死在审批队列）。
- **硬约束（可作天枢缺省参考）**：`MAX_SUBAGENT_DEPTH=1`、`MAX_SESSIONS=8`（运行中不驱逐）、默认窗口 300s、poll 窗口 10s、缓冲上限。

### 2.2 前端
- **主聊天流只留子代理快捷 chip**：`packages/web/src/features/chat/subagent-chip.tsx`（`tool-call-card.tsx:401` 在 `run_subagent` 工具卡片下渲染）：头像 + agent 名 + 短 id + 运行中 spinner + **子树有待审批的琥珀点**；点击 `onOpenSubagent` 打开侧栏面板并聚焦。
- **侧栏面板 `subagents-view.tsx`**：
  - 顶部 `AgentTopologyView`（`agent-topology-view.tsx`，几何来自纯函数 `agent-topology.ts layoutTopology`）：**调用图**，每 spawn 一层一个节点（深度=列，SVG 折线边，节点为真实 button），节点第 2 行显示 `description`，运行中用 `LiveDuration` 显示**实时计时** —— "多个子代理并行"的直接体现。
  - 选中子代理下方用**与主聊天相同的 `MessageStream`** 渲染（`ctx.origin` 定位到该子代理的 origin 链）—— 流式 delta、嵌套 tool card、更深 chip、待审批全都可用。
  - 底部 `SubagentComposer`：`ChatInput` 子代理变体（体/技能/思考档/子代理 context ring/锁定模型/父审批模式），发送即 steer/续跑/恢复，停止即 `abortSubagent`。
  - "打开为会话"按钮把子代理提升为完整 `/chat/:id` 会话。
- **嵌套模型路由**：`stream-model.ts routeNested` 对 `origin.length>0` 的消息剥掉第一个 hop 递归喂给 `model.subagents` 对应嵌套 `StreamModel` —— 每个子代理**独立流、独立统计、互不污染父流**。
- **完成横幅**：`background-done-banner.tsx` 渲染 `[background_task_done]`（`kind:'background_notice'`），运行中 Task 内显示。

---

## 3. 天枢落地改造清单

> 目标：从"唤醒重跑 + 同步阻塞 + 仅卡片" → "父 Run 不重启 + 可后台并行 + 可实时呈现/干预"。

### 后端

**P0-A 批量 delegate 去同步阻塞（`control-router.ts:151-163`）**
- 改为**逐子代理 fire-and-forget**：每个 `delegate_to_agent` 立即落 `tool_status:'running'` 卡片 + `return {kind:'continue'}` 让父继续；子代理完成时**单点回注**（覆盖 `control-router.ts:165-200` 逻辑），并给父会话入队一条 **`[background_task_done]` harness 用户消息**（替代同步等待）。
- 若保留 barrier 语义，也**至少**加"部分完成即回注 + 超时降级为后台"，避免被最慢项拖死。

**P0-B 去掉 send_message 的"唤醒重跑"（`control-router.ts:295,313 → 47 wakeParentSession`）**
- 把 `wakeParentSession` 的 `createResumedRun + sessionLoop`（`control-router.ts:61-101`）改为**只注入一条 harness 用户消息**到父会话（参考 penguin `handleBackgroundDone` 只 `pendingNotices.push`）：父会话**仍在原 Run**（若还在跑）或**下一条用户消息**自然消费（空闲态用 `takeBackgroundNotices` 提交为新 Task 输入），不再新建 Run 重跑。
- 这样"子结果整理成最终答复"由父模型在**下一次自然的输入边界**做，而非强制重启。

**P1-A 补充后台化语义（对齐 `run_in_background`）**
- 给 `delegate_to_agent`/`send_message_to_subagent` 增加 `run_in_background`（或自动降级），spawn 立即返回 `sub_session_id` + note；父模型下一轮可再 spawn，实现**多子代理并行**（`MAX_INSTANCES=5` 已够）。
- 子代理 settle 时通过 `sub_agent.completed`（已存在）驱动"通知父会话下一个输入边界"。

**P1-B 子代理审批不丢**
- 确认子代理的读写工具审批是否走独立 approval sink；参考 penguin 的 origin-tagged + 常驻 approval sink，避免后台子代理因无人 poll 卡死在审批队列。

**P1-C 子代理结果回注格式优化**
- 复用 `summarizeAndMerge`（`sub-agent.ts:75`）但把"结论/关键文件"结构保留，并让父模型可**凭 sub_session_id 直接 `send_message_to_subagent` 继续追问**（`control-router.ts:275` 已带 id，保持）。

### 前端

**P0-C 主页升级为"快捷 chip + 并行面板"**
- 主聊天流：把子代理**工具卡片**升级为**快捷 chip**（头像 + agent 名 + 短 id + 运行中 spinner + 待审批琥珀点），点击打开子代理面板并聚焦（对应 `subagent-chip.tsx`）。保留现有"任务摘要 + 状态"（`ToolCall.tsx:64-81`），但让卡片不被折叠影响、可跳转。

**P0-D 新增子代理侧栏面板（对齐 `subagents-view.tsx`）**
- 顶部**调用图**：新增 `AgentTopologyView` 等价物（每子代理一个节点、按深度分列、`description` 第二行、**实时计时**），几何用纯函数布局（`agent-topology.ts layoutTopology`），节点为可聚焦 button。
- 选中子代理用**与主聊天相同的消息流组件**渲染（按子会话 id 过滤 `ctx.origin`/子会话事件），各自流式 delta + 嵌套 tool card。
- 底部**子代理独立输入框**（`ChatInput` 变体）：发送即 `send_message_to_subagent`（steer/续跑/恢复），停止即 abort；预留"打开为会话"入口（提升为 `/chat/:id`）。

**P1-D 后台完成横幅**
- 新组件渲染 `[background_task_done]`（在运行中的父 Task 显示完成通知），对应 `background-done-banner.tsx`。

**P1-E 子会话消息流接入**
- 现有 `chatStore.ts:653-679` 已创建子会话 + toast；补齐：`routeNested` 式**嵌套模型**（按 origin 把子代理消息路由到子会话自己的流，互不污染父流），以及各子会话**独立统计**。

---

## 4. 对照速览

| 维度 | 天枢（现状） | Penguin | 天枢改造 |
|---|---|---|---|
| 父 Run 生命周期 | send_message 路径**重启**；delegate 同步等 | **从不重启**，同一 Run 或下一输入边界消费 | 去掉 wake 重启，改 harness 消息通知 |
| 是否阻塞父 | delegate 同步 barrier 阻塞 | 前台窗口化、后台立即返回 | 改 fire-and-forget / 降级后台 |
| 多子代理并行 | 有（Promise.all）但等全部 | 后台并行（上限 8） | 补 `run_in_background` |
| 运行中可干预 | send_message（续跑） | input_subagent + 面板通道 | 补齐 abort/steer/resume |
| 审批 | 需核对 | origin+常驻 sink，不丢 | 补审批透传 |
| **前端呈现** | 工具卡片 + 子会话 + toast | **chip + 调用图 + 独立流式面板 + 独立输入框** | 补 `SubagentsView`/`AgentTopologyView` |
| 后台完成通知 | 无横幅 | `[background_task_done]` 横幅 | 补完成横幅 |

---

## 5. 权衡与边界

- **不要丢掉"子代理是真会话"这个已有资产**：天枢 `sessionStore.create` + 前端子会话创建已接近 penguin；只是"呈现/交互"和"唤醒策略"落后。
- **父 Run 不重启的前提**：需保证父会话在子代理运行期间"仍在/可再入"（当前 `ask_user`/退出路径会 `break`，要区分"真正终止"与"等待子结果"），否则 harness 消息无处投递。这是改造最主要的技术点。
- **后台化与 UI 复杂度**：`routeNested` 嵌套模型 + 侧栏面板工作量不小；建议**先做 P0-B（去唤醒重跑）与 P0-C/D（前端 chip+面板）**，拿到最直观的"不重启 + 并行可视化"收益，再补后台化/审批/横幅。
- **一致性**：`MAX_INSTANCES=5` 与子会话工具过滤（无 delegate/send_message）两层硬控已与 penguin 对齐，保留。
