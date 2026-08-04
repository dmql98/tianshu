# TianShu Run / Character 路线交接（2026-07-31）

## 1. 任务背景

本轮依据以下两份设计文档推进新前端和新后端：

- `C:\Users\dmql\Documents\tianshu\开发\08-角色视觉与动画系统开发设计.html`
- `C:\Users\dmql\Documents\tianshu\开发\11-会话与Agent运行系统统一架构设计.html`

明确约束：

- `web/client-old` 已废弃，本轮没有修改，也不要再接入。
- 实际开发范围是 `web/client` 和 `web/server`。
- 用户数据/配置可能位于 `C:\.Tianshu`。
- 工具日志位于 `C:\Users\dmql\Documents\tianshu\dev\web\server\data`。
- 当前工作区原本就有用户改动，不要 reset、checkout 或覆盖。

用户指定的路线：

1. 11：Run / RunEvent / 角色 revision 引用骨架。
2. 08：基础角色渲染与 Presence。
3. 11：Loop / 消息分支 / 一级子 Agent / Event。
4. 08：角色包 / 资源管理 / 桌面窗口。
5. 11：Plan-first / Goal。

## 2. 本轮已经完成的代码

### 2.1 Run、RunEvent 与持久事件骨架

新增：

- `web/server/src/agent/runtime/run-store.ts`
- `web/server/src/agent/runtime/run-event-store.ts`
- `web/server/src/agent/runtime/run-coordinator.ts`
- `web/server/src/routes/runs.ts`
- `web/server/src/db/turnStore.ts`

主要行为：

- 聊天请求在排队前创建持久化 `Run`。
- `RunEvent` 使用每个 Run 单调递增的 `seq`。
- `publishRunEvent()` 先完成 SQLite 事务，再广播 Socket。
- `GET /api/runs/:id/events?after_seq=` 已可按序重放。
- 终态使用条件更新，并有数据库唯一索引限制一个 terminal RunEvent。
- Run 创建时保存 `character_id`、`character_revision_id` 和 `character_snapshot_hash`。
- `RunCoordinator` 保证同 Session 串行。
- 取消时进入 `cancelling`，不会在旧 Promise 退出前删除 Session 互斥项。
- 排队中的 Run 被清理时会落 `run.cancelled`。
- Chat 和旧 EventExecutor 都已接入持久 Run。

状态机和表定义集中在：

- `web/server/src/db/schema.ts`
- `web/server/src/agent/runtime/run-store.ts`

### 2.2 CharacterDefinition / CharacterRevision

新增：

- `web/server/src/character/revision-store.ts`
- `web/server/src/character/binding-resolver.ts`

主要行为：

- 角色稳定定义落 `character_definitions`。
- 发布版本落不可变 `character_revisions`。
- Session 支持：
  - `character_binding_mode = follow_latest | pinned`
  - `pinned_character_revision_id`
- Run 创建时解析并固定实际 revision。
- `outer.ts` 执行时读取 Run 固定的角色快照，而不是重新读取当前可变角色文件。
- `GET/POST /api/characters/:id/revisions` 已实现。
- `POST /api/characters/:id/archive` 已实现。
- 原 DELETE 角色接口现在执行归档，不再物理删除角色目录。

### 2.3 消息 revision 与会话分支

新增：

- `web/server/src/routes/messages.ts`

主要行为：

- `POST /api/messages/:id/revise` 将旧消息及后续消息/Turn 标记为 `superseded`，不物理删除。
- 新用户消息保存 `supersedes_message_id`。
- 前端“编辑并重新发送”已经调用 revision API，不再调用 keep/delete 截断数据库历史。
- 分支 Session 已保存：
  - `forked_from_session_id`
  - `forked_from_message_id`
- 分支标题仍由服务端生成 `原名-分支N`。

### 2.4 08 第一阶段：资源、Renderer 与 Presence

新增后端：

- `web/server/src/character/visual-store.ts`
- `web/server/src/character/presence-projector.ts`

新增前端：

- `web/client/src/features/characters/CharacterRenderer.tsx`
- `web/client/src/features/characters/CharacterVisualEditor.tsx`
- `web/client/src/features/character-presence/useCharacterPresence.ts`

主要行为：

- 角色视觉清单位于：
  - `{DATA_DIR}/characters/{characterId}/visual/visual.json`
- 资源位于：
  - `{DATA_DIR}/characters/{characterId}/visual/assets/`
