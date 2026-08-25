# 天枢子 Agent 拉起机制排查报告

> 排查对象：TianShu 平台 `delegate_to_agent` 子 Agent 委托机制
> 现象：用户几乎感知不到天枢有拉起子 Agent
> 结论：**机制实现完整，但配置与交互导致它在普通聊天场景下从未真正触发过**

---

## 一、拉起机制架构（代码链路）

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

---

## 二、"感觉不到"的根因分析

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

`outer.ts` 的 targets 过滤逻辑：
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

### 根因 4：即使发生，存在感也极低

前端对 `sub_agent.started` 的全部处理（`chatStore.ts:629`）是静默向会话列表插入一条
`Sub: <task前60字>` 条目——无 toast、无高亮、不切换视图。主聊天流中委托仅呈现为一张
普通 tool 卡片。子 run 过程事件虽复用同一 stream 广播，但 UI 焦点停留在父会话。

---

## 三、自我委托的价值与"并行"现状评估

### 自我委托的真实价值（当前即可兑现）

1. **上下文隔离**：子会话是全新历史（仅 system + task），跑完只回传摘要，
   探索过程不污染主会话上下文
2. **预算扩展**：子 run 有独立 maxSteps 配额（默认 50），相当于延长单任务预算

### 但"并行开发"当前支撑不起来

| 环节 | 事实 | 影响 |
|---|---|---|
| 父循环 | control-router 中 `await spawnAndRunSubAgent` | 同一父会话下的多个子任务**严格串行** |
| 并发互斥 | run-coordinator 按 sessionId 加队列锁 | 不同子会话间可并行；同一父会话 fan-out 不行 |
| instances 参数 | inner.ts:123/499 解析后**从未使用** | 多实例扇出在设计蓝图中但未实现 |
| 工作区 | 子代理默认继承父会话同一 workspace | 真并行写码会有文件冲突，需配合多 workspaces |

---

## 四、改进建议（按优先级）

### P0 — 打通功能（不改代码即可验证）

1. 给目标角色的 `groups` 配置组值（如 yi 已在 `['mysticism']`）
2. 给会话补 `active_group`：
   ```sql
   UPDATE sessions SET active_group='mysticism' WHERE id='<会话id>';
   ```
   （长期应在建会话 UI 中提供选组入口，写入 active_group）
3. 重启后对模型说「把这个任务委托给 yi」，观察 `sub_agent.started` 事件
   与左侧新增的 `Sub: ...` 会话

### P1 — 可观测性

- `chatStore.ts:629`：为子 agent 会话加运行状态标识（spinner/徽标），委托发生时
  给予显式提示（toast 或主聊天流内联卡片），点击可跳转子会话视图

### P2 — 引导模型正确使用

- `loop/control-registry.ts` delegate 描述补充使用场景
  （如「需要上下文隔离的大范围调研、独立视角验证、预算不足的长任务」）
- targets 计算为空时在描述中显式注明「未配置可委托角色」，便于现场排查

### P3 — 真正的并行 fan-out

1. 启用闲置的 `instances` 参数：handleSubAgentRequest 循环发起 N 个
   `spawnAndRunSubAgent` Promise，`Promise.all` 汇聚
2. 子会话 ID 增加实例序号，避免同毫秒碰撞
3. 文档明确：并行写码需配合多 workspaces 划分工作区

---

## 五、涉及文件索引

| 文件 | 角色 |
|---|---|
| `web/server/src/agent/outer.ts` (~L160-183) | 控制动作注入 + delegateTargets 计算 |
| `web/server/src/agent/inner.ts` (L445, L466-502) | 独占性校验 + sub_agent_request 识别 |
| `web/server/src/agent/loop/control-registry.ts` | 控制动作定义与描述文案 |
| `web/server/src/agent/loop/loop-engine.ts` (L389) | 协议结果路由 |
| `web/server/src/agent/loop/control-router.ts` | handleSubAgentRequest（阻塞等待） |
| `web/server/src/agent/sub-agent.ts` | spawnAndRunSubAgent 核心（校验/建会话/跑循环） |
| `web/server/src/agent/runtime/run-coordinator.ts` | 按 session 的并发互斥队列 |
| `web/server/src/event/event-run-adapter.ts` (L83) | 唯一会给会话设组的代码路径 |
| `web/client/src/stores/chatStore.ts` (L629) | sub_agent.started 前端处理（静默插条目） |
| `devdata/sessions.db` | agent_tasks（空）/ sessions（无子会话）实证 |
| `devdata/characters/*/character.json` | 角色 role/groups 配置 |
