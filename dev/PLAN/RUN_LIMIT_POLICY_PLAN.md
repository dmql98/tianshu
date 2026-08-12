# TianShu 运行策略、动态收敛与自动续跑开发交接文档

> 目标读者：直接接手实现的 OpenCode / Codex。
>
> 本文是完整开发交接规格，不包含最终业务代码。
>
> 当前基线（2026-08-12）：角色以 `maxSteps` 配置单 Run 最大模型轮次；默认 50，`999` 在 UI 中显示为“不限制”，但实际仍最多运行 999 轮。

## 1. 交付目标

把当前单一 `maxSteps` 改造成三层运行策略：

1. **系统安全策略**：系统管理员或本机用户设置，不可被角色突破，负责绝对上限、无进展阈值、自动续跑总开关和续跑链预算。
2. **角色执行偏好**：跟角色定义和 revision 走，负责该角色希望何时收敛、使用多少宽限、是否愿意自动续跑。
3. **Run 策略快照**：Run 创建时将系统策略与角色偏好解析成确定值并持久化；运行过程中配置变化不影响已启动 Run。

同时实现：

- 软上限、宽限和绝对上限。
- 基于可验证状态变化的进展判定。
- 连续无进展和重复工具循环自动停止。
- Plan-first/Goal 模式的有限自动续跑。
- 自动续跑的幂等、取消竞争、崩溃恢复和审计。
- 前端跨 Run 连续 streaming、整链停止、状态提示和重连恢复。

## 2. 核心决策

### 2.1 哪些配置属于系统

系统配置负责安全边界和算法规则：

- 单 Run 允许的最大绝对轮次。
- 角色最多可申请多少宽限轮次。
- 动态限额总开关。
- 自动续跑总开关。
- 单链最大自动续跑次数。
- 单链累计轮次、token 和墙钟时间上限。
- 连续无进展、连续弱进展和重复工具循环阈值。
- Direct 模式是否允许自动续跑；第一版固定为否。
- 功能灰度开关和策略版本。

系统策略是硬边界。角色只能选择更保守的值，不能扩大系统上限。

### 2.2 哪些配置跟角色走

角色配置负责执行偏好：

- 希望运行多少轮后开始收敛。
- 希望申请多少宽限轮次。
- 是否允许自动续跑。
- 可选：角色自己的自动续跑次数偏好，但不能超过系统上限。

角色偏好进入 `character.json` 和 character revision。不同角色可以有不同策略，例如研究角色偏长、快速问答角色偏短。

### 2.3 哪些值必须跟 Run 走

Run 保存最终有效策略：

- 系统策略版本。
- 角色偏好原值。
- 解析后的 soft/grace/absolute 限额。
- 解析后的自动续跑许可和链预算。
- continuation root、index 和 trigger。
- 最终停止原因和限额统计。

Run 快照是审计和恢复事实来源。执行时不得重新读取实时系统配置或角色文件来改变当前 Run。

## 3. 现状与改造入口

### 3.1 当前系统配置

`web/server/src/config.ts` 当前把以下配置保存在：

```text
<TIANSHU_CONFIG_DIR>/config.json
```

现有 `Config` 只有 `dataDir`。`web/server/src/routes/config.ts` 当前只提供 dataspace API。

本计划在同一个系统配置文件中增加 `runPolicy`，不把系统安全策略写入 `<dataDir>`、角色目录或前端 `localStorage`。

### 3.2 当前角色配置

`web/server/src/db/characterStore.ts` 的 `CharacterRecord` 包含：

```ts
maxSteps?: number
```

角色文件位于：

```text
<dataDir>/characters/<id>/character.json
```

`characterRevisionStore.ensureCurrent()` 会把角色 meta/content/visual 固定成 revision。现有 Run 创建时保存 `character_revision_id` 和 snapshot hash，`sessionLoop()` 优先读取 pinned revision，因此适合承载角色运行偏好。

### 3.3 当前 Run

`run-store.ts` 已有：

- `max_turns`
- `resumed_from_run_id`
- `parent_run_id`
- `result`
- `usage`
- 完整状态机和 durable event store

`loop-engine.ts` 当前直接执行：

```ts
while (turn < maxTurns && !signal?.aborted)
```

需要把单值 `maxTurns` 替换为 Run 创建时固定的策略快照。

## 4. 配置存储与数据模型

### 4.1 系统配置文件

扩展 `web/server/src/config.ts`：

