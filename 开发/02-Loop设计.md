# 天枢 — Agent Loop 设计

> 文档版本：v0.1 | 更新日期：2026-07-20

---

## 一、设计目标

1. **星官隔离** — 每个星官拥有独立的 Loop 实例，工具集、历史、记忆、权限完全隔离
2. **生产级可靠性** — Context 压缩、Checkpoint 持久化、六种恢复路径
3. **紫微路由** — 轻量路由模型 → 专业星官处理，跨星官通信只传递摘要
4. **并发与串行** — 独立工具并发执行，有依赖的工具串行

---

## 二、整体架构

```
┌─────────────────────────────────────────────────┐
│                前端 / SDK / Cron                  │
└──────────────────┬──────────────────────────────┘
                   │ submit_message()
                   ▼
┌─────────────────────────────────────────────────┐
│              紫微路由引擎 (StarRouter)             │
│  ├─ 意图识别（轻量模型，3-5 个路由工具）             │
│  ├─ 目标星官匹配                                    │
│  └─ 构建 RouteRequest                               │
└──────────────────┬──────────────────────────────┘
                   │ RouteRequest
                   ▼
┌─────────────────────────────────────────────────┐
│           目标星官 QueryEngine（独立实例）          │
│                                                   │
│  ┌─────────────────────────────────────────┐      │
│  │          _query_loop()                   │      │
│  │                                          │      │
│  │  1. Pre-API Pipeline                     │      │
│  │     ├─ microcompact                      │      │
│  │     ├─ progressive_compress              │      │
│  │     └─ autocompact                       │      │
│  │                                          │      │
│  │  2. Stream Model Response                │      │
│  │     ├─ content delta                     │      │
│  │     ├─ reasoning delta                   │      │
│  │     └─ tool call coalescing              │      │
│  │                                          │      │
│  │  3. Recovery Transitions                 │      │
│  │     ├─ max_output_tokens_recovery        │      │
│  │     ├─ reactive_compact_retry            │      │
│  │     └─ token_budget_continuation         │      │
│  │                                          │      │
│  │  4. Terminal Check                       │      │
│  │     ├─ completed → return                │      │
│  │     ├─ awaiting_user_input → pause + checkpoint│
│  │     ├─ max_turns → checkpoint + return   │      │
│  │     └─ error → recovery or fail          │      │
│  │                                          │      │
│  │  5. Tool Dispatch                        │      │
│  │     ├─ permission check                  │      │
│  │     ├─ concurrent batch (independent)    │      │
│  │     └─ serial chain (dependent)          │      │
│  │                                          │      │
│  │  6. Steer Injection                      │      │
│  │     └─ mid-turn user messages            │      │
│  │                                          │      │
│  │  7. Next Turn → goto 1                   │      │
│  └─────────────────────────────────────────┘      │
└─────────────────────────────────────────────────┘
```

---

## 三、核心数据结构

### 3.1 StarQueryEngine（每个星官一个实例）

```typescript
interface StarQueryEngineConfig {
  starId: string                // 星官 ID: 'ziwei' | 'changgeng' | 'tianxuan' | ...
  starName: string              // 星官名称: '紫微' | '长庚' | '天璇' | ...

  // 独立的工具集——这是天枢与 LeAgent 的关键区别
  tools: string[]               // 该星官的白名单工具名列表

  // 独立的历史
  sessionMessages: Message[]    // 该星官的专属会话历史

  // 独立的记忆实例
  memory: AgentMemory           // 三区记忆，情景记忆按星官隔离

  // 共享的组件
  llm: LLMService
  toolExecutor: ToolExecutor
  toolRegistry: ToolRegistry
  promptBuilder: PromptBuilder

  // 上下文预算
  maxTurns: number
  maxToolCallsPerTurn: number
  autocompactTokenThreshold: number

  // 紫微路由回调（用于跨星官协作）
  onRouteRequest?: (req: RouteRequest) => Promise<RouteResponse>
}
```

### 3.2 AgentMemory（三区记忆，按星官隔离）

