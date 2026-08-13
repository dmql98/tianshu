# TianShu 执行体验与模式治理开发计划

> 文档类型：详细开发交接文档  
> 当前基线：2026-08-12 代码审计结果  
> 适用范围：附件导入、审批策略、会话交互状态、Direct / Plan-first / Goal 模式  
> 前置阶段：`RUN_LIMIT_POLICY_PLAN.md` 完成并通过验收后实施

## 1. 背景与目标

当前 TianShu 已具备附件、工具审批、计划、Goal、Run 恢复和自动续跑等基础能力，但部分功能的产品名称、前端行为和后端状态机并不一致：

- 附件只能通过文件选择器导入，不能拖放或粘贴。
- 附件以完整 Base64 通过 WebSocket 发送，大文件缺少限制和进度反馈。
- 附件草稿是全局状态，可能在切换会话后发送到错误会话。
- `Auto Approve` 仍然会弹出工作区授权请求。
- 审批弹窗是全局单例，切换会话后可能把审批响应发给错误会话。
- Direct 模式仍向模型暴露计划工具，也会注入会话中的旧计划。
- Goal 模式与 Plan-first 高度重叠，但缺少完整且一致的 Goal 生命周期。

本阶段的目标是：

1. 让模式名称和实际执行行为完全一致。
2. 让所有交互状态严格绑定到会话、Run 和具体请求。
3. 让 Auto Approve 真正做到无交互自动授权，同时保留系统硬安全边界。
4. 建立清晰的 Direct、Plan-first、Goal 三种执行语义。
5. 提供可拖放、可粘贴、有校验、有进度的附件导入体验。
6. 将附件上传和聊天执行解耦，避免大型 Base64 WebSocket 消息。
7. 补齐重连、切换会话、暂停、恢复、取消和终态的测试覆盖。

## 2. 与其他开发计划的边界

### 2.1 与 Run Limit Policy 的关系

`RUN_LIMIT_POLICY_PLAN.md` 负责：

- 单 Run 轮次限制、动态宽限和绝对上限。
- 无进展、弱进展和重复工具循环检测。
- 自动续跑链的预算、停止原因、取消和恢复。
- Run Policy 系统层、角色层和 Run 快照层的解析。

本文负责：

- 用户看到的三种执行模式到底允许哪些控制动作。
- Approval、Ask User、附件草稿等交互状态的会话隔离。
- Goal、Plan、Run 的产品语义和绑定关系。
- 附件导入和上传链路。
- 前端模式、审批、附件和 Goal 操作体验。

实施时必须复用 Run Limit Policy 已建立的 Run、continuation chain、取消和终态机制，不得再创建第二套 Run 调度或预算系统。

### 2.2 与 Builtin Content 的关系

`BUILTIN_CONTENT_DEVELOPMENT_PLAN.md` 只管理发行只读内容和用户可写内容的分层。本阶段不改变 builtin/userdata 合并规则。

本阶段产生的附件、审批审计和 Goal 运行数据全部属于 userdata：

```text
<dataDir>/media/<sessionId>/...
<dataDir>/sessions.db
```

运行产物禁止写入 `content/builtin`。

### 2.3 与 Theme 的关系

`TIANSHU_THEME_SWITCHING_PLAN.md` 与本文没有运行时依赖。附件缩略图、拖放覆盖层和审批弹窗必须使用主题 token，不得写死只适合浅色或深色主题的颜色。

## 3. 当前代码基线与已确认问题

### 3.1 附件导入

当前入口位于：

```text
web/client/src/components/Chat/ChatInput.tsx
web/client/src/stores/chatStore.ts
web/server/src/ws/chat.ts
web/server/src/agent/media-store.ts
web/server/src/agent/attachments.ts
```

已确认问题：