```ts
export interface SystemRunPolicy {
  version: 1
  dynamicLimitEnabled: boolean
  autoContinuationEnabled: boolean

  defaultSoftTurns: number
  defaultGraceTurns: number
  maxAbsoluteTurnsPerRun: number
  maxGraceTurns: number

  noProgressThreshold: number
  weakProgressThreshold: number
  repeatedToolLoopThreshold: number

  maxAutoContinuations: number
  maxChainTurns: number
  maxChainTokens: number
  maxChainWallTimeMs: number
}

interface Config {
  dataDir: string
  runPolicy?: SystemRunPolicy
}
```

推荐默认值：

```ts
export const DEFAULT_SYSTEM_RUN_POLICY: SystemRunPolicy = {
  version: 1,
  dynamicLimitEnabled: true,
  autoContinuationEnabled: false, // 前后端全部完成后再改为 true

  defaultSoftTurns: 50,
  defaultGraceTurns: 10,
  maxAbsoluteTurnsPerRun: 999,
  maxGraceTurns: 50,

  noProgressThreshold: 3,
  weakProgressThreshold: 5,
  repeatedToolLoopThreshold: 2,

  maxAutoContinuations: 2,
  maxChainTurns: 180,
  maxChainTokens: 500_000,
  maxChainWallTimeMs: 30 * 60 * 1000,
}
```

默认值是初始建议，不应散落在多个文件中。唯一默认常量放在服务端策略模块，config loader 使用它补齐缺失字段。

### 4.2 系统配置校验

```ts
function normalizeSystemRunPolicy(input: unknown): SystemRunPolicy
```

要求：

- 未配置、旧版本或字段缺失时补默认值。
- 非数字、NaN、小数、负数和越界值被规范化。
- `maxAbsoluteTurnsPerRun` 范围 `1..999`。
- `defaultSoftTurns <= maxAbsoluteTurnsPerRun`。
- `defaultGraceTurns <= maxGraceTurns`。
- `maxGraceTurns <= maxAbsoluteTurnsPerRun - 1`；若绝对上限为 1，则 grace 为 0。
- continuation/token/time 阈值必须为正数。
- 损坏 `runPolicy` 只回退运行策略默认值，不能丢失 `dataDir`。
- 保存系统策略必须原子更新 `config.json`，保留未知但受支持的其他系统配置字段。

### 4.3 角色配置

废弃把 `maxSteps` 当作硬安全上限，新增：

```ts
export interface CharacterRunPolicy {
  version: 1
  softTurns?: number
  graceTurns?: number
  autoContinuation?: 'inherit' | 'enabled' | 'disabled'
  maxAutoContinuations?: number
}

export interface CharacterRecord {
  // ...existing fields
  runPolicy?: CharacterRunPolicy
  maxSteps?: number // 迁移期只读兼容字段
}
```

语义：

- 字段缺失表示继承系统推荐值。
- `softTurns` 是角色偏好，不是硬上限。
- `graceTurns` 是申请值，最终受系统 `maxGraceTurns` 和绝对上限约束。
- `autoContinuation='inherit'` 使用系统总开关。
- `enabled` 仍必须服从系统总开关。
- `disabled` 始终禁止该角色自动续跑。
- 角色 `maxAutoContinuations` 只能缩小系统值。

角色 API、character manager 工具、编辑页和 revision snapshot 都必须支持 `runPolicy`。

### 4.4 角色旧字段迁移

加载角色时规范化：

```text
已有 runPolicy
  → 使用 runPolicy，忽略 maxSteps 的执行语义

没有 runPolicy，maxSteps 为 1..998
  → runPolicy.softTurns = maxSteps
  → graceTurns 继承系统默认
  → autoContinuation = inherit

没有 runPolicy，maxSteps >= 999
  → runPolicy.softTurns = 系统 maxAbsoluteTurnsPerRun
  → graceTurns = 0
  → autoContinuation = inherit

两者都没有
  → 全部继承系统默认
```

迁移分两阶段：

1. 兼容期：读取时转换，保存角色时写 `runPolicy` 并可保留 `maxSteps` 一个版本。
2. 清理期：前后端不再写 `maxSteps`，确认旧客户端不再支持后移除字段。

`999` UI 文案从“不限制”改成“高上限”；迁移后不再推荐用 sentinel 表达继承。

### 4.5 Run 策略快照

