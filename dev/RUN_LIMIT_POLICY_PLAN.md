# 运行步数限制演进计划（Run Limit Policy）

> 目标读者：直接接手实现的 OpenCode / Codex。
>
> 本文是**开发计划**，不是需求文档，也不包含最终实现代码。
> 现状（2026-08-12）：默认每 run 上限 50 轮（`DEFAULT_MAX_TURNS`），角色可通过 `maxSteps` 覆盖（999 = 不限制）。

## 1. 背景与动机

天枢的每个"继续"都会启动一个新 Run。Run 内的模型循环（`loop-engine.ts`）受
`maxTurns` 约束：达到上限即 `max_turns` 终止并发出 `run.completed(status=max_turns)`。

### 1.1 现有问题

1. **硬上限一刀切**：复杂任务（多步骤计划 + 大量文件读写 + 构建验证）在 50 轮内
   经常做不完，用户被迫反复点"继续"。点得越多次，上下文越长，后续每轮成本越高。
2. **改成 999（不限制）风险**：一旦模型陷入工具失败循环（如 `edit` 模糊匹配反复
   改坏文件、bash 误报越界），不限制时无人盯也会一直烧 token，直到上下文爆掉触发
   有损压缩或 API 报错。
3. **现有"卡死"检测不硬停**：`detectDoomLoop` 只往 context 里塞
   `[System Alert] Repeated failures detected...` 提示，**不会自动终止 run**。

### 1.2 目标

- 默认配置下复杂任务能在一个 Run 内持续推进，减少用户手动"继续"。
- 检测到无进展/重复失败时能**自动收敛**，避免无限烧 token。
- 不破坏 `max_turns` 作为显式硬上限的语义（用户显式设置的 999 仍生效）。

## 2. 方案 B：动态限位（有进展继续，无进展收敛）

### 2.1 核心思路

把"每轮固定上限"升级为"**上限 = max(steps 上限, 动态评估)**"：
- 只要模型**有实质进展**（成功完成新步骤、产出新证据、写入新内容），就允许继续。
- 只有出现**无进展重复**时才触发"收敛"：向模型注入明确提示 → 若仍无进展 → 自动
  以 `max_turns` 结束。

### 2.2 进展信号的判定

在 `loop-engine.ts` 每轮末尾统计，作为"本轮是否有进展"的输入：

| 信号 | 判定 | 来源 |
|---|---|---|
| 工具成功 | 该轮所有 tool 无 `error` | `result.toolCallRecords` |
| 计划推进 | `update_plan_step` 改变了步骤状态 | control-router 结果 |
| 有产出 | 出现 `write` / `edit` / `submit_result` 成功 | toolCallRecords |
| 上下文变化 | 新增 assistant 文本 > 阈值 | `result.messages` 前后 diff |

实现建议：新增纯函数 `assessProgress(turnRecords, prev) → { madeProgress: boolean; reason: string }`
放在 `loop/loop-policy.ts`，与现有 token 策略并列，方便单测。

### 2.3 收敛流程

1. 达到 `maxTurns` 且 `madeProgress === true` → 注入
   `[Policy Plan-first] 本 Run 已接近步数上限，请优先完成当前步骤或调用 submit_result 收尾。`
   并**临时放宽**一次循环（`budgetGrace++`，上限 +10 轮）。
2. 放宽期间仍 `madeProgress === false` 连续 N 轮（默认 3）→ 以 `max_turns` 正常终止
   （保留现有 `run.completed(status=max_turns)` 语义）。
3. 显式 `maxSteps === 999`（不限制）时，仅依赖第 2 条兜底：无进展连续 N 轮同样收敛。

### 2.4 注意

- **不要改变** `run-store.ts` 状态机（B/C 只动 loop 逻辑，不新增 run 状态）。
- 收敛原因要写进 `run.completed` 的 payload（如 `result: 'no_progress_after_grace'`），
  前端可据此显示"已达本轮上限，可继续"而不是"出错"。

## 3. 方案 C：到顶续跑（自动开新 Run）

### 3.1 核心思路

复杂任务做不完时，不强制用户手动点"继续"，而是在 run 结束的**服务端**自动：
1. 检查当前计划（Plan-first / Goal 模式）是否仍有未完成步骤。
2. 若有 → 自动创建一个新 Run（`resumed_from_run_id` 指向前一个），
   注入提示"上一轮已达上限，继续执行剩余步骤"。

### 3.2 与现有 ask_user 续跑机制的关系

现有 `POST /runs/:id/inputs` 已经实现"用户回答 → 创建 resumed run"（routes/runs.ts）。
C 方案复用同一套 resume 骨架，只是触发源从"用户输入"变成"服务端自动判断"。

### 3.3 实现要点

- 在 `loop-engine.ts` 返回 `status === 'max_turns'` 时、`sessionLoop` 收尾处（outer.ts）
  判断：`executionMode !== 'direct' && planStore.unmetSteps(plan.id).length > 0`。
- 自动续跑**必须带 budget/次数的上限**，防止无限自续（默认单次任务最多自动续 2 次）。
- 续跑时在消息尾部追加明确提示（类似现有 `[Policy Goal]` 注入），并保留
  `resumed_from_run_id` 链路供审计。
- 前端无需改动：续跑表现为 `run.queued → run.completed` 连续出现，最后一条终态
  仍是 `max_turns`，不影响 `isStreaming` 判定。

## 4. 推荐实施顺序

| 步骤 | 内容 | 验证 |
|---|---|---|
| 1 | 新增 `assessProgress` 纯函数 + 单测 | `loop-policy.test.ts` 全绿 |
| 2 | B 方案：loop-engine 集成收敛流程 | 手动构造"无进展循环"场景，确认自动 max_turns |
| 3 | C 方案：max_turns 后自动续跑（限量 2 次） | Plan-first 模式跑长任务，确认自动续跑且不无限循环 |
| 4 | 前端提示：收敛/续跑时显示原因文案 | 交互验收 |

## 5. 不做的事（非目标）

- 不新增 run 状态（继续用现有 `max_turns` / `completed` / `failed`）。
- 不默认移除 `maxSteps` 配置（用户显式 999 仍然有效）。
- 不改动上下文压缩（`selectAndSummarize`）逻辑——那是独立优化。
- 不引入跨 Run 的全局 token 预算（Goal 模式已有 `budget_tokens`，不要混淆）。