1. `ChatInput` 只有隐藏的 `<input type="file">`，没有 drag/drop 或 paste 处理。
2. 文件在浏览器中完整读取并转换为 Base64。
3. Base64 数据直接进入 `chat-run` WebSocket payload。
4. 服务端收到后同步解码、同步写盘。
5. 前后端均未建立明确的单文件大小、总大小和数量限制。
6. 没有读取/上传进度、错误状态、取消或重复文件检测。
7. `chatStore.attachments` 是全局数组，不属于某个会话。
8. PDF 可以被选择，但当前 provider lowering 实际会将其描述为暂不支持并跳过，前端能力展示与后端能力不一致。

### 3.2 审批策略

当前入口位于：

```text
web/server/src/agent/strategy.ts
web/server/src/agent/inner.ts
web/server/src/agent/runtime/approval-registry.ts
web/client/src/stores/chatStore.ts
web/client/src/components/Chat/ApprovalDialog.tsx
```

已确认问题：

1. `Auto Approve` 会自动放行普通危险工具。
2. 工具返回 `result.escaped` 时，`inner.ts` 无条件创建 workspace approval，没有判断当前策略。
3. 所以 Auto Approve 仍会中断 Run 并等待用户操作。
4. 前端 `pendingApproval` 是全局单例。
5. `PendingApproval` 没有稳定保存事件所属的 `session_id` 和 `run_id`。
6. `respondApproval()` 使用当前 `activeSessionId` 发送响应，而不是审批事件原始会话。
7. 切换会话后可能把 A 会话的审批响应发送给 B 会话；A 会话最终等待超时并被拒绝。
8. 审批注册表默认 60 秒超时拒绝，但前端没有明确倒计时或过期反馈。

### 3.3 Direct / Plan-first / Goal

当前入口位于：

```text
web/server/src/agent/outer.ts
web/server/src/agent/loop/control-registry.ts
web/server/src/agent/loop/loop-engine.ts
web/server/src/agent/loop/control-router.ts
web/server/src/agent/plan/plan-store.ts
web/server/src/routes/goals.ts
web/client/src/components/Chat/GoalPanel.tsx
web/client/src/components/Chat/RightPanel.tsx
```

已确认问题：

1. `getControlToolDefinitions()` 的全部控制工具始终对模型开放。
2. Direct 模式也能调用 `create_plan` 和 `update_plan_step`。
3. Direct 模式检测到现有计划时仍会将计划内容注入模型上下文。
4. Goal 当前实质上是“Plan-first + Goal 提示词”，没有形成独立生命周期。
5. Goal 成功通过 `submit_result` 后，loop engine 提前返回，末尾 Goal Token 结算可能被绕过。
6. 没有生产代码在成功完成后把 Goal 状态更新为 `completed`。
7. 暂停 Goal 只更新数据库状态，不保证取消正在执行的 Run 或后续续跑。
8. 同一会话可以创建多个 active Goal。
9. Plan 按 session 查询，未强制校验 `plan.goal_id`，Goal 可能误用旧 Goal 或 Plan-first 遗留的计划。
10. Goal 恢复依赖会话的实时 `execution_mode`，而不是 Run/Goal 的固定语义。
11. Goal UI 将其描述为“持续执行”，但主要操作仍是手动点击“继续（新 Run）”，含义不够准确。

## 4. 核心产品决策

### 4.1 三种执行模式的正式语义

| 模式 | 适用场景 | 计划能力 | 自动续跑 | 结束条件 |
|---|---|---|---|---|
| Direct | 问答、简单操作、无需持久计划的任务 | 不向模型提供持久计划工具，不注入旧计划 | 第一版禁止 | 模型正常最终回答或明确失败 |
| Plan-first | 当前用户任务需要显式分步和验证 | 强制创建本次任务计划并持续更新步骤 | 由 Run Policy 有限控制 | 当前 Plan 的步骤完成并成功提交结果 |
| Goal | 跨多个 Run 持续推进一个长期目标 | Goal 下允许产生多个阶段 Plan，但同一时刻只有一个活动 Plan | 由 Goal 预算和 Run Policy 共同控制 | Goal 验证标准满足并提交证据，或用户取消/系统失败 |