```ts
export interface RunPolicySnapshot {
  version: 1
  policyVersion: number

  system: {
    dynamicLimitEnabled: boolean
    autoContinuationEnabled: boolean
    maxAbsoluteTurnsPerRun: number
    maxGraceTurns: number
    noProgressThreshold: number
    weakProgressThreshold: number
    repeatedToolLoopThreshold: number
    maxAutoContinuations: number
    maxChainTurns: number
    maxChainTokens: number
    maxChainWallTimeMs: number
  }

  character: {
    softTurns?: number
    graceTurns?: number
    autoContinuation: 'inherit' | 'enabled' | 'disabled'
    maxAutoContinuations?: number
  }

  effective: {
    softTurns: number
    graceTurns: number
    absoluteTurns: number
    autoContinuation: boolean
    maxAutoContinuations: number
    maxChainTurns: number
    maxChainTokens: number
    maxChainWallTimeMs: number
    noProgressThreshold: number
    weakProgressThreshold: number
    repeatedToolLoopThreshold: number
  }
}
```

系统部分只保存影响本 Run 的安全字段，不复制无关系统配置。

## 5. 有效策略解析

### 5.1 纯函数

新增：

```text
web/server/src/agent/loop/run-policy-resolver.ts
```

```ts
export function resolveRunPolicy(
  system: SystemRunPolicy,
  character: CharacterRunPolicy | undefined,
): RunPolicySnapshot
```

解析规则：

```ts
const requestedSoft = character.softTurns ?? system.defaultSoftTurns
const softTurns = clamp(requestedSoft, 1, system.maxAbsoluteTurnsPerRun)

const requestedGrace = character.graceTurns ?? system.defaultGraceTurns
const graceTurns = clamp(
  requestedGrace,
  0,
  Math.min(system.maxGraceTurns, system.maxAbsoluteTurnsPerRun - softTurns),
)

const absoluteTurns = Math.min(
  softTurns + graceTurns,
  system.maxAbsoluteTurnsPerRun,
)

const characterAllowsContinuation = character.autoContinuation !== 'disabled'
const autoContinuation =
  system.autoContinuationEnabled && characterAllowsContinuation

const maxAutoContinuations = Math.min(
  character.maxAutoContinuations ?? system.maxAutoContinuations,
  system.maxAutoContinuations,
)
```

当 `dynamicLimitEnabled=false`：

- `softTurns = absoluteTurns`。
- `graceTurns = 0`。
- 无进展策略不提前结束。
- 绝对上限仍生效。

### 5.2 固定时机

策略在 `runStore.create()` 前解析，所需输入来自：

- 当前系统配置的规范化快照。
- `resolveCharacterBinding()` 得到的 pinned character revision。

必须使用 revision 内的角色偏好，不能再读取 live `character.json`。创建 Run 和保存策略快照在同一数据库事务中完成。

自动后继 Run 默认继承 chain root 的系统安全快照和当前 pinned character revision，防止链运行中系统上限被放宽。若系统配置后来变得更严格，则创建后继时取“原快照与当前系统安全上限中更严格者”；不能取更宽松值。

## 6. 数据库与持久化

### 6.1 Runs 表

建议新增：

```text
run_policy_snapshot TEXT NOT NULL
configured_max_turns INTEGER NOT NULL
soft_turns INTEGER NOT NULL
absolute_turns INTEGER NOT NULL
continuation_root_run_id TEXT NOT NULL
continuation_index INTEGER NOT NULL DEFAULT 0
resume_trigger TEXT NULL
```

说明：

- `run_policy_snapshot` 保存完整 JSON。
- 独立数值列用于查询和诊断，必须与 JSON effective 字段一致。
- 现有 `max_turns` 迁移期映射为 `absolute_turns`，后续可废弃。
- `resume_trigger`：`manual | user_input | auto_limit | null`。
- `parent_run_id` 保留父子 agent 语义，不用于 continuation chain。

### 6.2 历史迁移

旧 Run：

- `configured_max_turns = max_turns`。
- `soft_turns = max_turns`。
- `absolute_turns = max_turns`。
- 生成 `version:1` legacy 快照，动态限额和自动续跑均为 false。
- `continuation_root_run_id = id`。
- `continuation_index = 0`。
- 不根据历史 resumed 关系猜测自动链。

### 6.3 自动续跑唯一性

同一前驱 Run 最多一个 `auto_limit` 后继。优先增加 partial unique index：

```sql
CREATE UNIQUE INDEX ...
ON runs(resumed_from_run_id, resume_trigger)
WHERE resume_trigger = 'auto_limit';
```

若迁移框架不适合，新增 `run_continuations` 表，以 `from_run_id` 为主键。创建后继和登记映射必须在同一事务。