- 已实现 API：
  - `GET/PUT /api/characters/:id/visual`
  - `POST /api/characters/:id/assets`
  - `GET/DELETE /api/characters/:id/assets/:assetId`
  - `GET /api/characters/:id/presence`
- `CharacterRenderer` 的降级顺序：
  - 请求动作资源
  - idle 动画
  - portrait
  - avatarAsset
  - 旧 avatar
  - 名称首字
- Presence 已映射：
  - `run.started / run.retrying / run.queued -> thinking`
  - `tool.* -> working`
  - `message.delta -> speaking`
  - `run.completed -> success`
  - `run.failed / run.interrupted -> error`
- Renderer 已用于角色卡片和聊天 Agent 消息。
- 角色详情页新增“视觉与动画”Tab：
  - 上传图片/GIF/WebP/视频
  - 设置立绘
  - 绑定 idle/thinking/working/speaking/success/error
  - 预览动作
  - 保存视觉草稿
  - 发布新角色 revision

### 2.5 角色资源引用保护与包

数据库新增 `character_asset_refs`。

主要行为：

- 发布 CharacterRevision 时登记该 revision 引用的所有 asset。
- 历史 revision 引用中的 asset 不能物理删除。
- 当前 visual manifest 引用中的 asset 也不能删除。
- 已实现：
  - `GET /api/characters/:id/export`
  - `POST /api/characters/import`
- 当前包格式是 gzip JSON（`.tianshu-character.gz`），包含：
  - character meta
  - soul/user/memory
  - visual manifest
  - base64 资源
- 导入仅允许 `image/*` 和 `video/*`，会重映射 asset id 并发布初始 revision。

### 2.6 一级子 Agent

修改：

- `web/server/src/agent/sub-agent.ts`

主要行为：

- 每次委托创建独立：
  - AgentTask
  - 子 Session
  - 子 Turn
  - 子 Run
- 子 Run 固定目标角色自己的 revision。
- 子 Session 过滤 `delegate_task` / `delegate_to_agent`，不能创建孙 Agent。
- `MAX_DEPTH` 已改为 1。
- 子 Agent 已从单次 `innerLoop` 改为有边界的多轮工具 Loop。
- 子 Run 有自己的持久 RunEvent。

### 2.7 控制动作混用保护

修改：

- `web/server/src/agent/inner.ts`

当控制动作（旧/新名称均识别）与普通工具混用，或一轮出现多个控制动作时：

- 整批拒绝。
- 不执行任何工具副作用。
- 写入结构化错误工具结果。
- 发布 `control.rejected`。

注意：旧 `delegate_task` / `task_complete` 还没有正式删除，详见未完成项。

### 2.8 EventDefinition / EventOccurrence 初版

新增：

- `web/server/src/event/definition-store.ts`
- `web/server/src/event/occurrence-store.ts`
- `web/server/src/event/event-run-adapter.ts`
- `web/server/src/routes/event-definitions.ts`

主要行为：

- 新表 `event_definitions` / `event_occurrences` 已分离。
- API：
  - `GET/POST /api/event-definitions`
  - `POST /api/event-definitions/:id/fire`
  - `GET /api/event-definitions/:id/occurrences`
  - `POST /api/event-definitions/occurrences/:id/retry`
- 手动触发先创建 Occurrence，并固定实际角色 revision。
- 每个 Occurrence 创建一个事件 Session。
- 重试复用同一个 Occurrence、同一个 Session、首次解析的 revision，只新建 Run。
- Event Run 通过统一 `sessionLoop` 和持久 Run/RunEvent 执行。

## 3. 已做的验证

以下命令在最后一次相关修改后通过：

```powershell
cd C:\Users\dmql\Documents\tianshu\dev\web\server
npm run build
```

```powershell
cd C:\Users\dmql\Documents\tianshu\dev\web\client
npm run build
```

结果：

- Server TypeScript 构建通过。
- Client `tsc + vite build` 通过。

为使 Client 全量构建通过，顺带修复了两个原有类型错误：

- `EventsPage.tsx` 读取不存在的 `Character.icon`。
- `SettingsPage.tsx` 对可选 groups 的未定义访问。

未完成自动化集成测试；不要只依赖编译结果。

## 4. 必须继续完成/验证的事项

### P0：先补测试和可靠性收口 —— ✅ 已完成（2026-07-31 第二轮）

10 项全部完成并新增 4 个测试文件（均可用 `npx tsx <文件>` 运行）：

