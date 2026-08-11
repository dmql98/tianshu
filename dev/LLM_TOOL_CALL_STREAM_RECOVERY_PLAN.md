# 天枢 LLM 工具调用流中断与会话恢复优化计划

> 目标读者：直接接手开发的 OpenCode / Codex。
>
> 研究基线：天枢 `C:\Users\dmql\Documents\tianshu\dev`，OpenCode 参考仓库 `C:\Users\dmql\Documents\Yi\reference\opencode-dev`。
>
> 事故样本：`C:\.Tianshu-b\debug\msocwg0bciq5x4\merged_1.json`。

## 1. 目标

解决以下问题，并保证已有异常会话能够恢复：

1. LLM 流式响应在工具参数中途断开时，天枢不得把半截 `function.arguments` 当成正常工具调用。
2. 非法工具参数不得进入可重放的会话历史，不得让后续请求持续收到 HTTP 400。
3. 短暂网络故障可以安全重试；重试不得拼接上一尝试的半截文本、reasoning 或工具参数。
4. 模型完成了响应、但给出的工具参数不是合法 JSON 时，应返回可理解的工具错误，让模型有机会自纠，而不是污染历史或把 `{}` 交给真实工具执行。
5. 旧会话中已经存在的非法工具调用，在发送给 provider 前应被修复或隔离。
6. 对 `write` 工具补齐输入校验、目录创建、写入验证和可观测性，但不把 write 改造误当成本事故的根因修复。

## 2. 本次事故结论

会话 `msocwg0bciq5x4` 的第 14 次 LLM 响应生成了 `write(run.bat)`，工具参数累计到 2162 个字符时中断，末尾停在：

```text
REM ---------------- 启动后端 ----------------
:
```

该字符串缺少 JSON 字符串结束引号和对象结束括号，`JSON.parse` 报：

```text
Unterminated string in JSON at position 2162
```

随后发生以下链式故障：

1. `web/server/src/llm/client.ts` 在底层 reader EOF 后仍发送 `done`，即使没有收到 `[DONE]`、没有 `finish_reason`、没有 usage。
2. `web/server/src/agent/inner.ts` 将工具参数分片直接拼接，流结束后只检查工具名，不校验 arguments。
3. assistant 消息在参数解析和工具执行之前就写入数据库。
4. 工具执行阶段的 `JSON.parse` 失败被静默替换成 `{}`。
5. 后续请求重放该 assistant tool call，上游拒绝整个请求：`Assistant tool call function.arguments must be valid JSON`。
6. HTTP 400 被正确视为不可重试，但会话历史没有修复，所以用户重试仍然失败。

这一次 `write` 调用没有形成完整、可信的执行输入。问题发生在工具执行之前；更换文件写入 API 无法单独解决它。

## 3. OpenCode 的处理方式

### 3.1 默认 AI SDK 链路

OpenCode 默认通过 `streamText(...).fullStream` 消费模型输出：

- `packages/opencode/src/session/llm.ts:280` 创建 AI SDK 流。
- `packages/opencode/src/session/llm.ts:296` 配置 `experimental_repairToolCall`。
- 无效工具名大小写会先尝试规范化。
- 参数解析或 schema 校验失败时，原调用会被改写为内部 `invalid` 工具调用，其 input 是重新 `JSON.stringify` 生成的合法 JSON。
- `packages/opencode/src/tool/invalid.ts` 执行该内部工具，把错误作为 tool result 返回给模型，模型可以重写参数继续执行。
- `packages/opencode/src/tool/tool.ts:111` 在真正执行工具前，通过 Effect Schema 解码并校验参数。校验失败成为明确的 `InvalidArgumentsError`，不会把空对象交给工具。

因此，OpenCode 的默认链路不会把 provider 给出的原始、非法 JSON 字符串直接存成下一轮请求里的 `function.arguments`。

### 3.2 流错误与中断工具清理

OpenCode 将 AI SDK 的 `error` 流事件提升为失败，而不是正常完成：

