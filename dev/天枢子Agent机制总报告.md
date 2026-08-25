# 天枢子 Agent 机制总报告（排查 + 对比 + 优化）

> 文档性质：合并两份前期报告——「天枢子 Agent 拉起机制排查报告」（现状诊断）与「天枢子 Agent 机制对比与优化报告」（dsh/opencode 对比 + 优化路线），并据最新讨论决策统一重排优化路线。
> 证据来源：天枢代码 `web/server/src/agent/*` 与 `web/client/src/**` 实测；dsh / opencode 均有 `.codegraph` 索引，用 codegraph 直接读取在盘源码（行号精确）。
> 标注 `[推断]` 处为基于 UI/SDK/权限层与公开设计推断、未直接读到 spawn 核心实现。
> 决策演进：早期排查建议的「group 打通（配 active_group）」已让位给「轻量拉起一个干活 agent」；前端「组入口 / 让子 agent 帮忙按钮」经讨论**否决**，改为纯模型驱动。详见第七节「决策变更」。

---

## 一、天枢子 Agent 机制架构（代码链路）

源码位置：`web/server/src/agent/`

```
outer.ts (#2 区块, ~L160-183)
  │  将 8 个控制动作注入工具列表（delegate_to_agent / submit_result / ask_user /
  │  create_plan / update_plan_step / create_goal / get_goal / complete_goal）
  │  并按 active_group 计算 delegateTargets，追加 "| targets: id(name)" 到描述
  ▼
inner.ts (L445, L466-502)
  │  控制动作必须独占一轮：与其他工具混批 → 整批拒绝（control.rejected 事件）
  │  识别 delegate_to_agent 调用 → 返回 type='sub_agent_request'
  │  解析参数：task / target_character_id / sub_strategy / instances(未使用)
  ▼
loop/loop-engine.ts (L389)
  │  路由到 control-router.handleSubAgentRequest
  ▼
loop/control-router.ts handleSubAgentRequest
  │  ① 子会话（parent_id 非空）直接拒绝 —— 孙代理结构上不可能
  │  ② await spawnAndRunSubAgent(...) ← 父循环阻塞等待
  │  ③ 结果经 summarizeAndMerge 包装成 tool 消息回传父模型
  ▼
sub-agent.ts spawnAndRunSubAgent (L72)
   ① MAX_DEPTH=1，depth>=1 抛错；必须有持久化的父 Run
   ② validateSubAgentTarget（L33）：
      - 目标角色 role 必须是 sub 或 both
      - 目标=自身 → 放行
      - 目标≠自身 → 必须在会话 active_group 组内，否则抛
        「跨组委托被禁止」（会话无组时：只能委托给自身）
   ③ 创建子会话 sub_<父会话ID>_<角色ID>_<时间戳>、child Run、
      agent_tasks 表记录（status: queued→running→completed/failed）
   ④ 剥离子代理的 delegate_to_agent 能力（防递归）
   ⑤ enqueueRun 经 RunCoordinator 排队执行 innerLoop，
      最多 targetChar.maxSteps（默认 50）轮
   ⑥ 广播 sub_agent.started / run.queued / run.started / run.completed 事件
```

关键设计点：
- 控制动作走协议层而非普通工具执行器，独占一轮是硬约束（inner.ts 强制 + 描述中模型可见提示）
- 子会话 ID 含毫秒时间戳，重复自我委托不会互相覆盖
- **子 Agent 的 system prompt 由 `sub-agent.ts` L155-178 独立拼装，不经 `outer.ts`**，直接 `innerLoop(messages, ...)`——这意味着子 Agent 的人格/上下文完全由 `sub-agent.ts` 决定，改这里不影响父会话 system

---

## 二、天枢「感觉不到」根因分析

### 决定性证据（devdata/sessions.db 实测）

| 检查项 | 结果 |
|---|---|
| `agent_tasks` 表 | **0 行** —— 从未有任何委托记录 |
| `sessions` 表 `parent_id` 非空 | **无** —— 从未创建过子会话 |

结论：不是"发生了但看不见"，而是**从未发生**。

### 根因 1：所有普通聊天会话的 active_group 都是 NULL

实测最近 8 个会话（含 5 个 coder 会话）：`active_group` 全部为 NULL。