模式不是提示词风格，而是服务端能力边界。后端必须限制模型能看到和能执行的控制动作，不能只依赖文案劝告。

### 4.2 审批策略的正式语义

| 策略 | 普通读取 | 写入/危险工具 | 工作区扩展 | 用户交互 |
|---|---|---|---|---|
| Read Only | 允许 | 拒绝 | 拒绝 | 不弹框，直接拒绝并返回原因 |
| Ask Risky | 允许 | 询问 | 询问 | 需要用户选择拒绝、仅本次或始终允许 |
| Auto Approve | 允许 | 自动允许 | 自动允许最小必要目录 | 不弹审批框 |

Auto Approve 只跳过“可由用户决定的审批”，不得绕过以下硬限制：

- 工具不存在或没有绑定到角色。
- 参数 schema 不合法。
- OS、Electron 或部署环境自身的 sandbox 限制。
- 服务端文件大小、路径规范化、协议和安全校验。
- Run Limit Policy 的绝对预算、取消和熔断。
- 明确不可授权的系统目录或产品级 deny policy。

### 4.3 交互状态隔离原则

以下状态必须至少绑定到 `session_id`，运行中请求还必须绑定到 `run_id`：

- 附件草稿。
- Approval 请求。
- Ask User 请求。
- 当前 streaming/run 状态。
- 上传任务和上传进度。
- Goal 当前状态及活动 Plan。

任何响应都必须使用请求对象携带的原始 ID，禁止使用 UI 当前选中的会话推断目标。

## 5. 服务端设计

### 5.1 按模式生成控制工具

把当前无参数的：

```ts
getControlToolDefinitions()
```

调整为按执行上下文生成，例如：

```ts
getControlToolDefinitions({
  mode,
  canDelegate,
  hasActiveGoal,
  hasActivePlan,
})
```

建议能力矩阵：

```text
Direct:
  delegate_to_agent（角色和任务允许时）
  ask_user

Plan-first:
  delegate_to_agent
  ask_user
  create_plan
  update_plan_step
  submit_result

Goal:
  delegate_to_agent
  ask_user
  create_plan
  update_plan_step
  submit_result
```

Direct 不应暴露 `create_plan` 和 `update_plan_step`。如果后续决定 Direct 也必须使用 `submit_result` 统一 Run 终态，可以单独开放，但不得因此引入 Plan 依赖。

服务端路由仍应校验模式，避免模型伪造一个未暴露的控制调用。

### 5.2 Plan 作用域

Plan 必须绑定来源：

```ts
type PlanScope = 'turn' | 'goal'
```

建议数据约束：

- Plan-first 的 Plan 绑定当前用户 Turn 或 root Run chain。
- Goal 的 Plan 必须绑定 `goal_id`。
- Direct 不读取活动 Plan。
- 查询活动 Plan 时必须带作用域，禁止仅按 `session_id` 取最新活动 Plan。
- 创建新版 Plan 时只能 supersede 同一作用域下的旧 Plan。

如果暂不增加 `scope` 字段，至少必须增加/使用：

```text
plans.turn_id
plans.goal_id
```

并建立对应索引与唯一活动约束。

### 5.3 Goal 状态机

正式状态机：

```text
active ──pause──> paused ──resume──> active
active ──verified submit──> completed
active/paused ──cancel──> cancelled
active ──terminal failure──> failed
active ──budget exhausted──> paused
```

约束：

- 每个 session 同时最多一个 `active` 或 `paused` 的未终结 Goal，除非未来明确支持 Goal 队列。
- `resume` 创建新 Run，但强制携带 `goal_id` 和 `execution_mode='goal'` 快照。
- Goal Run 不以会话当前 UI 模式作为事实来源。
- `pause` 必须取消 Goal 当前 Run 和该 Goal 的 queued continuation。
- `cancel` 必须终结当前 Run chain，且不能再次 resume。
- `submit_result` 通过 Goal 验证后，在同一事务或统一终结服务中设置 `completed`。
- Goal 完成后保留全部 Plan、步骤、证据、Token 使用和终结原因。