## 7. 轮次口径和优先级

一次进入模型请求流程计一个 turn。保持现有口径，以下均计数：

- 正常模型调用。
- LLM API 外层重试。
- 上下文溢出、压缩后重试。
- 被策略拒绝的 final answer。
- 被拒绝的 `submit_result`。

一次模型响应中的多个并行工具仍是一轮。

每轮结束按此顺序处理：

1. 用户取消/AbortSignal → `cancelled`。
2. Goal token budget 耗尽 → `budget_exhausted`。
3. ask_user、approval、paused → parked，不自动续跑。
4. submit_result 成功 → completed/task_complete。
5. 达 absoluteTurns → max_turns/absolute_limit。
6. 动态限额开启且无进展达到阈值 → max_turns/no_progress。
7. 其他情况继续。

## 8. 进展判定

### 8.1 模型

```ts
type ProgressLevel = 'strong' | 'weak' | 'none'

interface ProgressSignal {
  kind: string
  key: string
  detail?: string
}

interface ProgressAssessment {
  level: ProgressLevel
  signals: ProgressSignal[]
  fingerprint: string
  repeatedFingerprint: boolean
}
```

`assessProgress()` 是纯函数，只消费规范化轮次事实。

### 8.2 强进展

- plan step 状态真实变化。
- 新 verification evidence 写入。
- 文件新增或内容 hash 变化。
- 数据库业务对象真实变化。
- 测试/构建从失败变成功或失败集合减少。
- 首次获得改变后续决策的结构化证据。
- submit_result 成功。

### 8.3 弱进展

- 首次读取新文件或新 API 对象。
- 首次出现新错误类别。
- 首次切换到不同工具类别。
- 上下文压缩成功并显著降低 token。

只有弱进展不能无限延长，连续达到 `weakProgressThreshold` 后按无进展处理。

### 8.4 不算进展

- assistant/reasoning 文本增长。
- 相同工具、相同规范化参数和相同结果的重复调用。
- 成功 read/grep 但没有新范围或新结果。
- write/edit 成功但内容 hash 未变化。
- 重复 plan 状态和相同 evidence。
- 相同测试输出。
- final answer 或 submit_result 被拒绝。

### 8.5 ToolCallRecord 扩展

```ts
interface ToolCallRecord {
  toolName: string
  hasError: boolean
  error?: string
  args?: string
  normalizedArgsHash?: string
  outcomeKind?: 'read' | 'write' | 'state_change' | 'verification' | 'control' | 'other'
  resultHash?: string
  changed?: boolean
  evidenceKey?: string
}
```

- hash 使用去时间戳、稳定排序和路径规范化后的摘要。
- 不把完整工具输出、文件内容或密钥写入 Run result。
- 写工具由 executor 提供 `changed`，不能只看退出码。
- 并行工具分别产生信号；部分失败不抹掉真实变化。

## 9. Run 内动态收敛

### 9.1 运行状态

```ts
interface RunLimitRuntimeState {
  graceStarted: boolean
  graceTurnsUsed: number
  consecutiveNoProgress: number
  consecutiveWeakOnly: number
  lastStrongProgressTurn: number
  warningEmitted: boolean
}
```

### 9.2 流程

1. softTurns 前持续记录进展，不注入收敛提示。
2. 首次达到 softTurns：发布 `run.limit_warning`，注入一次收敛提示。
3. 强进展重置无进展计数，可继续使用剩余 grace。
4. 弱进展累计 weak-only 计数。
5. 无进展累计 no-progress 计数。
6. 达系统快照阈值后结束为 `max_turns`。
7. 达 absoluteTurns 无条件停止。

提示只注入一次：优先完成当前步骤、保存验证证据、提交结果或明确阻塞，禁止重复相同工具调用。

### 9.3 Doom-loop

保留 `detectDoomLoop` 并与进展策略合并：

- 首次命中产生 none 信号并提示切换工具类别。
- 相同 fingerprint 再次命中且达到系统阈值，可在 absoluteTurns 前停止。
- 原因记录为 `repeated_tool_loop`。

### 9.4 结构化结果

```ts
type RunLimitReason =
  | 'no_progress_after_soft_limit'
  | 'absolute_limit'
  | 'repeated_tool_loop'
  | 'continuation_limit'

interface RunLimitSummary {
  reason: RunLimitReason
  policyVersion: number
  softTurns: number
  absoluteTurns: number
  turnsUsed: number
  graceTurnsUsed: number
  noProgressStreak: number
  continuationScheduled: boolean
  nextRunId?: string
}
```