- `packages/opencode/src/session/llm/ai-sdk.ts:264` 对 `error` 返回 Effect failure。
- `packages/opencode/src/session/processor.ts:537` 的 cleanup 会把尚未完成的工具调用标记为 `error` 和 `interrupted: true`。
- `packages/opencode/src/session/message-v2.ts:349` 在历史重放时，为 pending/running 工具补一个 `[Tool execution was interrupted]` 错误结果，避免出现只有 tool call、没有 tool result 的悬空协议状态。
- prompt loop 会识别 cleanup 标记的 orphan tool，不会把它误判成一个仍需执行的有效调用。

### 3.3 OpenCode 实验性原生 LLM 链路

原生 OpenAI Chat 解析器把工具参数保存在专门的 pending state 中：

- `packages/llm/src/protocols/utils/tool-stream.ts` 负责工具参数累计。
- 只有 terminal `finish_reason` 到达时才 finalize 工具调用。
- `packages/llm/src/protocols/openai-chat.ts:443` 明确在 finish boundary 解析 JSON。
- `packages/llm/src/protocols/shared.ts:155` 统一执行 JSON 解析；非法 JSON 使流失败，不会产生公开的 `tool-call` 事件。

该原生链路目前是实验功能，天枢可以借鉴其边界设计，但不能把它当成 OpenCode 默认线上路径。

### 3.4 OpenCode write 工具与天枢的差异

OpenCode legacy write：`packages/opencode/src/tool/write.ts`。

- 参数由 Effect Schema 强类型校验：`content`、`filePath` 必须为字符串。
- 支持相对路径解析，也允许经过单独授权的外部绝对路径。
- 写入前生成 diff，并将 diff 放入 edit 权限确认信息。
- `writeWithDirs` 自动创建父目录。
- 保留原文件 UTF-8 BOM；formatter 运行后再次同步 BOM。
- 写入后发布文件编辑与 watcher 事件。
- 触发 LSP，并把当前文件及有限数量的项目诊断返回给模型。

OpenCode V2 write：`packages/core/src/tool/write.ts`。

- 输入与输出都有 schema，输出是结构化的 `operation/target/resource/existed`。
- 路径解析、外部目录授权、edit 授权、文件变更分别由独立服务负责。
- 文件写入错误统一转换成 `ToolFailure`，作为工具错误事件返回，而不是击穿整个 LLM 流。

天枢当前 write：`web/server/src/tools/write/index.ts`。

- 已有 Zod 输入校验、工作区路径保护、BOM 保留和写后回读。
- 使用 `writeFileSync`，父目录不存在时不会自动创建。
- 没有 diff、formatter、watcher、LSP 诊断集成。
- 当前所谓“并发冲突检测”只是写前 hash 和写后 hash 比较，无法真实检测 read 与 write 之间的并发修改；当新内容恰好等于旧内容时还可能误报冲突。
- 这些差异会影响 write 的易用性和可靠性，但不会造成此次非法 JSON 历史污染。

## 4. 建议架构

把一次 provider turn 明确分成四层，任何一层失败都不能把未规范化数据提交为 durable assistant message：

```text
Provider SSE
  -> Stream framing（必须确认正常结束）
  -> Tool-call assembly（只累计 attempt-local 原始片段）
  -> Canonicalization（JSON + schema + call 配对校验）
  -> Commit（持久化 canonical assistant/tool parts）
  -> Execute（只接收已解码参数）
```

核心不变量：

1. durable history 中所有 assistant `tool_calls[].function.arguments` 必须可被 `JSON.parse`。
2. 真实工具执行入口不得接收“解析失败后降级的 `{}`”。
3. 一个 provider attempt 未确认正常结束时，其累计状态不得成为下一 attempt 的初始状态。
4. 每个持久化的 tool call 最终都必须有对应 tool result，成功、失败或 interrupted 均可。
5. 向 provider 发送历史前再做一次防御性校验，防止旧数据或其他写入路径绕过约束。

## 5. 分阶段实施

### P0：复现与回归夹具

涉及文件：

- 新增 `web/server/src/llm/client-stream.test.ts`
- 扩展 `web/server/src/agent/inner-retry.test.ts`
- 新增或扩展 session/history serialization 测试