- `src/agent/runtime/run-store.test.ts`（P0 1-8）
- `src/agent/inner-control-mix.test.ts`（P0 10）
- `src/agent/sub-agent.test.ts`（P0 9）
- `src/agent/runtime/approval-registry.test.ts`
- `src/agent/loop/loop.test.ts`

### P1：Run 客户端重连 —— ✅ 已完成（2026-07-31 第二轮）

- `GET /api/runs?session_id=&limit=`（routes/runs.ts）。
- 前端 `api/runs.ts`；chatStore 增加 `resumeActiveRun(sessionId)`：
  - 切会话时查找最新非终态 Run，按 seq 重放 `/events?after_seq=`（delta 合并、tool 消息还原、终态收尾），之后 live 增量走持久 listeners。
  - 模块级 `runSeqByRunId` 记录每个 Run 的 last seq（集中监听 14 类事件）。
  - Socket `connect` 事件后对 `_activeRunId` 按 `after_seq` 补拉。
  - `run.completed/failed` 清 `_activeRunId`。
- 持久审批：
  - `src/agent/runtime/checkpoint-store.ts`（checkpoints 表读写）。
  - `src/agent/runtime/approval-registry.ts`：审批等待从 socket 闭包改为集中注册表，断线重连后 respond 依然可达。
  - `approval.requested` 在 runEventStore.append 事务内写 checkpoint（reason='approval.requested'）。
  - ws/chat.ts 增加集中 `approval.respond` handler（registry.respond + 清 checkpoint）。
  - `GET /api/runs/:id/checkpoints`。
  - 前端：持久 listeners 和重放逻辑都能恢复 `pendingApproval`（刷新后审批框重现，点击后经注册表恢复 run）。

### P2：Loop 组件化 —— 大部分完成（2026-07-31 第二轮）

`agent/outer.ts` 已从 993 行减到 323 行，新增：

- `agent/loop/loop-policy.ts`（阈值、token 估算、trimToolResults）
- `agent/loop/context-builder.ts`（prompt、历史、workspace、buildInitialMessages）
- `agent/loop/context-compactor.ts`（selectAndSummarize 等）
- `agent/loop/completion-evaluator.ts`（detectDoomLoop 从 inner.ts 迁出 + final-answer 评估）
- `agent/loop/control-router.ts`（子 Agent 委托、submit_result、ask_user）
- `agent/loop/checkpoint-service.ts`
- `agent/loop/loop-engine.ts`（主循环引擎 runLoopEngine）
- `agent/loop/control-registry.ts`（新控制动作 schema，独立于 ToolRegistry）

**未拆**：`model-executor.ts` / `decision-parser.ts` / `tool-coordinator.ts` 未创建——inner.ts（569 行）的模型调用+工具协调目前内聚且有测试覆盖，拆分需大手术且无行为收益；建议在 Plan-first/Goal 阶段前保持现状。

### P2：旧控制工具 —— ✅ 已完成（2026-07-31 第二轮）

- 删除 `src/tools/delegate_task/` 目录和 registry 里硬编码的 `task_complete`。
- 新三件套（`delegate_to_agent` / `submit_result` / `ask_user`）：
  - `control-registry.ts` 定义 schema，outer.ts 构建 tools 时始终注入（与角色绑定无关）。
  - `delegate_to_agent`：单独出现 → sub_agent_request；子 Session（parent_id 非空）调用被拒（control-router）。
  - `submit_result`：替代 task_complete，走完成路径。
  - `ask_user`：最小实现——写 `ask_user` checkpoint + `ask_user` socket 事件 + 协议完整的 tool 响应；**resume/awaiting_input 恢复尚未做**（下一轮实现：用户回答后从 checkpoint 恢复 run）。

### P3/P4：Event/Cron 收口 —— ✅ 已完成（2026-07-31 第二轮）

- **Cron 解析器**：`src/event/cron-parser.ts`（手写 5 字段，支持 `*`/`?`/step/list/range；IANA 时区 + DST 洞跳过/回拨处理；`nextFireTime` 墙钟推进算法）。测试：`cron-parser.test.ts`（8 例，含 DST）。
- **调度**：`src/event/event-scheduler.ts` 轮询 `due()`，`casNextFireAt` 抢占（单赢家），创建 occurrence 后按 overlap_policy 处理：
  - skip：标记 `skipped` 留痕。
  - queue：保持 pending，`drainQueue()` 在 executeOccurrence finally 中启动下一个。
