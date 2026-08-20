# 思考（reasoning）显示丢失问题：根因分析与修改方案

日期：2026-08-20
范围：`web/server` + `web/client`（桌面端 0.6.6 同期验证）

---

## 1. 现象

- Chat 流式输出阶段不再出现"◈ 思考中"块（ThinkingBlock），也见不到增量思考文本。
- 轨迹页（Trajectory）各 assistant 行的"思考" tab 为空。
- 模型本身正常工作、能完成推理与工具调用，只是推理过程文本完全缺失。

## 2. 数据结论（事实层面）

| 来源 | 结论 |
|---|---|
| 活跃库 `C:\Users\dmql\AppData\Local\Programs\tianshu-desktop\data\sessions.db`（今天 16:37 仍在写入） | 最近 27 条 assistant 消息 `reasoning_content` 全部为 NULL |
| 活跃会话 `mt17zh3wxkxole` | `reasoning_effort` = NULL；模型 `deepseek-v4-flash`，provider `opencode-go` |
| 旧库 `C:\.Tianshu-b\sessions.db`（0.6.0 时代） | 同一核心模型在多轮调用中**有** `reasoning_content`（1761 / 2973 字符等）持久化 |

> 注：`C:\.Tianshu-b` 是**旧**数据目录；当前应用实际数据目录是 `...\tianshu-desktop\data`（据 `resources\server\config.json`，15:48 更新）。排查早期误以为 `C:\.Tianshu-b` 为现行数据，特此更正。

## 3. 根因（端到端证据链）

**一句话：`thinking` 开关从客户端到请求体一直为 false，deepseek-v4-flash 从未被要求进入思考模式，因此完全不输出 `reasoning_content`。**

### 3.1 实测 Provider（2026-08-20，同一 endpoint + API key）

对 `https://opencode.ai/zen/go/v1/chat/completions`、`model=deepseek-v4-flash` 做最小流式请求：

| 请求形态 | `reasoning_content` 长度 |
|---|---|
| 不带 thinking 参数 | **0**（只有正文 content） |
| 带 `thinking:{type:'enabled'}` + `reasoning_effort:'medium'` | **1315**（正常流出推理文本） |

→ 该模型只在请求显式开启 thinking 时才返回推理内容。当前请求恰好从不开启。

### 3.2 开关传导链（逐环确认）

1. **“思考强度”开关一直存在，但只写 effort、不写 thinking**
   - 模型选择旁确有思考强度选择器（`ChatInput.tsx:373-383`，低/中/高/最高，默认 medium），onChange 调用 `handleReasoningEffortChange`（`ChatInput.tsx:197-205`）→ 仅 `updateSession(activeSessionId, { reasoning_effort: effort })`，**从不设置 `session.thinking`**。
   - 全前端任何地方都没有给 `session.thinking` 赋值的代码；服务端 `sessions` 表没有 `thinking` 列（`web/server/src/db/schema.ts`），API 与 `SessionSummary`（`types/index.ts:13-40`）均不含该字段 → 结构上 `session.thinking` 恒为 undefined。
   - 即：开关的“强度”值被存下来了，但“是否开启思考”这个开关门从未被打开。

2. **客户端发送时未把 effort 接上 thinking**
   - `web/client/src/stores/chatStore.ts:1605` → `thinking: session.thinking || undefined` → 恒 undefined；effort 虽在 1606 发送，但注1 的开关从未打开。

3. **服务端照传 false**
   - `web/server/src/ws/handlers.ts:171` → `thinking: !!data.thinking` → false
   - `sessionLoop`/`runLoopEngine` 把 `opts.thinking` 原样透传（`agent/outer.ts`、`agent/loop/loop-engine.ts`）。

4. **请求体跳过 thinking 与 reasoning_effort**
   - `web/server/src/llm/client.ts:198`（chat/completions）与 `:470`（responses）：`if (thinking) { body.thinking / body.reasoning = ... }` → 全部跳过。
   - 致命一环：**用户在 UI 选的思考强度即使存进了 `reasoning_effort`，也被锁在 `if (thinking)` 内从未到达 provider**——强度开关形同虚设。

5. **下游一切正常的代码因此空转**
   - 流式：无 `delta.reasoning_content` → 无 `message.delta.reasoning` → 无 ThinkingBlock。
   - 持久化：`agent/inner.ts:348/402` `reasoning_content: result.reasoning || null` → NULL。
   - 轨迹：`trajectory.ts:114` `toRow` 正常把 `reasoning_content` 映射到 `row.reasoning`，但无数据可映射。

### 3.3 为什么 0.6.0 有、0.6.6 没有

旧库（0.6.0 时代）同模型同网关能留下 reasoning → 是 0.6.0→0.6.6 之间 `thinking` 传导被改丢的回归（很可能是 ws/客户端发送或 loop 调用处将 `thinking` 改为依赖 `session.thinking`，而该字段从未被设置；按约定未做 git 溯源，仅指出回归面）。

## 4. 影响范围