任务：

1. 从事故日志提取一个最小 SSE 夹具：正常 tool-call 开头 + 截断的 `write.content` + socket EOF，无 `[DONE]`。
2. 增加以下测试：
   - 正常文本流 + `[DONE]`。
   - 正常工具流 + `finish_reason: tool_calls` + `[DONE]`。
   - 工具 JSON 中途 EOF。
   - 文本中途 EOF。
   - 收到 finish reason 但工具 JSON 非法。
   - 第一次 attempt 部分输出后断开，第二次成功；最终结果不得包含第一次残片或重复文本。
   - 多工具并行时只有一个工具参数损坏。
3. 将 `msocwg0bciq5x4` 对应失败模式作为命名回归用例写入测试说明。

验收：现有代码下至少有一个测试稳定复现“EOF 被当成成功”及“坏 arguments 被返回”。

### P1：严格的流完成协议

主要文件：`web/server/src/llm/client.ts`。

任务：

1. 为一次流增加状态：
   - `sawDoneMarker`
   - `sawFinishReason`
   - `finishReason`
   - `pendingBuffer`
2. EOF 时执行协议检查：
   - 已收到 `[DONE]`：正常完成。
   - 某些兼容 provider 没有 `[DONE]`，但收到了明确 terminal finish reason：允许通过兼容策略完成，并记录 warning/metric。
   - 两者都没有：产生结构化 `IncompleteLLMStreamError`，不得 yield 正常 `done`。
3. reader EOF 前调用 `decoder.decode()` flush，并处理 buffer 中最后一个完整 SSE event；不能静默丢弃末尾数据。
4. 当前 `catch { /* skip malformed SSE lines */ }` 改为可观测的解析错误。对于 `data:` JSON 解析失败，应按协议错误终止；不要继续跳过可能承载 tool delta 的事件。
5. `done` chunk 增加明确的 completion 状态；调用方不应靠 usage 是否存在推断完成。
6. 记录 provider、model、finish reason、是否收到 `[DONE]`、累计字节数、pending tool 数量，不记录完整敏感内容。

兼容性注意：先用配置或 provider capability 支持“finish reason 即完成”的兼容模式，避免部分 OpenAI-compatible 服务没有 `[DONE]` 时被全部判错。

### P1：attempt 隔离与安全重试

主要文件：

- `web/server/src/agent/inner.ts`
- `web/server/src/llm/errors.ts`

任务：

1. 将 `fullText`、`reasoningText`、`toolCallsAcc`、usage 改为 attempt-local 状态。
2. 只有 attempt 完整成功后，才一次性提交为最终 result。
3. 失败重试时彻底丢弃该 attempt 的累计状态。当前实现会在重试时复用外层累计变量，存在重复文本和拼接坏 JSON 的风险。
4. 将 `IncompleteLLMStreamError` 标记为 transient，可按现有指数退避最多重试 3 次。
5. 若 UI 已展示部分流内容，增加 `llm.retry`/`message.stream.reset` 事件，让前端撤销失败 attempt 的临时展示；数据库仍不得保存临时片段。
6. abort 与 retry 分开：用户主动取消不自动重试。
7. 保证工具只在完整 completion 之后执行，因此重试 provider turn 不会重复文件副作用。

验收：第一次流在 `write` 参数中途断开、第二次正常时，工具只执行一次，arguments 只来自第二次响应。

### P1：工具调用规范化与内部 invalid 工具

主要文件：

- `web/server/src/agent/inner.ts`
- 建议新增 `web/server/src/agent/tool-call-normalizer.ts`
- `web/server/src/tools/definitions.ts` 或独立 internal tool 定义

任务：

1. 增加唯一的 `normalizeToolCalls()` 边界，输入为累计 raw calls，输出为 canonical calls 或明确错误。
2. 对每个调用验证：
   - id 非空且本轮唯一。
   - function name 非空。
   - arguments 是合法 JSON object；数组、字符串、null 不接受。
   - 工具存在；如有 JSON Schema/Zod，可在副作用前完成 schema 校验。