原因：前端**没有任何入口设置该字段**。全代码检索：
- 仅 `event/event-run-adapter.ts:83` 在事件驱动会话中写入 `assigned_group`
- 前端 `chatStore.ts` 创建会话时 `active_group: opts.active_group || null`，但没有任何页面传入
- 服务端 `ws/handlers.ts:106` 支持更新，但前端不发

> 决策演进：早期排查建议"给会话补 active_group / 建会话选组入口"（即 group 委托）。最新讨论已决定 **group 委托（三态/跨组）留到未来「agent 群聊」**，当前会话模式不做组选择（见第七节）。

### 根因 2：角色分组配置使可委托目标退化为"仅自己"

`devdata/characters/*/character.json` 实测：

```
coder          role=both   groups=None           ← 码仔
ram            role=both   groups=['rezero']
taro           role=both   groups=['mysticism']
yi             role=both   groups=['mysticism']
ziwei          role=both   groups=['mysticism']
ui-designer    role=both   groups=['design']
xiaohong       role=both   groups=[]             ← 永远不可被委托
```

`outer.ts` 的 targets 过滤逻辑（L166-172）：
```ts
if (c.role !== 'sub' && c.role !== 'both') return false
if (c.id === session.character_id) return true      // 自己恒通过
if (!activeGroup) return false                       // 会话无组 → 其余全滤掉
return c.groups?.includes(activeGroup) ?? false
```

叠加效果：active_group=NULL 时，唯一通过过滤的目标是**当前角色自己**。
模型看到的描述是 `targets: coder(码仔)`——即使模型尝试委托 ram/yi，
也会被 `validateSubAgentTarget` 拒绝：「跨组委托被禁止：该角色没有组，只能委托给自身」。

### 根因 3：模型缺乏调用动机与场景引导

delegate 的 description 只有一句「委托子任务给同组 sub 角色」，没有说明什么场景该用。
控制动作需独占一轮、父循环阻塞等待，模型天然倾向自己完成。targets 为空时
（如未来新建的无组角色）连 `| targets:` 后缀都不会追加。

### 根因 4：即使发生，存在感也极低（已修正认知）

> 早期排查原文写"前端对 `sub_agent.started` 静默插 `Sub:` 条目，无 toast/高亮"。后续确认：**天枢前端本就有子会话树展示**，并非完全"看不见"。

现状（修正后）：
- **会话列表已有子会话树**：`SessionPanel.getChildren` 按 `parent_id` 把子会话缩进挂到父下（会话1 → 子会话1 / 子会话2）。
- **轨迹页已监听子 Agent**：`TrajectoryView` 的 `TRAJECTORY_REFRESH_EVENTS` 含 `sub_agent.started`（L34），父轨迹会响应刷新。
- 仍缺两处：① 触发瞬间无**主动提示**（toast/高亮）；② **父轨迹不内联**子 Agent 执行——父轨迹按会话整拉（`TrajectoryView` 无 run 选择器），子 Agent 内部 toolcalls/结果在其**子会话自己的轨迹页**，父轨迹只显示 `delegate_to_agent` 调用卡。

---

## 三、天枢子 Agent 价值与并行现状

### 自我委托的真实价值（当前即可兑现）

1. **上下文隔离**：子会话是全新历史（仅 system + task），跑完只回传摘要，探索过程不污染主会话上下文
2. **预算扩展**：子 run 有独立 maxSteps 配额（默认 50），相当于延长单任务预算

### 但"并行开发"当前支撑不起来

| 环节 | 事实 | 影响 |
|---|---|---|
| 父循环 | control-router 中 `await spawnAndRunSubAgent` | 同一父会话下的多个子任务**严格串行** |
| 并发互斥 | run-coordinator 按 sessionId 加队列锁 | 不同子会话间可并行；同一父会话 fan-out 不行 |
| instances 参数 | inner.ts:123/499 解析后**从未使用** | 多实例扇出在设计蓝图中但未实现 |
| 工作区 | 子代理默认继承父会话同一 workspace | 真并行写码会有文件冲突，需配合多 workspaces |
| 子 Agent 人格 | sub-agent.ts L155-159 注入目标角色完整 soul/user/memory | **overkill**：普通会话里拉个干活 agent 不需要全量人格（用户原话） |

---

## 四、deepseek-harness 的子 Agent 机制