### 5.4 统一 Run 终结与 Goal 计费

当前 Goal 结算逻辑位于 loop 尾部，容易被提前 `return` 绕过。应建立统一 finalize 路径：

```ts
finalizeRun({
  runId,
  status,
  reason,
  usage,
  goalId,
  completionEvidence,
})
```

所有路径都必须经过 finalize：

- 正常最终回答。
- `submit_result` 成功。
- `ask_user` 停驻。
- 用户取消。
- 超过 Run limit。
- Token/时间预算耗尽。
- 工具或模型异常。
- 服务重启恢复后的终态修正。

Goal Token 使用按 Run 的最终 usage 幂等累计。必须用唯一 Run ID 防止重放事件导致重复计费。

### 5.5 Auto Approve 与 workspace expansion

当工具返回 `result.escaped`：

```text
Read Only   -> 不重试，返回拒绝原因
Ask Risky   -> 创建 approval checkpoint，等待用户
Auto Approve-> 计算最小 permission root，自动加入当前会话授权并重试一次
```

自动授权必须：

- 先对目标执行绝对路径解析和 canonicalization。
- 授权文件所在目录或请求目录，不得直接授权盘符根目录。
- 对过宽目标应用 deny 或收窄规则。
- 发出 `approval.auto_granted` 审计事件。
- 记录 `session_id`、`run_id`、`tool_call_id`、tool、requested path、permission root 和时间。
- 防止同一工具因路径错误无限 escaped/retry；最多重试一次。

### 5.6 审批请求协议

审批请求对象至少包含：

```ts
interface ApprovalRequest {
  session_id: string
  run_id: string
  tool_call_id: string
  approval_kind: 'risk' | 'workspace'
  tool_name: string
  description: string
  requested_path?: string
  permission_root?: string
  created_at: number
  expires_at: number
}
```

响应接口必须携带原请求的三个主键：

```ts
interface ApprovalResponse {
  session_id: string
  run_id: string
  tool_call_id: string
  choice: 'once' | 'always' | 'reject'
}
```

服务端应验证请求仍处于 pending 状态且属于同一 Run。过期响应返回明确的 `approval_expired`，不能静默清空前端弹窗。

## 6. 附件上传设计

### 6.1 用户交互

输入框必须支持三个统一入口：

1. 点击“附件”按钮选择文件。
2. 将文件拖入输入框或聊天主区域后释放。
3. 从剪贴板粘贴图片或文件。

三种入口全部调用同一个：

```ts
addFiles(files: File[], source: 'picker' | 'drop' | 'paste')
```

拖放要求：

- `dragenter`/`dragleave` 使用计数器，避免子元素导致覆盖层闪烁。
- `dragover` 和 `drop` 必须 `preventDefault()`，避免浏览器直接打开文件。
- 拖入时显示明确的主题化覆盖层。
- 非文件拖入不触发附件逻辑。
- 输入框和整个可接受区域的视觉反馈保持一致。

### 6.2 附件草稿模型

建议前端模型：

```ts
interface AttachmentDraft {
  local_id: string
  session_id: string | null
  name: string
  mime: string
  size: number
  status: 'validating' | 'uploading' | 'ready' | 'failed'
  progress: number
  attachment_id?: string
  preview_url?: string
  error?: string
}
```

Store 使用：

```ts
attachmentDrafts: Record<string, AttachmentDraft[]>
newSessionAttachmentDrafts: AttachmentDraft[]
```

切换会话不应清除其他会话草稿，但 UI 只展示当前会话草稿。发送消息后只清除已成功附加到该消息的 ready 项。