3. 删除全部 `catch { args = {} }`。解析失败不能继续真实工具执行。
4. 借鉴 OpenCode 增加内部 `invalid_tool_call`：
   - 不暴露给模型主动选择，或从 active tools 中排除。
   - 将原工具名、错误类型和经过长度限制的参数片段重新 `JSON.stringify` 成合法 arguments。
   - 执行结果固定为 tool error，提示模型重写调用。
   - 不触发权限询问和任何文件副作用。
5. 对“流确认完整但模型产生非法 JSON”使用 invalid 工具自纠；对“流没有完整结束”直接重试，二者不可混为一类。
6. 多工具场景采用隔离策略：合法调用是否执行需做明确选择。建议第一版整轮拒绝并让模型重发，避免部分副作用完成后再重试造成语义不一致。

验收：任何传入 `messageStore` 或下一轮 `messages` 的 tool arguments 都能通过 `JSON.parse`。

### P1：持久化顺序与历史防毒

主要文件：

- `web/server/src/agent/inner.ts`
- `web/server/src/db/messageStore.ts`
- 构造 provider messages 的 context/history 模块

任务：

1. 调整顺序：流完整 -> canonicalize -> 再保存 assistant message。
2. 为 message store 增加写入前断言。非法 tool input 直接拒绝写入，并记录结构化错误。
3. assistant tool call 与对应 tool result 使用事务或同一 turn 状态管理，避免进程退出留下悬空调用。
4. 中断清理借鉴 OpenCode：pending/running 调用统一落成 `interrupted` tool result。
5. provider request 构造前增加 history sanitizer：
   - 合法历史原样通过。
   - 已有非法 arguments 转换为合法的 synthetic invalid call + 配对 error result，或隔离整条 assistant/tool 片段。
   - 记录修复数量和 message id，不能静默修改而无日志。
6. 提供一次性会话修复函数或管理 API，使 `msocwg0bciq5x4` 这类历史可以继续使用，而不是要求用户永久新建会话。
7. 保存原始错误片段时放入 debug/diagnostic 字段，不再放入 provider-facing `function.arguments`。

验收：加载含本次事故坏消息的数据库夹具后，新请求能够发送；provider request 中不存在非法 JSON。

### P2：错误分类、可观测性与用户提示

任务：

1. 错误类型至少区分：transport error、incomplete stream、malformed SSE、invalid tool JSON、tool schema mismatch、provider HTTP 4xx/5xx。
2. debug 记录补充：attempt、completion marker、finish reason、tool call id/name、arguments 长度、JSON error offset；参数内容只保留安全截断预览。
3. UI 提示区分：
   - “模型响应中断，正在重试（2/3）”。
   - “模型生成了无效工具参数，已要求模型重写”。
   - “该会话包含旧版异常记录，已自动修复/无法自动修复”。
4. 指标建议：`llm_stream_incomplete_total`、`tool_call_invalid_json_total`、`history_sanitized_total`、按 provider/model 分组的 retry success rate。
5. HTTP 400 如果 message 指向 tool arguments invalid，应触发一次本地 history audit；仅在 audit 确实修复数据后重发一次，禁止盲目重试所有 400。

### P2：write 工具可靠性增强

主要文件：`web/server/src/tools/write/index.ts` 及对应测试。

任务：

1. 保留现有 `path/content` 接口，避免已有 prompt、角色绑定和日志兼容性变化。
2. 用异步文件 API，并自动创建父目录。
3. 写入采用同目录临时文件 + rename 的原子替换策略；确认 Windows rename/覆盖行为并覆盖测试。
4. 若需要并发保护，使用真实的 optimistic concurrency：read 返回 revision/hash，write 可选接收 `expected_hash`，写前重新计算并比较。删除当前无效的“写后 hash 等于旧 hash即冲突”逻辑。
5. 新内容与旧内容完全相同时返回 no-op success，不得报冲突。
6. 保留 BOM；增加 LF/CRLF 不被意外改写的测试。
7. 权限确认信息增加差异摘要；完整 diff 需设大小上限。
8. 写后返回结构化 metadata：path、bytes、created/updated/noop、hash。
9. formatter、watcher、LSP 可作为后续独立能力，不与本次 P1 会话修复绑定发布。