### 拉起方法：模型主动调 `subagent` 工具（工具驱动）
核心在 `packages/subagent/tool-subagent/src/index.ts`。这是一个**模型可见的工具**（默认名 `subagent`，可配置 `toolName`），由父 Agent 在推理中主动调用，传入 `description`（3-5 词展示用）+ `prompt`（完整任务）。

### 何时拉起：模型自行判定，两种上下文语义二选一
工具描述由 `providerWording(inheritsConversation)` 生成，明确区分两种子 Agent：

- **继承式（fork）**：`inheritsConversation=true` 时，子 Agent 被 seed 为「父会话所有已完成 turn」，工具描述写「a child agent seeded with all completed turns so far（看不到当前 in-flight turn）」——适合基于本对话的后续分析/复审/续写。
- **独立式（self-contained）**：默认，子 Agent 是「a separate agent that works in its own context」，父只收回结果不收回中间步骤——适合独立的研究/实现/分析。工具描述明确要求「Give it a complete, standalone prompt: it does not see this conversation」。

### 三种执行模式（关键设计亮点）
`resolveDelegationRun` + `execute` 给出路由（L247-439）：

1. **one-shot 前台阻塞**：默认（非 continuable 时 `run_in_background` 默认 false），`await ctx.subagents.start(...)` 等结果返回。
2. **后台 job**：`run_in_background: true` → `jobs.start(...)` 返回 jobId，父用 `job_output` 收集、`job_kill` 停止（one-shot 的后台变种）。
3. **continuable 后台（默认后台）**：`backgroundMode: 'continuable'` 时 `run_in_background` 默认 true，调用 `ctx.subagents.startContinuable(...)` **立即返回 durable subagent id**，子会话保持存活供后续 turn；run 完成时 runtime 主动给父发完成通知（含 outcome）；父用 `send_message` 在同一子会话起新 turn。

### 「轻量 / 可定制」原生支持（天枢最缺的能力）
委托请求（`DelegationRunRequest`）可携带：
- `persona`：覆盖子 Agent 的人设（不必继承父角色 soul）。
- `toolFilter`：`{ allow, deny }` 工具白/黑名单（按需精简子 Agent 工具）。
- `agentOptions`：独立的 provider/model。
- `maxDepth`：递归深度上限。

即 dsh 把「子 Agent 要不要带完整人格/全套工具」交给**每次委托调用**决定，而不是写死。

### 多轮继续与发现
- `packages/subagent/tool-subagent-control/src/list-agents.ts` 的 `list_agents` 工具：父用它发现自己的 `children` / `descendants`（整棵子树），返回每个子 Agent 的 durable id、label、status（running/idle/ready）。
- `send_message` 工具：在已有子会话上开新 turn（continuable 模式的核心续跑手段）。
- `continuation.ts` 的 `SubagentContinuationManager.startContinuable`：管理 durable childId、Activation 生命周期、`closingScopes`（父销毁时子先拆）。

---

## 五、opencode 的子 Agent 机制

### 拉起方法：模型主动调 `Task` / agent 工具（工具驱动）
TUI 层 `packages/tui/src/routes/session/index.tsx` 直接出现 `Task:2221` 以及 `formatSubagentTitle` / `formatSubagentRetry` / `formatSubagentToolcalls` / `formatCompletedSubagentDetail`，说明存在 `Task` 工具（与 Claude Code 的 Task 子 Agent 同构），其工具调用与子 Agent 完成详情在 TUI 中专门渲染。工具定义框架见 `packages/plugin/src/tool.ts`（`tool({ description, args, execute })`，zod schema + `ToolContext`）。

> spawn 核心（agent 工具如何 `start` 子 session 的 run loop）codegraph 在本项目中多次偏移到 LSP/进程层，未直接读到。**以下「何时拉起/执行」基于 TUI 渲染符号、`background` 端点、`subagent-permissions` 与 opencode 公开设计推断** `[推断]`。

### 何时拉起：模型在推理中判定，子 Agent 默认后台 `[推断]`
- `footer.view.tsx` 暴露 `backgroundSubagents: boolean` 与快捷键 `session.background`（`Detach any synchronous subagents currently blocking the session and continue them in the background`——SDK `POST /experimental/session/{id}/background`）。即**前台阻塞的子 Agent 可被显式 detach 到后台**，父继续。
- `session.child.first` 快捷键：父会话切到第一个子 Agent 视图。