同一结构写入 `runs.result` 和 terminal event。

## 10. 自动续跑

### 10.1 共享服务

新增：

```text
web/server/src/agent/runtime/run-resume-service.ts
```

```ts
interface ResumeRunRequest {
  previousRunId: string
  trigger: 'manual' | 'user_input' | 'auto_limit'
  instruction: string
  createUserTurn: boolean
}
```

不能从 `outer.ts` 调 HTTP 路由。`POST /runs/:id/inputs` 改用共享服务，但仍负责 ask_user checkpoint 校验。

### 10.2 Trigger 语义

| trigger | 用户 Turn | 消息身份 | continuation root | auto 次数 |
|---|---:|---|---|---:|
| manual | 是 | 用户 | 新链 | 0 |
| user_input | 是 | 用户回答 | 保留原链 | 不增加 |
| auto_limit | 否 | 内部策略指令 | 保留原链 | +1 |

自动指令不能伪装成用户消息。

### 10.3 允许条件

全部满足才续跑：

- 前一 Run 是 max_turns。
- execution mode 为 plan_first 或 goal。
- Run 策略快照允许 auto continuation。
- plan 有未完成步骤，或全部完成但需要一次 finalize-only Run。
- Goal 仍 active 且预算未耗尽。
- 没有 ask_user、approval 或 paused checkpoint。
- 没有更新的 manual/user_input Run。
- 链次数、turns、tokens、wall time 均未超有效快照。
- 用户未取消该链。

Direct 和子代理第一版不自动跨 Run 续跑。

### 10.4 链预算

取 Run 策略快照中的：

- maxAutoContinuations。
- maxChainTurns。
- maxChainTokens。
- maxChainWallTimeMs。

任一用尽就停止。Goal budget 取更严格值。

所有 plan steps 完成但没有成功 submit_result 时，最多创建一个 softTurns=10、无额外 continuation 的 finalize-only Run。

### 10.5 创建顺序

1. loop 返回 max-turns 结果。
2. terminal 发布前执行 continuation eligibility。
3. 事务内创建后继和唯一映射。
4. 旧 Run result 写 `continuationScheduled/nextRunId`。
5. 发布旧 terminal、`run.continuation_queued` 和新 `run.queued`。
6. 新 Run 入队。

创建失败则旧 Run正常终止，不能提前宣称续跑。

## 11. 取消、并发和崩溃恢复

### 11.1 取消

- 宽限期取消：不创建后继。
- 后继已 queued：取消同 continuation root 中的 running/queued auto Run。
- 不取消更新的 manual/user_input Run。
- 需要数据库 cancellation marker 防止取消与续跑创建竞争。

### 11.2 用户新输入

- 用户 Run优先于 auto continuation。
- 创建 auto 后继的事务检查 session 是否已有更新的 manual/user_input Run。
- 已创建未运行的 auto Run 标记 cancelled，reason=`superseded_by_user_run`。

### 11.3 Parked

`awaiting_input`、`awaiting_approval`、`paused` 通过现有 checkpoint/resume 继续，不消耗 auto continuation 配额。

### 11.4 重启恢复

- result 已指向 queued 后继：重新入队。
- 映射存在但 result/queued event 缺失：修复并补 durable event。
- 没有 continuation 映射的历史 max_turns：不重新决策，不复活。
- 有 cancellation marker：不恢复。
- orphan running Run 先按 interrupted 处理，不能直接重复可能有副作用的工具。

## 12. 系统配置 API 与 UI

### 12.1 API

在现有 config router 增加：

```text
GET /api/config/run-policy
PUT /api/config/run-policy
POST /api/config/run-policy/reset
```

响应返回规范化值：

```ts
interface SystemRunPolicyResponse {
  policy: SystemRunPolicy
  defaults: SystemRunPolicy
}
```

PUT 必须：

- 完整 schema 校验。
- 原子保存 config.json。
- 返回保存后的规范化配置。
- 只影响以后创建的 Run。
- 不自动停止或修改正在执行的 Run。

### 12.2 系统设置 UI

`SettingsPage` 新增“运行与安全”区域：

- 动态限额总开关。
- 默认软轮次。
- 默认宽限轮次。
- 单 Run 绝对上限。
- 最大角色宽限。
- 自动续跑总开关。
- 自动续跑次数、链轮次、链 token、最长时间。
- 无进展、弱进展和重复循环阈值；可放高级设置。
- 恢复系统默认。