### 6.3 上传链路

推荐流程：

```text
选择/拖放/粘贴文件
  -> 前端校验
  -> HTTP multipart/stream 上传
  -> 服务端二次校验并写入 <dataDir>/media/<sessionId>/
  -> 返回 attachment_id 与 metadata
  -> chat-run 只携带 attachment_ids
  -> 服务端把 attachment metadata 绑定到 message
```

禁止继续把大型 Base64 数据放入主聊天 WebSocket payload。为兼容旧客户端，可以短期保留 inline attachment，但必须设置严格的小尺寸上限并标记 deprecated。

### 6.4 校验规则

具体默认值应放入系统配置，建议初始值：

```text
maxFilesPerMessage: 10
maxSingleFileBytes: 25 MiB
maxTotalFileBytes: 50 MiB
```

同时校验：

- 文件名规范化和控制字符。
- MIME 与扩展名的合理一致性。
- 允许类型白名单或明确的未知类型处理。
- 重复文件检测可使用 `name + size + lastModified` 快速提示，服务端可选 hash 去重。
- 服务器不能信任前端提供的 size、MIME 或路径。
- 附件 ID 必须验证属于当前 session，防止跨会话引用。

### 6.5 Provider 能力展示

前端应根据当前模型能力显示：

- 可直接理解的图片类型。
- 可提取为文本的代码/文本类型。
- 暂不支持直接解析的 PDF 或二进制文件。

如果 PDF 当前只会被跳过，不应表现为“已成功提供给模型”。可以选择：

1. 第一版在选择时明确提示当前模型无法读取 PDF；或
2. 增加可靠的 PDF 文本提取，再以文本附件进入上下文。

## 7. 前端改造

### 7.1 ChatInput

- 抽取统一 `useAttachmentDrafts(sessionId)` 或附件 store slice。
- 实现 picker/drop/paste 共用的 `addFiles()`。
- 增加拖入覆盖层、上传进度、错误重试和取消。
- ready 前禁止发送，或允许发送时明确排除失败/上传中附件并提示用户。
- 删除附件使用真正的 `<button>`，提供 aria-label 和键盘操作。
- 图片 preview 必须有 alt；列表 key 使用 `local_id`，不能使用数组下标。
- 页面销毁或附件移除时释放 `URL.createObjectURL()`。

### 7.2 Approval UI

- Approval store 按 session 保存队列，不使用全局单例。
- 当前会话只展示自己的审批；其他会话在侧栏显示待处理徽标。
- 弹窗显示会话名、工具名、请求目录、授权范围和过期时间。
- 响应使用请求自己的 session/run/toolCall ID。
- 过期、Run 已取消、服务端拒绝响应时显示明确结果。
- Auto Approve 模式不显示 approval dialog，但可在 Run 事件中显示“已自动授权”记录。

### 7.3 Ask User UI

- 和 Approval 使用相同的 session/run 隔离原则。
- 切换会话不会把 A 的问题覆盖到 B。
- 侧栏显示哪个会话正在等待回答。
- 回答提交必须使用原始 `run_id`，并处理问题已过期或 Run 已取消的情况。

### 7.4 模式设置 UI

模式选择器旁提供简短、准确说明：

```text
Direct：直接处理，不创建持久计划，不自动续跑。
Plan-first：先建立本次任务计划，完成步骤后提交结果。
Goal：围绕长期目标跨多个 Run 推进，受总预算和验证标准约束。
```

模式切换规则：

- Run 已开始后，当前 Run 使用创建时的 mode snapshot，不被 UI 切换影响。
- 切换只影响下一个普通用户 Run。
- 活动 Goal 存在时切出 Goal，必须提示“仅改变后续普通 Run，不会取消 Goal”；取消 Goal 使用独立按钮。
- 不允许把模式切换伪装成暂停或取消。

### 7.5 GoalPanel