- Chat 流式「思考中」块 + 思考文本（全部会话，多模型皆受 `thinking` 假值影响）。
- 轨迹页「思考」tab（数据源缺失）。
- 历史会话旧消息的 thinking 块仍可正常显示（旧数据 reasoning_content 在库里），仅**新产出**缺失。

## 5. 修改方案

### 方案 A（主修，最小改动，推荐）

让 thinking 的判定与已有的 `reasoning_effort` 设置对齐——有 effort 即视为开启思考。

**改动点 1：客户端发送侧**
`web/client/src/stores/chatStore.ts:1605`
```ts
thinking: !!session.thinking || !!session.reasoning_effort || undefined,
reasoning_effort: session.reasoning_effort || undefined,
```

**改动点 2（可选加固）：服务端兜底**
`web/server/src/ws/handlers.ts:171-172`
```ts
thinking: !!data.thinking || !!data.reasoning_effort,
reasoning_effort: data.reasoning_effort as string | undefined,
```

> 两点二选一即可修复；建议两者都加（客户端明确表达意图，服务端对未来其他客户端/协议兜底）。HTTP 侧路径（`routes/goals.ts:143`、`routes/runs.ts:223`）不传 thinking，可选一并带上：`thinking: true` 由调用场景自行决定（goal 执行等通常需要思考）。

### 方案 B（可选）：恢复"思考"为独立开关

若产品上希望"思考"与"推理强度"是解耦的两个开关（类似 deepseek 官方 thinking on/off）：
- `sessions` 表增加 `thinking INTEGER DEFAULT 1` 列（`schema.ts` 加 ALTER 迁移，仿 `reasoning_effort` 的迁移写法）。
- `types/index.ts` Session 增加 `thinking?: boolean`，API 行映射补上。
- UI 增加思考开关写 `session.thinking`；`chatStore` 发送侧逻辑不变。
- 默认值建议 `1`（保新一轮回归前的旧行为：deepseek 系默认思考）。
- 非 deepseek 系（如非推理模型）由 `loop-engine.ts` 的 `isReasoningModel` 或模型能力标记决定是否透传 thinking，避免对非推理模型发 thinking 参数。

### 方案 C（可选加固）：请求侧直接从模型能力推导

`loop-engine.ts` 决定 `opts.thinking` 时：`opts.thinking === true || isReasoningModel(model) || 会话有 reasoning_effort`，并让 `llm/client.ts` 在 thinking=false 但 `reasoning_effort` 存在时不丢弃 effort（把 `if (thinking)` 改为 `if (thinking || reasoning_effort)`）。粒度最细，但改动面比 A 大。

## 6. 验证步骤

1. **单测**：给 `chatStore` 或 ws handler 补一条"reasoning_effort 存在 → 发出 thinking 事件 / 请求体含 thinking 参数"的用例。
2. **手工复现**：在 UI 把推理强度设为非默认值 → 发送消息 → 观察：
   - 流式阶段出现"◈ 思考中"并以增量渲染思考文本；
   - 跑完后消息泡泡上方保留 ThinkingBlock（默认展开，除非 `tianshu:showReasoning=false`）；
   - 轨迹页 assistant 行「思考」tab 有内容。
3. **数据验证**：新会话跑一轮后查 `messages.reasoning_content` 与 `llm_calls.response_reasoning` 非 NULL。
4. **回归**：非推理模型（如普通 chat 模型）不受影响（thinking 不会误发）；旧消息 thinking 块显示不变；轨迹 timeline 排序、usage/metrics 富化不受影响。

## 7. 回归风险

- 将打开 thinking 后，模型进入思考模式：首 token 延迟上升、token 消耗增加（思考 token 计费），chat 流式先出思考后出正文。属预期行为变化。
- 若某 provider 不支持 thinking 参数，需确认其忽略该字段或按现有 `compose.ts` 的 reasoning 兼容逻辑处理（`probeResponsesApi` / protocol 探测已有兜底）。
- 确认 `TrajectoryView` 的「思考」tab 默认展开/折叠行为符合预期（当前 `thinking-block` 只在展开时渲染正文，折叠仅显示"◈ 思考中 · Ns"）。

## 8. 相关代码索引

- 客户端发送：`web/client/src/stores/chatStore.ts:1605`
- 客户端 effort 选择器（只写 effort，不写 thinking）：`web/client/src/components/Chat/ChatInput.tsx:197-205`
- 类型：`web/client/src/types/index.ts:45,90-133`
- 服务端上行：`web/server/src/ws/handlers.ts:171-172`
- 透传：`web/server/src/agent/outer.ts:53`、`agent/loop/loop-engine.ts:56,258,290`
- 请求体 gating：`web/server/src/llm/client.ts:198（chat）、470（responses）`
- 持久化：`web/server/src/agent/inner.ts:348,402`
- 轨迹映射：`web/client/src/features/trajectory/trajectory.ts:106-130（toRow）`
- 展示：`web/client/src/components/Chat/MessageItem.tsx:95-101`、`ThinkingBlock.tsx`
- 库迁移样例：`web/server/src/db/schema.ts:33,47`（reasoning_content / reasoning_effort 的 ALTER 写法）