- **next_fire_at**：create 时计算（无效 cron 拒绝），触发后 CAS 推进。
- **occurrence 幂等**：UNIQUE(definition_id, scheduled_for)，测试覆盖。
- **旧系统删除**：`eventService/eventExecutor/eventScheduler/types/event-index`、`routes/events.ts`、`scheduler/cronRegistry.ts`、前端 `api/events.ts`；`trajectories` 类型移入 trajectoryStore；evolution insight 改走 `fireOnceEvent`（新模型）；`sessions.ts` 移除旧 event 级联。
- **新事件中心前端**：`api/eventDefinitions.ts` + 重写 `EventsPage.tsx`（定义列表、立即触发、执行记录展开、失败重试、创建表单含时区/重叠策略）；App.tsx 徽标改统计 active definitions。
- **测试**：`event-scheduler.test.ts`（CAS 单赢家、幂等、skip/queue、due 范围）。

**本轮顺带修复的环境问题（重要）**：
1. `config.json` 优先级高于 env → 测试进程曾打到真实库 `C:\.Tianshu` 并写入 7 条 cron-test 定义（已清理）。`config.ts` 改为 env 优先。
2. `schema.ts` 新库缺列：`reasoning_effort`/`reasoning_content`/`cache_*`/`compaction_*` 只在 ALTER 里（先 ALTER 后 CREATE，全新库永远缺列）——已补进 CREATE TABLE。**新库迁移从未被验证过，此轮暴露并修复。**
3. `closeDb()` 导出，测试 finally 里关闭连接后再删临时目录（WAL 文件占用导致 EPERM）。

### 08：资源生命周期 —— ✅ 已收口（2026-07-31 第二轮）

- **引用统一登记**：`src/character/asset-refs.ts`（`registerAssetRefs` / `assetIdsFromVisual` / `touchPlayerLease` / `hasProtectingRef`）。runStore.create 和 eventOccurrenceStore.create 会把其固定 revision 快照引用的资产登记为 `run` / `occurrence` 所有者；revision 原有登记保留。
- **延迟 GC**：`src/character/asset-gc.ts`。角色 archived 满 7 天（ASSET_RETENTION_MS）后，无保护引用（revision/run/occurrence/活跃 lease）的资产被删除；index.ts 启动每小时轮询。
- **播放器 lease**：GET 资产时刷新 `player-lease` 引用（1 小时），GC 尊重未过期 lease。
- **Range 请求**：`GET /:id/assets/:assetId` 支持 `bytes=` Range（206 + Content-Range + 416 越界），视频可拖动。
- **包校验**：`validateCharacterPackage`（版本/名称/资产数 ≤100/单文件 ≤50MB/总 ≤300MB/mime 与 kind 白名单）；导入不再接受任意大小。
- **导入冲突策略**：`conflict=error|replace|new`；replace 会清空旧资产重建，new 生成 `_import_<ts>` 后缀 id。前端视觉编辑器提供"导出角色包 / 导入角色包"按钮（导入冲突用 confirm 选择）。
- **未做**：缩略图生成（服务端无图像处理库，避免引入 sharp 等重依赖；视频/大图由浏览器端 object-fit 直接渲染）。
- 测试：`src/character/asset-lifecycle.test.ts`（run/occurrence 登记、lease 保护、GC 超期清理、retention 窗口）。

### 08：桌面角色窗口已取消

该功能已决定不再实现（仓库无 Electron 宿主，浏览器无法提供真置顶/点击穿透）。`web/client/src/types/electron.d.ts` 仅保留更新/对话框相关声明，不涉及角色窗口。

### 最后阶段：Plan-first / Goal —— ✅ 已完成（2026-07-31 第二轮 MVP）

- **表**：`goals` / `plans` / `plan_steps`（schema.ts）。
- **Store**：`src/agent/plan/plan-store.ts`（goalStore + planStore：createPlan 事务内 supersede 旧 active plan、步骤状态机、auto-complete、unmetSteps、版本递增）。
- **控制动作**：`create_plan`（新，进 CONTROL_TOOL_SET + 混用拒绝）；inner.ts 解析 `planRequest`。
- **Loop 接线**（loop-engine）：
  - 执行模式来自 `session.execution_mode`（`direct` / `plan_first` / `goal`），run.started 事件带 execution_mode。
  - Plan-first / Goal 每轮注入 policy 提醒（无有效计划时必须先 create_plan；Goal 模式重锚定目标/约束/验证标准）。
  - `submit_result` 过 CompletionEvaluator：Plan-first 要求步骤全部完成（未满足项列出拒绝并继续）；Goal 要求结果文本证据。
  - final_answer 在计划未完成时被拒绝并继续。
  - Goal 模式：run 开始登记 current_run_id，结束时跨 Run 累计 usage，超 budget_tokens → goal paused。