UI 规则：

- 明确区分“默认值”和“不可突破上限”。
- 修改后提示“仅对新 Run 生效”。
- 开启自动续跑时显示 token/时间风险说明。
- 输入控件执行与服务端相同的范围校验，但服务端仍是最终边界。
- 不使用 localStorage 保存系统策略。

建议新增前端模块：

```text
web/client/src/api/runPolicy.ts
web/client/src/features/run-policy/SystemRunPolicySettings.tsx
web/client/src/features/run-policy/types.ts
```

## 13. 角色配置 API 与 UI

### 13.1 API 与工具

现有角色 create/update API 和 `character_manager` 支持：

```json
{
  "runPolicy": {
    "version": 1,
    "softTurns": 80,
    "graceTurns": 15,
    "autoContinuation": "inherit",
    "maxAutoContinuations": 1
  }
}
```

服务端保存前只校验角色字段的基本范围；实际有效值由系统策略 clamp。角色响应增加：

```ts
interface CharacterRunPolicyView {
  configured: CharacterRunPolicy
  effectivePreview: RunPolicySnapshot['effective']
  constrainedFields: string[]
}
```

`effectivePreview` 按当前系统配置计算，仅用于 UI；真正 Run 仍在创建时重新解析并快照。

### 13.2 角色编辑 UI

替换当前 maxSteps toggle/单值编辑：

- 收敛起始轮次：空值表示继承系统默认。
- 宽限轮次：空值表示继承系统默认。
- 自动续跑：继承系统 / 允许 / 禁止。
- 最多自动续跑：空值表示继承系统值。
- 显示“当前有效策略”。
- 若角色请求值被系统限制，显示例如“角色设置 200，受系统上限限制后实际为 120”。
- “恢复继承”删除角色覆盖字段，不写死系统当前值。

`RightPanel` 显示简洁摘要：

```text
运行策略：80 + 15 轮宽限
自动续跑：继承系统（当前开启，最多 1 次）
```

内置角色遵循 `BUILTIN_CONTENT_DEVELOPMENT_PLAN.md`：编辑运行偏好前先 copy-on-write，不能写安装资源。

## 14. 前端 Run 状态协调

### 14.1 客户端状态模型

`chatStore` 不应只用 `isStreaming:boolean` 表达跨 Run 状态。建议增加：

```ts
interface ActiveRunState {
  runId: string | null
  continuationRootRunId: string | null
  phase: 'idle' | 'running' | 'continuation_pending' | 'parked'
  nextRunId: string | null
  limitWarning?: RunLimitSummary | null
}
```

兼容期可保留 `isStreaming` 作为派生值：

```ts
isStreaming = phase === 'running' || phase === 'continuation_pending'
```

### 14.2 新事件

```text
run.limit_warning
run.grace_started
run.continuation_queued
```

所有事件持久化到 run_events。

### 14.3 事件归并规则

- terminal 携带 `continuationScheduled=true`：进入 continuation_pending，不置 idle。
- 有 nextRunId 时立即把 active Run 指向后继或记录 pending target。
- `continuation_queued` 与新 `run.queued` 任意顺序到达结果相同。
- 处理 terminal 时只有 `event.run_id === current runId` 才能清空当前 Run。
- 旧 Run 迟到事件不能覆盖新 active Run。
- 重复事件按 event_id/seq 幂等。
- 只有确定没有后继时才恢复输入。

### 14.4 ChatInput

- running/continuation_pending 时禁用发送。
- 保持停止按钮可用。
- 停止调用支持按 continuation root 取消整条 auto 链。
- parked 的 ask_user 使用专用对话框，不误显示普通发送状态。

### 14.5 状态文案

- 软上限：“已接近本轮上限，正在优先收敛当前步骤”。
- 自动续跑：“本轮已结束，正在继续剩余步骤（1/2）”。
- 无进展：“连续多轮没有可验证进展，本轮已停止”。
- 重复循环：“检测到重复工具循环，本轮已停止”。
- 绝对上限：“已达到系统单轮安全上限”。
- 链上限：“已达到自动续跑安全预算，可手动检查后继续”。

### 14.6 重连

重连时：

1. 查询 session 的非终态 Run。
2. 若不存在，检查最新 terminal result 是否指向 queued 后继。
3. 获取后继 Run 状态和遗漏事件。
4. 重建 ActiveRunState。

不能只根据最后一条 Socket 事件设置 `isStreaming`。

## 15. 服务端文件改造清单