## 6. 推荐代码接口

以下仅表示职责，不要求逐字采用：

```ts
type StreamCompletion = {
  finishReason?: string
  sawDoneMarker: boolean
  compatibleTerminal: boolean
}

type CompletedLLMAttempt = {
  text: string
  reasoning: string
  toolCalls: CanonicalToolCall[]
  usage: Usage | null
  completion: StreamCompletion
}

class IncompleteLLMStreamError extends Error {
  readonly transient = true
}

function normalizeToolCalls(raw: ToolCall[]):
  | { ok: true; calls: CanonicalToolCall[] }
  | { ok: false; kind: 'invalid_json' | 'invalid_shape' | 'missing_identity'; calls: CanonicalToolCall[] }
```

实现时应让类型区分 raw 与 canonical，避免同一个 `ToolCall` 类型既表示半截流数据又表示可持久化消息。

## 7. 测试矩阵

| 场景 | 预期 |
|---|---|
| 正常 `[DONE]` + stop | 正常完成 |
| terminal finish reason，无 `[DONE]`，兼容模式开启 | 完成并记录兼容 warning |
| EOF，无 finish reason | incomplete stream，重试 |
| tool arguments 中途 EOF | 不持久化、不执行，重试 |
| 完整响应但 arguments 非法 JSON | synthetic invalid tool result，模型可自纠 |
| arguments 是合法 JSON 数组/null | schema/shape 错误，不执行真实工具 |
| transient attempt 已输出部分文本 | 重试结果不包含旧残片 |
| transient attempt 已产生半个 tool call | 第二次调用不与第一次拼接 |
| 用户 abort | 不重试，pending tool 被标记 interrupted |
| 旧历史含非法 arguments | sanitizer 修复后请求可发送 |
| 旧历史 tool call 无 tool result | 自动补 interrupted/error result |
| 多工具其中一个损坏 | 整轮不产生部分副作用 |
| write 父目录不存在 | 自动创建并成功写入 |
| write 内容与旧内容一致 | no-op success |
| write expected_hash 不匹配 | 写入前冲突，不覆盖文件 |
| write 保留 BOM/CRLF | 文件字节符合预期 |

## 8. 发布与回滚

1. P0/P1 合并为一个版本发布，不能只上 history sanitizer 而继续产生新坏数据，也不能只拦新数据而让旧会话继续 400。
2. 首版可用 feature flag：`strict_llm_stream_completion`、`sanitize_tool_call_history`。
3. 先在 debug 模式记录一段时间，再默认开启严格模式。
4. history sanitizer 必须幂等；重复运行不能不断新增 synthetic tool result。
5. 回滚代码时不要回滚已经修复的会话数据；canonical synthetic error 消息本身应兼容旧版本。
6. 发布后用事故会话副本进行 smoke test，禁止直接破坏用户原始 debug 文件。

## 9. 完成标准

以下条件全部满足才算完成：

- 本事故 SSE 夹具稳定通过。
- 流中断时数据库中不存在半截 tool arguments。
- 所有 provider-facing tool arguments 在发送前都经过 JSON 与 shape 校验。
- 重试不会重复/拼接前一次 attempt 内容。
- 工具参数解析失败不会执行真实工具，也不会降级成 `{}`。
- 旧异常会话可以自动恢复，或得到明确、可操作的隔离提示。
- `write` 同内容写入不再误报冲突，父目录写入有测试。
- `npm test` 与 `npm run build` 在 `web/server` 通过。
- debug 日志能明确区分“provider 中断”和“模型产生非法参数”。

## 10. 建议实施顺序

严格按以下顺序开发，避免边改边扩大数据污染：

1. P0 事故夹具。
2. P1 流完成协议。
3. P1 attempt 隔离重试。
4. P1 canonical tool-call + invalid tool。
5. P1 持久化顺序 + history sanitizer。
6. 全量回归与事故会话副本验证。
7. P2 可观测性。
8. P2 write 独立增强。