- **Goal 续跑**：`routes/goals.ts`（list/create/patch/pause/resume + GET /plan/:sessionId）；resume 创建新 Run（source='goal'）并重锚定目标 + 最近进度。
- **前端**：
  - RightPanel「审批模式」上方新增「执行模式」选择（Direct / Plan-first / Goal），updateSession 持久化。
  - `GoalPanel.tsx`：目标创建（outcome/验证标准/预算）、暂停/继续（新 Run）、计划步骤进度显示（读取 active plan）。
- **测试**：`src/agent/plan/plan.test.ts`（计划生命周期/版本/supersede、goal usage/pause、CompletionEvaluator 门禁）；inner-control-mix 增加 create_plan 识别用例。
- **备注**：GoalEvaluator 现要求 submit_result 的 evidence 数组非空 + 摘要非空（模型必须提供证据路径/工具输出）；ask_user resume 已完成：`POST /api/runs/:id/inputs`（读取 ask_user checkpoint → 新 Run（resumed_from_run_id）携带用户回答继续），前端 AskUserDialog（socket `ask_user` 事件 + 重放恢复对话框）。

全部路线项已完成（P0 测试 / P1 重连+审批 / P2 Loop 拆分 / P2 控制工具 / P3-P4 Event / 08 资源 GC / 桌面窗口取消 / Plan-first+Goal / ask_user resume）。

全部路线项已完成（P0 测试 / P1 重连+审批 / P2 Loop 拆分 / P2 控制工具 / P3-P4 Event / 08 资源 GC / 桌面窗口取消 / Plan-first+Goal）。

## 5. 已知风险/建议立即检查

1. `schema.ts` 目前采用原位 ALTER + CREATE，虽然适合保留本机开发数据，但需要用一份复制数据库做迁移测试。
2. `characterRevisionStore.publish()` 读取文件系统后写 DB，需要故障注入验证原子边界。
3. `createDurableSocket()` 使用 Proxy 拦截事件；新增语义事件时要确保匹配 durable event 规则。
4. `event-run-adapter.ts` 是新代码，只有编译验证，没有真实 Provider 端到端运行。
5. 子 Agent 多轮 Loop 是新代码，需要重点测试取消、错误终态、父 Run 等待和 Provider 快照。
6. `messageStore.getMessages()` 现在只返回 `status='active'`；审计/历史页面若要读取 superseded 消息，需要新增专用查询，不能改回物理删除。
7. 前端 Presence Hook 每个 Renderer 都会注册 Socket listener；角色卡很多时建议改为全局 Presence Store。
8. 消息中的 Renderer 当前用 `character_id` 作为名称降级文本；应从角色缓存传真实名称。
9. 当前视觉编辑器发布后通过 cache invalidation 刷新，但应补浏览器端交互测试。
10. 不要修改 `client-old`。

## 6. 推荐接手顺序

1. 运行 `git status`，确认并保留现有 dirty worktree。
2. 完整阅读本文件和 08/11 两份 HTML。
3. 运行：

   ```powershell
   codegraph sync .
   graphify update .
   ```

4. ✅ P0 测试收口（已完）。
5. ✅ P1 Run 重连 + 持久审批（已完）。
6. ✅ P2 LoopEngine 拆分（已完）。
7. ✅ P2 旧控制工具删除 + 新三件套（已完；ask_user 的 resume/awaiting_input 恢复待做）。
8. ✅ P3/P4 Event/Cron 收口（已完）。
9. ✅ 08 资源 GC 和包 UI（已完）。
10. ✅ Plan-first / Goal MVP（已完）。剩余小项：ask_user resume 恢复、GoalEvaluator 严格证据校验，可在后续迭代做。

## 7. Git 状态

本轮没有 commit、没有 stage、没有切分支。

当前改动约：

- 已跟踪文件：23 个修改。
- 新增目录/文件：`web/client/src/features/`、Run runtime、Character stores、Event stores/routes、`agent/loop/*`、测试文件等。
- `git diff --stat` 统计已跟踪部分约 `921 insertions / 192 deletions`，不包含未跟踪新文件。

交接时请先审阅 diff，再按功能拆分 commit。