- `web/server/src/config.ts`
  - SystemRunPolicy schema、默认值、规范化和原子保存。
- `web/server/src/routes/config.ts`
  - run-policy API。
- `web/server/src/db/characterStore.ts`
  - CharacterRunPolicy、旧 maxSteps 兼容迁移。
- `web/server/src/character/revision-store.ts`
  - 确认 runPolicy 进入 revision hash/snapshot。
- `web/server/src/tools/character_manager/index.ts`
  - 新角色策略参数，停止写 maxSteps。
- `web/server/src/agent/loop/run-policy-resolver.ts`
  - 系统 + 角色 → RunPolicySnapshot 纯函数。
- `web/server/src/agent/loop/loop-policy.ts`
  - 进展评估和策略常量。
- `web/server/src/agent/loop/loop-engine.ts`
  - soft/grace/absolute 和结构化结果。
- `web/server/src/agent/inner.ts`
  - ToolCallRecord outcome。
- `web/server/src/agent/loop/completion-evaluator.ts`
  - doom-loop fingerprint。
- `web/server/src/agent/runtime/run-store.ts`
  - 策略快照、链字段和查询。
- `web/server/src/agent/runtime/run-resume-service.ts`
  - manual/user_input/auto_limit 共享服务。
- `web/server/src/agent/runtime/run-event-store.ts`
  - 新事件、幂等和修复。
- `web/server/src/agent/outer.ts`
  - terminal 前 continuation 决策。
- `web/server/src/routes/runs.ts`
  - ask_user 迁移和整链取消。
- `web/server/src/agent/session-runner.ts`
  - 后继入队、取消和恢复。
- `web/server/src/db/schema.ts`
  - 数据库迁移和唯一约束。

## 16. 前端文件改造清单

- `web/client/src/api/runPolicy.ts`：系统策略 API。
- `web/client/src/features/run-policy/types.ts`：共享前端类型。
- `web/client/src/features/run-policy/SystemRunPolicySettings.tsx`：系统配置 UI。
- `web/client/src/pages/SettingsPage.tsx`：挂载“运行与安全”。
- `web/client/src/types/index.ts`：CharacterRunPolicy 和 effective preview。
- `web/client/src/pages/CharacterDetailPage.tsx`：角色偏好 UI 和迁移旧 maxSteps。
- `web/client/src/components/Chat/RightPanel.tsx`：有效策略摘要。
- `web/client/src/api/runs.ts`：Run snapshot/result/chain 类型。
- `web/client/src/stores/chatStore.ts`：ActiveRunState、乱序和重连。
- `web/client/src/components/Chat/ChatInput.tsx`：跨 Run 禁用和整链停止。
- Run 状态组件：提示限额、续跑和最终停止原因。

## 17. 测试计划

### 17.1 系统配置

- 缺失 runPolicy 使用默认值且不覆盖 dataDir。
- 损坏、未知版本和部分字段正确回退。
- 所有边界和不变量规范化正确。
- API GET/PUT/reset。
- 保存原子性和并发更新。
- 修改只影响新 Run。

### 17.2 角色策略与 revision

- 无覆盖时继承系统。
- 角色值被系统正确 clamp。
- enabled 不能突破系统 autoContinuation=false。
- disabled 始终生效。
- maxAutoContinuations 只能缩小。
- 旧 maxSteps 各边界迁移正确。
- 保存后不再依赖旧 maxSteps。
- runPolicy 改变会产生新 revision。
- 已启动 Run 仍使用旧 revision 快照。
- 编辑内置角色先物化 userdata 副本。

### 17.3 Run 策略解析

- soft/grace/absolute 组合边界。
- dynamic disabled 退化为固定硬上限。
- 系统配置变严格后自动后继取更严格值。
- Run snapshot JSON 和独立列一致。
- 历史 Run 迁移不改变既有行为。

### 17.4 进展和收敛

- 新文件/内容 hash 改变是强进展。
- 重复读取、无变化 edit、文本增长不是进展。
- plan 状态真实改变和重复写入的区别。
- 测试失败集合减少。
- 并行工具部分失败。
- soft warning 只发一次。
- no-progress、weak-progress、doom-loop 和 absolute limit。
- Goal budget 和 abort 优先。

### 17.5 自动续跑

- Direct、parked、budget exhausted、角色禁用、系统禁用均不续跑。
- Plan-first/Goal 合法续跑。
- finalize-only 最多一次。
- 次数、turn、token、时间任一超限停止。
- 同一前驱并发只创建一个后继。
- user input 抢占 auto continuation。
- 子代理不自动续跑。