- 显示 Goal 状态、验证标准、累计预算、当前 Run 和活动阶段 Plan。
- 增加取消 Goal；暂停必须有“将停止当前执行”的明确说明。
- Goal 完成后显示完成时间和证据摘要。
- 如果已经存在未终结 Goal，禁止创建第二个，提供继续、暂停或取消入口。
- “继续（新 Run）”应改为更明确的“继续推进目标”。
- 只有满足恢复条件时启用继续按钮。

## 8. 数据库和迁移建议

根据现有 schema 补充或确认：

```text
goals:
  completed_at
  terminal_reason
  verification_evidence_json

plans:
  turn_id
  goal_id
  scope

goal_run_usage 或等价幂等表:
  goal_id
  run_id UNIQUE
  input_tokens
  output_tokens
  charged_at

approval_events（如现有 RunEvents 足够，可不另建表）:
  session_id
  run_id
  tool_call_id
  kind
  decision
  permission_root
  created_at
```

迁移必须：

- 对旧 Plan 推断 scope；无法可靠推断的标记为历史显示，不作为活动计划。
- 清理或 supersede 同一 session 的重复 active Plan。
- 对重复 active Goal 保留最新一个为 active，其余迁移为 paused，并记录迁移原因。
- 不删除用户历史计划、Goal 或消息。

## 9. 实施阶段

### 阶段 A：状态隔离与审批正确性

- Approval 请求增加 session/run identity。
- Approval 前端按会话存储并正确响应。
- Ask User 按会话存储。
- 附件草稿按会话存储。
- Auto Approve 覆盖 workspace expansion。
- 增加审批过期和自动授权事件。

这是最高优先级阶段，完成前不建议继续扩展 Goal UI。

### 阶段 B：模式能力边界

- 控制工具按 mode 裁剪。
- Direct 不读取或注入持久 Plan。
- control router 增加服务端 mode 校验。
- Plan-first Plan 绑定当前 Turn/root chain。
- 增加三种模式的行为测试。

### 阶段 C：Goal 状态机

- Goal/Plan/Run 显式绑定。
- 统一 Run finalize 和幂等 Goal usage 结算。
- 完成、暂停、恢复、取消和失败状态闭环。
- 防止重复活动 Goal。
- GoalPanel 配套改造。

### 阶段 D：附件体验

- picker/drop/paste 统一入口。
- 文件校验、preview、错误和进度 UI。
- HTTP/stream 上传接口。
- chat-run 改为附件 ID 引用。
- Provider 能力提示和 PDF 行为对齐。

### 阶段 E：回归与清理

- 删除已废弃的 inline Base64 主路径。
- 清理全局 pending 状态和兼容字段。
- 补充监控、错误文案和开发文档。
- 更新 graphify：`graphify update .`。

## 10. 测试矩阵

### 10.1 审批

- Ask Risky 执行危险工具时创建审批。
- Auto Approve 执行危险工具时不创建审批。
- Auto Approve 请求工作区外文件时自动授权最小目录并只重试一次。
- Read Only 对写入和 workspace expansion 直接拒绝。
- A 会话审批时切换到 B，B 不显示 A 的弹窗或错误响应。
- 从 B 返回 A 后仍能处理未过期审批。
- 审批过期、Run 取消、断线重连后状态一致。
- `always` 只扩展预期会话，不污染其他会话。

### 10.2 模式

- Direct 的 model tool definitions 中不存在计划工具。
- Direct 不注入旧 Plan。
- Direct 不产生自动 continuation。
- Plan-first 未创建 Plan 时不能执行完成提交。
- Plan-first 未完成步骤时不能结束。
- Goal Run 始终携带正确 `goal_id` 和 mode snapshot。
- Goal 不能读取其他 Goal 或 Plan-first 的 Plan。
- 切换 UI 模式不改变正在运行的 Run。

### 10.3 Goal