### 关键设计亮点
1. **排队（queuedPrompts）**：`footer.view.tsx` 有 `queuedPrompts` 与 `session.queued_prompts` 快捷键——子 Agent 忙时新 prompt 进队列而非丢弃/阻塞，状态栏显示「N queued」。
2. **多子 Agent 标签（tabs）**：`subagent().tabs`、`foregroundSubagents`、`onSubagentSelect`——同一父会话可挂多个子 Agent，TUI 以 tab 呈现，可前台/后台切换。
3. **权限隔离**：`packages/opencode/src/agent/subagent-permissions.ts` + `listSubagentPermissions`——子 Agent 有独立权限层（不继承父的全部权限），与父会话权限解耦。
4. **强可见性**：TUI 完整渲染子 Agent 的 title、retry、toolcalls、completed detail，并有后台切换/队列提示的快捷键与状态栏 hint。

### 轻量
子 Agent 走独立 `Task` prompt（不携带父完整人格），且有权限隔离层。相比 dsh 未看到显式 `persona`/`toolFilter` 覆盖，但「权限 + 独立 prompt」已隔离了副作用面。

---

## 六、三方对比

| 维度 | 天枢 TianShu | deepseek-harness | opencode |
|---|---|---|---|
| 触发方式 | 模型调 `delegate_to_agent`（控制动作，独占一轮） | 模型调 `subagent` 工具 | 模型调 `Task`/agent 工具 `[推断]` |
| 上下文 | 隔离（全新 history）但带**全量 soul/user/memory** | 可选：继承已完成 turn / 完全隔离 | 独立上下文 `[推断]` |
| 执行模式 | 父**阻塞串行** | 前台阻塞 / 后台 job / **continuable 后台（默认）** | 前台 + **后台 detach** `[推断]` |
| 多轮继续 | 无（一次性） | 有（continuable + `send_message` + `list_agents`） | 有（子 Agent tab 可切回续） `[推断]` |
| 并行 fan-out | 仅不同父可并行；同父串行；instances 未实现 | 后台可并行多 subagent | 后台并行 + **queuedPrompts 排队** `[推断]` |
| 轻量/定制 | **无**（写死全量人格） | **原生**：`persona` 覆盖 + `toolFilter` 工具过滤 + 独立 model | 独立 prompt + **权限隔离层** |
| 可见性 | 会话树缩进 + 轨迹页（父**不内联**子 Agent 细节） | `list_agents` 发现 + 完成通知 | TUI tab/title/retry/toolcalls/队列提示/后台切换 |
| 递归 | MAX_DEPTH=1（无孙代理） | `maxDepth` 可配 | 子 Agent 亦可再派 `[推断]` |
| 前端入口 | 无（纯模型驱动） | 无（纯模型驱动） | 无（纯模型驱动，但 TUI 强展示） |

**核心差距一句话**：天枢的子 Agent 是「全量人格 + 父阻塞串行 + 一次性 + 父轨迹不内联」，而 dsh/opencode 是「可定制轻量人格 + 后台非阻塞 + 可继续 + 强可见（含父视图内联子 Agent 执行）」。

**dsh 与 opencode 的共同范式**：子 Agent = 模型主动调工具 + 后台非阻塞 + 可继续 + 强可见 + 可定制轻量人格。天枢目前只实现了「模型调工具」这一半，且工具语义还停留在全量人格 + 父阻塞。

---

## 七、优化路线（统一重排 + 决策变更）

### 决策变更（相对早期排查报告）
早期排查报告建议 P0=group 打通（配 active_group）、P1=可观测、P2=引导、P3=并行 fan-out，是机制从未触发时的诊断。经后续讨论，方向已调整：

- **group 委托（三态/跨组）让位**：原型 `active_group` 配置 / 组下拉入口 **留到未来「agent 群聊」**，不在当前会话模式做。
- **前端入口否决**：「建会话选组」「让子 Agent 帮忙按钮」「轻量开关」均**不做**。触发保持**纯模型驱动**——模型在对话中说「拉起子 Agent 去…」时自己调 `delegate_to_agent`，无需前端入口。
- **当前会话目标**：**轻量拉起一个干活 Agent**（去全量人格 + 让模型敢拉 + 拉起可见）。