### 17.6 取消和恢复

- 宽限期取消不创建后继。
- 整链取消只影响 auto Run。
- continuation 事务失败无孤儿。
- queued 后继重启恢复。
- 历史 max_turns 不复活。
- durable event 缺失修复幂等。

### 17.7 前端

- 系统设置读取、保存、reset 和错误反馈。
- 角色 inherit/configured/effective/constrained 展示。
- terminal + nextRunId 保持 streaming。
- 三类 continuation 事件任意顺序一致。
- 迟到旧事件不清空新 Run。
- 自动续跑期间禁止发送且允许停止。
- 无后继才恢复输入。
- 重连恢复正确。
- 不再把 999 显示为无限。

## 18. 实施阶段

### P0：配置和契约

1. 实现 SystemRunPolicy schema、默认值、config API 和测试。
2. 实现 CharacterRunPolicy、旧 maxSteps 迁移和 revision 测试。
3. 实现 RunPolicySnapshot resolver。
4. 扩展数据库和前后端类型，执行历史迁移。

### P1：系统和角色 UI

1. 增加系统“运行与安全”设置。
2. 替换角色 maxSteps UI。
3. 增加 effective preview 和受限提示。
4. 更新 RightPanel 摘要。

### P2：动态收敛

1. 扩展 ToolCallRecord。
2. 实现 assessProgress。
3. 集成 soft/grace/absolute。
4. 合并 doom-loop。
5. 先在 `dynamicLimitEnabled` 开关下上线。

### P3：自动续跑服务

1. 提取 run-resume-service。
2. 迁移 ask_user，确认行为不退化。
3. 实现 continuation chain、预算和幂等。
4. 实现取消竞争。

### P4：前端连续体验

1. 实现 ActiveRunState。
2. 处理 continuation 事件和乱序。
3. 实现整链停止和状态文案。
4. 实现重连恢复。

### P5：恢复和默认启用

1. 实现服务端 continuation 恢复扫描。
2. 补 durable event 修复。
3. 完成长任务、并发、崩溃和真实桌面回归。
4. 前后端全部验收后才默认开启 `autoContinuationEnabled`。

## 19. 上线与兼容策略

- 第一阶段默认 dynamic limit 开、auto continuation 关。
- 旧角色可继续读取 maxSteps，但新 UI 和 API 只写 runPolicy。
- 客户端尚未支持 continuation 协调时，服务端不得开启 auto continuation。
- 数据库和 API 新字段保持向后兼容；旧客户端忽略未知字段仍能查看 Run。
- 自动续跑默认启用必须是前后端同一版本的发布门槛。
- 观测误判率后再调整阈值，不能让角色直接配置算法阈值。

## 20. 验收标准

1. 系统设置拥有运行安全硬边界，并保存在 `TIANSHU_CONFIG_DIR/config.json`。
2. 角色只保存执行偏好，并进入 character revision。
3. Run 创建时保存完整有效策略快照，运行中配置变化不影响它。
4. 角色无法突破系统 absolute、grace、continuation、token 或时间上限。
5. 旧 maxSteps 可平滑迁移，999 不再宣称无限。
6. 重复成功读取、无变化写入和文本增长不算强进展。
7. 有真实进展的任务可获得有限宽限，无进展或重复循环会停止。
8. Goal budget、取消和 parked 状态优先级正确。
9. 自动续跑只适用于允许的 Plan-first/Goal Run，并受完整链预算约束。
10. 同一前驱最多一个 auto 后继，链路可审计和恢复。
11. 用户新输入和取消可靠优先于自动续跑。
12. 前端自动续跑期间保持连续 streaming，不短暂开放输入。
13. 系统配置 UI、角色配置 UI、状态提示和重连恢复完整可用。
14. ask_user 行为不退化，子代理不会形成续跑树。
15. 服务重启不会重复副作用或复活历史 max_turns Run。
16. 服务端、客户端、迁移、并发和桌面回归测试全部通过。

## 21. 非目标

- 不允许角色修改系统安全边界或进展检测阈值。
- 不允许模型在运行中提高自己的限额。
- 不新增 Run 状态；用现有状态、结构化 result 和事件表达。
- 不修改上下文压缩算法，只规定其轮次和进展口径。
- 不提供真正无限的 Run。
- 不在第一版为 Direct 或子代理开启自动跨 Run 续跑。
- 不用自然语言猜测代替 plan、Goal 和 submit_result 完成协议。