```typescript
class AgentMemory {
  // 情景记忆——按 starId 隔离
  episodic: EpisodicStore    // only this star's past turns
  // 语义记忆——跨星官共享
  semantic: SemanticStore    // shared facts across all stars
  // 程序记忆——按 starId 隔离
  procedural: ProceduralStore // only this star's tool success rates

  // 对外四个方法
  recordEpisode(turn): void
  upsertFact(fact): void
  recordProcedure(toolChain): void
  recall(query, options): RecallBundle  // 混合检索
}
```

### 3.3 紫微路由协议

```typescript
interface RouteRequest {
  sourceStarId: string        // 发起方（通常是 'ziwei'）
  targetStarId: string        // 目标星官
  taskDescription: string     // 任务描述
  contextSummary: string      // 上下文摘要（非全量历史！）
  attachmentMessages?: Message[]  // 本轮相关消息（非历史）
  routeStyle: 'delegate' | 'collaborate' | 'consult'
    // delegate:  全权委托，等最终结果
    // collaborate: 保持通信，多次来回
    // consult:    单次咨询，立刻返回
}

interface RouteResponse {
  sourceStarId: string
  output: string
  artifacts?: Artifact[]
  memoryDeltas?: MemoryDelta[]  // 回传的记忆更新
  needsFollowUp?: boolean       // 是否需要后续交互
}
```

---

## 四、Loop 详细流程

### 4.1 紫微路由阶段（在 QueryEngine 之前）

```
用户输入 → StarRouter
  │
  ├── 如果正在对话的星官 == 目标星官 → 直接走该星官的 Loop
  │
  ├── 如果用户明确点名 → 路由到指定星官
  │
  ├── 如果用户未指定 → 紫微（轻量模型）判断意图：
  │   ├── 日常杂活 → 路由到长庚
  │   ├── 编程开发 → 路由到天璇
  │   ├── 文档写作 → 路由到文曲
  │   └── 通用/不确定 → 紫微自己处理
  │
  └── 跨星官协作 → 拉起多个 QueryEngine，各自独立运行
       紫微在中间做消息转发和摘要汇总
```

### 4.2 单星官 Loop 阶段（每个星官独立运行）

```typescript
async function* queryLoop(params: QueryParams): AsyncGenerator<Event> {
  const state = new QueryState(params)

  while (true) {
    // ---- Phase 1: Pre-API Pipeline ----
    let messages = [...state.messages]
    // 1a) Microcompact: 清理无效 tool 消息（中间状态残留）
    messages = microcompact(messages)
    // 1b) Progressive compress: 渐进式压缩长文本消息
    if (approxTokens(messages) > threshold * 0.6) {
      messages = progressiveCompress(messages)
    }
    // 1c) Autocompact: 摘要式压缩历史
    if (approxTokens(messages) > threshold * 0.5) {
      messages = autocompact(messages, systemPrompt)
    }
    // 1d) 清理孤儿 tool 消息（防止 OpenAI/DeepSeek 400 错误）
    messages = dropOrphanToolMessages(messages)

    // ---- Phase 2: Stream Model Response ----
    const stream = callModel({ messages, systemPrompt, tools })
    let content = '', reasoning = '', toolCalls = [], error = null
    for await (const event of stream) {
      yield event          // 转发给前端做流式渲染
      if (event.delta) content += event.delta
      if (event.reasoning) reasoning += event.reasoning
      if (event.toolCall) coalesceToolCall(toolCalls, event.toolCall)
      if (event.error) { error = event.error; break }
    }

    // ---- Phase 3: Recovery Transitions ----
    if (error) {
      if (isPromptTooLong(error))   yield terminal(PROMPT_TOO_LONG)
      if (isModelError(error)) {
        if (isTransient) continue   // 重试
        else yield terminal(MODEL_ERROR)
      }
      if (isMaxOutputTokens(error) && retryCount < 2) {
        rebuildStateForRetry(state)  // 增加 max_output_tokens
        continue
      }
    }

    // ---- Phase 4: Terminal Check ----
    if (toolCalls.length === 0) {
      yield terminal(COMPLETED)
      return
    }
    if (hasAskUser(toolCalls)) {
      yield checkpoint(state)       // 持久化 Checkpoint
      yield terminal(AWAITING_USER_INPUT)
      return
    }
    if (state.turnCount >= maxTurns) {
      yield checkpoint(state)
      yield terminal(MAX_TURNS)
      return
    }

    // ---- Phase 5: Tool Dispatch ----
    const approved = await approvalGate(toolCalls)  // Plan/Ask/Bypass
    const results = await dispatchTools(approved)    // 并发执行独立工具
    for (const r of results) {
      yield r
      messages.push(r.toMessage())
    }

    // ---- Phase 6: Steer Injection ----
    for (const steer of drainSteerMessages()) {
      yield steer
      messages.push(steer)
    }

    // ---- Phase 7: Next Turn ----
    state = new QueryState({ messages, turnCount: state.turnCount + 1 })
    // → goto Phase 1
  }
}
```