- 同一会话不能创建两个未终结 Goal。
- pause 同时停止当前 Run/continuation chain。
- resume 创建新 Run 并保持 Goal mode。
- 成功提交后 Goal 变成 completed。
- 成功、失败、取消、预算耗尽均且仅结算一次 Token。
- completed/cancelled/failed Goal 不能 resume。
- 服务重启后可以恢复正确的状态和当前计划。

### 10.4 附件

- picker、drop、paste 得到一致的附件草稿。
- 文件拖入不会触发浏览器导航。
- 超数量、超单文件、超总大小均有明确提示。
- 上传失败可以重试或移除。
- 切换会话时附件草稿不串会话。
- 消息只能引用属于自身 session 的 attachment ID。
- 大文件不进入 chat-run WebSocket Base64 payload。
- 删除会话时按既有数据保留策略清理 media。
- 文本、图片、PDF 和不支持类型的前后端提示一致。

## 11. 验收标准

全部满足后才能认为本计划完成：

1. Auto Approve 模式下不再出现任何可自动授权的交互审批框。
2. 不存在跨会话发送审批、Ask User 回答或附件的路径。
3. Direct 模式从工具定义、提示词、持久数据和续跑行为上都不会自行进入 Plan。
4. Plan-first 的计划只属于当前任务链。
5. Goal 有唯一、可验证、可暂停、可恢复、可取消、可完成的状态机。
6. Goal 的每个 Run usage 幂等结算，所有终态均有明确原因。
7. 用户可以拖放文件到输入区域直接添加附件，并能粘贴图片。
8. 附件具有大小/数量限制、进度、失败提示和会话隔离。
9. 大型附件不再通过主聊天 WebSocket 以完整 Base64 发送。
10. 重连、切换会话和服务重启不会造成 UI 与后端 Run 状态不一致。
11. 新增单元测试、集成测试和至少一组前端端到端测试均通过。

## 12. 明确不在本阶段处理的内容

- Builtin Content 的目录合并和 copy-on-write。
- 自定义主题图片焦点和主题色提取。
- Provider SDK 的完整原生 Files API 适配。
- 多用户、账号级审批共享或远程协同审批。
- 同一会话并行执行多个长期 Goal。
- 绕过操作系统、Electron sandbox 或产品硬安全边界。

这些内容如需实施，应另立计划，不得借本阶段顺带扩大范围。

## 13. 给接手开发 Agent 的执行提示

```text
请按照 PLAN/EXECUTION_EXPERIENCE_AND_MODE_GOVERNANCE_PLAN.md 实施 TianShu 执行体验与模式治理。

前置要求：
1. 先确认 PLAN/RUN_LIMIT_POLICY_PLAN.md 已完成并通过测试。
2. 先审计当前工作树和数据库迁移状态，不覆盖用户已有修改。
3. 使用 graphify/codegraph 理清 Run、Approval、Ask User、Plan、Goal 和附件链路。

实施顺序必须是：
A. 会话状态隔离与 Auto Approve 正确性；
B. Direct / Plan-first / Goal 的控制工具边界；
C. Goal 状态机和统一 Run finalize；
D. 附件拖放、粘贴、校验与独立上传；
E. 回归测试、兼容清理和 graphify 更新。

关键约束：
- Auto Approve 自动接受所有可授权审批，但不能绕过系统硬安全限制。
- Direct 不得向模型暴露计划工具，不得注入旧计划，不得自动续跑。
- 所有 Approval、Ask User、附件和 streaming 状态必须绑定 session/run。
- Goal Run 必须显式绑定 goal_id，不得仅依赖会话实时 execution_mode。
- 所有 Run 退出路径必须走统一 finalize，并幂等结算 Goal usage。
- 大型附件不得继续以内联 Base64 进入 chat-run WebSocket payload。

每完成一个阶段，运行对应单元测试和集成测试；发现当前实现与文档假设不一致时，先记录证据并调整设计，不要叠加第二套状态机。
```