以下 P0–P5 为调整后的统一路线。

### P0 — 子 Agent 轻量化（改动最小、收益最大，先落地）
**问题**：`sub-agent.ts` L155-159 把目标角色完整 `soul/user/memory` 塞进子 Agent system，overkill。
**改动**：去掉这三段，换成中性 worker 身份（保留 `## Delegated Task` + 工具约束 + 可选 skills）。

```ts
// 现状
if (charContent.soul)  systemParts.push(`## Character\n${charContent.soul}`)
if (charContent.user)  systemParts.push(`## User Info\n${charContent.user}`)
if (charContent.memory) systemParts.push(`## Memory\n${charContent.memory}`)
// 改为
systemParts.push(`## Role\n你是专注执行单任务的助手，不扮演特定角色，不携带长期用户上下文。用工具把任务做完，简洁汇报结果。`)
```

**收益**：子 Agent 上下文从「全量人格」降为「任务导向」，token 与干扰大幅减少；且因子 Agent system 由 `sub-agent.ts` 独立拼、不经 `outer.ts`，改这里**不会被父会话 system 覆盖**（已确认 L155-178 直接 `innerLoop(messages, ...)`）。
**借鉴 dsh**：若想更进一步，可让 `delegate_to_agent` 请求支持 `persona`/`toolFilter` 覆盖（dsh 的 `DelegationRunRequest` 范式），把「轻量程度」交给每次委托决定。
**落地性**：确定、孤立、零风险——仅 `web/server/src/agent/sub-agent.ts` L155-159。建议作为第一个派活项。

### P1 — delegate 描述场景引导（让模型知道何时拉）
**问题**：根因 3——delegate description 只有一句「委托子任务给同组 sub 角色」，模型无动机。
**改动**：`loop/control-registry.ts` 的 delegate 描述补充使用场景（如「需要上下文隔离的大范围调研 / 独立视角验证 / 预算不足的长任务」）；targets 为空时在描述显式注明「未配置可委托角色」，便于现场排查。
**说明**：这是纯模型驱动下让子 Agent「用起来」的关键——配合 P0 轻量化，模型才有理由在对话里说「拉起子 Agent 去…」。

### P2 — 触发提示 + 轨迹内联子 Agent（贴合现有前端，解决「感觉不到」）
**现状**：天枢**已有**子会话树（`SessionPanel` 父下挂子）与轨迹页（监听 `sub_agent.started`），不是从零做展示。缺两处：
- **触发主动提示**：`sub_agent.started` 到来时给显式 toast 或高亮新挂出的子会话条目，让用户感知「正在拉子 Agent」（对应 opencode 的状态栏提示）。
- **轨迹内联子 Agent 执行**：当前父轨迹只显示 `delegate_to_agent` 调用卡，子 Agent 内部 toolcalls/结果在其**子会话自己的轨迹页**（`TrajectoryView` 按会话整拉、无 run 选择器）。可借鉴 opencode 的 `formatSubagentToolcalls` / `formatCompletedSubagentDetail`，在父轨迹内联子 Agent 的执行摘要（toolcalls + 完成结果），让「拉起子 Agent 去…」在轨迹里呈现完整因果。实现需跨会话聚合父 run + 子 run/事件（子会话 id 已知 `sub_<父>_<角色>_<时间戳>`）。

### P3 — 父循环非阻塞后台化（对齐 dsh continuable / opencode background）
**问题**：`control-router` 内 `await spawnAndRunSubAgent` 让父串行阻塞，根因 3 也提到模型天然倾向自己干。
**方向**：
- 短期：让 `delegate_to_agent` 支持「后台」语义——`handleSubAgentRequest` 不 await 结果，立即回父「已派发子 Agent <id>」，子 Agent 跑完经 `summarizeAndMerge` 回传并触发父会话事件。
- 借 dsh 的 `run_in_background` 默认策略与 opencode 的 `session.background` detach 思路：前台阻塞子 Agent 也可被转后台。

### P4 — 可继续 / 多轮（借鉴 dsh continuable + send_message）
**问题**：子 Agent 一次性，无法续跑、无法追问。
**方向**：子会话 durable 化，提供「在该子会话继续」的续跑手段（dsh 的 `send_message` + `list_agents` 范式），父可随时追问子 Agent。工作量较大，建议在 P0–P2 验证「轻量拉起能用起来」后再做。

### P5 — 真并行 fan-out + group 委托（长期，留「agent 群聊」）
- 启用 `instances` 参数、`Promise.all` 汇聚、子会话 ID 加实例序号、多 workspace 隔离（原排查 P3）。
- group 委托（三态 / 跨组，含 `active_group` 语义重定义）一并规划。
- 需改 `run-coordinator` 锁粒度；这是「agent 群聊」的前置能力，不在当前会话模式硬塞。

---

## 八、结论

1. **机制完整、从未触发**：天枢子 Agent 链路（outer→inner→control-router→sub-agent）实现完整，但 `active_group=null` 使可委托目标退化为"仅自己"、模型无动机、且全量人格 overkill，导致 `agent_tasks` 0 行。
2. **最该先做的（当前会话模式）**：P0 轻量化（改 `sub-agent.ts` 十几行，零风险、不被覆盖）+ P1 delegate 描述场景引导（让模型自主判断何时拉）+ P2 触发提示/轨迹内联（拉起可见）。**前端不新增入口**，靠模型在对话里主动拉起。三者组合即可让「普通聊天里轻量拉起一个干活 Agent」从「从未发生」变成「好用」。
3. **group / 跨组 / 真并行**：留到「agent 群聊」专项，与 P5 一并设计。
4. **可直接派活的下一步**：P0 轻量化是确定的、孤立的改动（仅 `web/server/src/agent/sub-agent.ts` L155-159），建议作为第一个落地项；可顺手把 P1 的 delegate 描述引导一并补上。

---

## 九、涉及文件索引

| 项目 | 文件 | 角色 |
|---|---|---|
| 天枢 | `web/server/src/agent/sub-agent.ts` L155-178 | 子 Agent system 拼装（**P0 轻量化落点**） |
| 天枢 | `web/server/src/agent/outer.ts` L163-183 | 控制动作注入 + delegateTargets 过滤 |
| 天枢 | `web/server/src/agent/inner.ts` L445, L466-502 | 独占性校验 + sub_agent_request 识别 |
| 天枢 | `web/server/src/agent/loop/control-registry.ts` | 控制动作定义与描述文案（**P1 落点**） |
| 天枢 | `web/server/src/agent/loop/loop-engine.ts` L389 | 协议结果路由 |
| 天枢 | `web/server/src/agent/loop/control-router.ts` | handleSubAgentRequest（父阻塞 await，**P3 落点**） |
| 天枢 | `web/server/src/agent/runtime/run-coordinator.ts` | 按 session 的并发互斥队列（**P5 落点**） |
| 天枢 | `web/client/src/stores/chatStore.ts` L629 | sub_agent.started 处理（**P2 落点**） |
| 天枢 | `web/client/src/components/Chat/SessionPanel.tsx` | 子会话树渲染（getChildren 按 parent_id） |
| 天枢 | `web/client/src/features/trajectory/TrajectoryView.tsx` | 轨迹页（监听 sub_agent.started，按会话整拉） |
| 天枢 | `web/server/src/event/event-run-adapter.ts` L83 | 唯一会给会话设组的代码路径 |
| 天枢 | `devdata/sessions.db` | agent_tasks（空）/ sessions（无子会话）实证 |
| 天枢 | `devdata/characters/*/character.json` | 角色 role/groups 配置 |
| dsh | `packages/subagent/tool-subagent/src/index.ts` | `subagent` 工具定义、providerWording、resolveDelegationRun、execute |
| dsh | `packages/subagent/subagent/src/continuation.ts` | startContinuable、ContinuableStart、生命周期 |
| dsh | `packages/subagent/tool-subagent-control/src/list-agents.ts` | list_agents 发现、send_message 续跑 |
| opencode | `packages/tui/src/routes/session/index.tsx` | Task 工具渲染、formatSubagent* 详情 `[推断 spawn 核心]` |
| opencode | `packages/opencode/src/cli/cmd/run/footer.view.tsx` | backgroundSubagents、queuedPrompts、subagent tabs |
| opencode | `packages/opencode/src/agent/subagent-permissions.ts` | 子 Agent 权限隔离 |
| opencode | `packages/plugin/src/tool.ts` | 工具定义框架 |