---

## 五、Context 压缩策略（借鉴 LeAgent，适配天枢）

### 5.1 三层压缩

| 层级 | 时机 | 做什么 | 成本 |
|------|------|--------|------|
| Microcompact | 每轮开始 | 删除 orphan tool 消息、合并连续片段 | 零（纯逻辑） |
| Progressive | token > 阈值 60% | 压缩单个过长消息（按字符数从大到小处理） | 零（纯逻辑） |
| Autocompact | token > 阈值 50% | LLM 生成历史摘要，压缩整段历史 | 一次 LLM 调用 |

### 5.2 阈值自适应

```typescript
function getCompactParams(modelName: string): CompactParams {
  const ctxWindow = MODEL_CONTEXT_WINDOWS[modelName] ?? 128_000
  return {
    autocompactThreshold: Math.min(ctxWindow * 0.6, 80_000),
    autoCompactKeepRecent: modelName.includes('claude') ? 8 : 6,
    toolResultBudget: modelName.includes('deepseek') ? 16_000 : 12_000,
  }
}
```

---

## 六、Checkpoint 持久化

### 6.1 何时写 Checkpoint

| 触发点 | 原因 |
|--------|------|
| `awaiting_user_input` | 等待用户回复时可恢复 |
| `max_turns` | 算力上限中断后恢复 |
| `token_budget_exceeded` | 预算耗尽后恢复 |
| `aborted_streaming` | 用户取消后可续 |

### 6.2 Checkpoint 内容

```typescript
interface Checkpoint {
  id: string
  starId: string
  sessionId: string
  timestamp: number
  reason: string
  messages: Message[]    // 快照（不含已压缩的历史）
  state: {
    turnCount: number
    usage: UsageInfo
    autocompactState: AutoCompactState
  }
}
```

---

## 七、并发工具调度

```
工具集合
  ├── 独立工具 → 并发执行（Promise.all）
  │     read, grep, webfetch, glob
  │
  └── 有依赖 → 串行管道
        bash(compile) → read(check output)
```

```typescript
interface ToolBatch {
  parallel: ToolCall[]    // 可以同时执行
  chain: ToolCall[][]     // 需要按顺序的管道
}

function planBatches(tools: ToolCall[]): ToolBatch[] {
  // 1. 识别工具间依赖（输出是否被另一个工具引用）
  // 2. 分组：无依赖的一起跑，有依赖的排管道
  // 3. 每组内的独立工具并发执行
  // 4. 跨组的工具串行（下一组等上一组结果）
}
```

---

## 八、与 LeAgent Loop 的对比

| 特性 | LeAgent | 天枢 |
|------|---------|------|
| 隔离 | 一个 QueryEngine 共享所有工具 | **每星官独立 QueryEngine** |
| 工具暴露 | 100+ 工具全量塞给模型 | **每人 3-8 个领域工具** |
| 上下文传递 | 同进程共享消息数组 | **摘要传递，不传全量历史** |
| 路由 | 无路由层，一个 agent 处理所有 | **紫微路由层 + 专业星官** |
| 记忆隔离 | 单例 AgentMemory | **情景/程序按星官隔离，语义共享** |
| Loop 结构 | 函数式 _query_loop | **同结构 + 路由层 + 隔离层** |
| 恢复 | 6 种 TerminalReason | **同 6 种 + 跨星官恢复** |
| Checkpoint | 每轮边界 | **同 + 路由切换时** |
