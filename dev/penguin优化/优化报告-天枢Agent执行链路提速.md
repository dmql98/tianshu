# 天枢 Agent 执行链路提速优化报告

> 基准参照：PenguinHarness（`Prism-Shadow/penguin-harness`）
> 对比对象：天枢 TianShu（`web/server/src/`）
> 报告日期：2026-08-29

---

## 0. 一句话结论

天枢**不是"单次请求更慢"，而是每轮都在做更多、更贵的活**：每次 Run **全量重建并重发整段上下文**（实测每轮输出本身已是 append-only、前缀可命中，真正的浪费在跨 Run 重建 + 小窗口 snip/compact 的前缀失效）、下发 21 个工具 schema、且主循环叠加多轮**额外模型往返**（3 次重试、计划/目标独占轮、控制动作独占、压缩即摘要调用、子代理唤醒整 Run 重跑）。提速的核心是**让每个回合发更少的 token、跑更少的回合**，而不是优化单次延迟。

| 维度 | 天枢现状 | Penguin 参照 |
|---|---|---|
| 每轮 LLM 调用 | 1 次主调用 + 额外往返（重试/压缩/独占/唤醒） | 每轮 1 次，纯 ReAct |
| 上下文 | 每轮输出已 append-only、前缀可命中；浪费在跨 Run 重建（拉历史到 10 万条）+ 小窗口 snip/compact 失效 | 每轮只发"新增消息"，历史由服务端状态化持有 |
| 工具 schema | 21 个（12 常规 + 8 控制 + delegate），description 已精简（P0-2 已落地，实测 ~3645→2551 tok） | 8–9 个，字段极简 |
| 计划/目标 | 有（create_plan / update_plan_step / submit_result…） | 无 |
| 压缩 | 已预算化（0.85 阈值 + 回合后 maxAttempts=1 + 结束轮跳过）——摘要调用收窄到长会话/溢出安全阀 | 阈值门控，正常循环不摊成本 |
| 前缀缓存 | 设计目标命中，但被全量重发冲淡 | 前缀字节一致，稳定命中 |

---

## 1. 根因：慢在哪里（按开销排序）

### 根因 A — 跨 Run 重建上下文（实测非"每轮全量重发"）
> **实测修正（2026-08-29）**：正常路径（direct）里，`runLoopEngine` 主循环每轮只是 `composeMessages` 后传 `innerLoop`，输出为**纯 append-only**（A 场景 6/6 轮，可复用前缀 33%→85%+），provider 前缀缓存可命中——**并不存在"每轮全量重发"**。真正的浪费与失效点在以下两处：
- **跨 Run 重建**：`outer.ts:216-221` 在**每次 Run 开始**（而非每轮）调 `buildInitialMessages({ rows: messageStore.getMessagesAfter(sessionId, compactionUntilId, 100000) })`，把**最多 10 万条消息全量**拉回来；`context-builder.ts:332-340` 逐条 `rowToLLMMessage` 且每条再 `expandContextReferences`（文件 `readFileSync`、URL `fetch` 反复执行，URL 内容变化还导致跨 Run 前缀漂移）。→ 已加 memo 缓存（见 P0-1 已落地项）。
- **小窗口/长会话的 snip/compact**：`trimToolResults` / `compactWithRetries` 会改写较靠前的历史（B 场景可复用前缀最低 0%），属内存管理必然，非每轮 bug。→ **已由 P1-1 预算化控制（已落地）**：阈值 0.85 + 回合后 maxAttempts=1 + 结束轮跳过，见 §P1-1。
- 静态前缀：`context-builder.ts:47 assembleStaticPrompt` 组装角色 soul + 用户信息 + 整份 `prompt.md` 模板 + 技能索引 + memory + `[Compacted History]`；其字节已被 `system-cache.ts` 的 `getCached/setCached` 缓存，非每轮重拼。
- 对 DeepSeek 类 reasoner，`compose.ts` 会把历史里的 `reasoning_content` 一并重发 → 上下文体积进一步放大（C 场景实测逐轮重发但字节稳定，不构成前缀问题）。

**代价**：每次 Run 都会重建整段历史（首 token 前上传整段）；小窗口下 snip/compact 使前缀缓存频繁失效。

### 根因 B — 工具 schema 大且每轮重复下发（稳定大钱包）
> **已落地（2026-08-29，P0-2）**：见 §P0-2。21 个工具的 description 已批量精简（`p02-apply-slim.py` 应用），实测 schema 总字符 11244→8199、估 token 3645→2551（省约 30%）；但工具**仍随每次请求经 API `tools` 参数全量下发**（工具不走 system 文本，无法靠 system-cache 命中规避）——模式差异改由 `loop-engine.ts` 的 alert 提示表达（direct 自判 / plan_first 必做 plan、goal 可选 / goal 双必做），不再按模式裁剪工具集。
- 12 个常规工具（`tools/definitions.ts:16-19 DEFAULT_TOOL_NAMES`），描述已精简（`edit` 原约 450 字符 → 一句）。
- `outer.ts:175 getControlToolDefinitions()` 叠加 8 个控制动作 + `delegate_to_agent`（`control-registry.ts:21,123`），description 已精简、`EXCLUSIVITY_NOTE` 同步压缩。
- **合计 21 个 function schema，约 8.2KB / ~2551 token（精简后），随每次请求经 API `tools` 参数重复下发**。

**代价**：每轮仍约 2.5K token 的固定开销；已按产品设计（direct 需保留 plan/goal 自判能力）放弃"按模式裁剪工具"方案，模式规则走 alert 提示（token 成本极低、随状态变化才注入）。

### 根因 C — 主循环叠加额外模型往返（回合数膨胀）
- `inner.ts:180` `for (attempt=0; attempt<2; attempt++)`（P0-3 项 1 已落地 3→2）—— 失败时**整段重发** `messages+tools`，瞬时错误一次最多 2 个调用。
- `loop-engine.ts:375` 请求返回 error 后 run 级再 `continue` 一整轮（P0-3 项 2 已落地：非溢出错误不再补整轮，立即 `run.failed`）。
- `inner.ts:742` 多个控制动作互斥 / 控制动作 + delegate_to_agent 并行时**整批拒绝**，让模型"下一轮再发"（白白多一轮）。P0-3 项 3 已解独占：「控制动作 + 普通工具」同轮不再拒绝（`inner.ts:786-796`，普通工具先执行、结果并入本轮）。
- `inner.ts:797-830` 同轮含 `delegate_to_agent` 时，其余普通工具被推迟到下一轮（多一轮；P5 同步 barrier 保留）。
- `loop-engine.ts:597-616` `final_answer` 时计划未完成会 push alert 并 `continue` —— 本可结束的回合被迫再跑一轮。
- `control-router.ts:360-391` `ask_user` 会落 checkpoint 终止本 Run，用户回答再**另起一个全新 Run**（重复构建上下文 + 从头跑）。

**代价**：短任务的实际回合数被放大 1.5–3 倍，每次都是完整上下文请求。

### 根因 D — 压缩本身就是一次 LLM 摘要调用（短任务的净负担）
> **已落地（2026-08-29，P1-1）**：见 §P1-1。落地后：主动压缩阈值 `COMPACT_THRESHOLD` 0.75→0.85、回合后压缩 `maxAttempts=1`、结束轮（final_answer 放行/aborted/收敛 break/submit_result-done/ask_user）不再触发回合后压缩——**短任务不再白付摘要**；摘要调用仍存在但被收窄为"长会话/溢出安全阀"路径。
- `loop-policy.ts:18` `COMPACT_THRESHOLD=0.85`（原 0.75）；`MAX_COMPACT_ATTEMPTS=2`（安全阀路径，保留原语义）。
- `context-compactor.ts:329` `SummarizeOptions.maxAttempts`：回合后管理性压缩传 1，安全阀（预请求/溢出/冷恢复）保持默认。
- `compactWithRetries`（`context-compactor.ts:509-536`）每次调 `llmSummarize`，且把 `system + head` 前缀整段重放给摘要模型（只限 `max_tokens=2048`）。
- 触发点 4 处：预请求（`loop-engine.ts:283`）、回合后（`loop-engine.ts:647`，已移至循环尾，结束轮跳过）、上下文溢出（`loop-engine.ts:344`）、冷恢复（`outer.ts:234-247`）。

**代价**：对短任务常是"一次摘要+很大输入"的净开销，未见收益。

### 根因 E — 子代理膨胀
- 一次 `delegate_to_agent` = 父 1 轮 + 每个子会话最多 `maxSteps || 50` 轮（`sub-agent.ts:157`）+ 结束后 `wakeParentSession` 拉起**整个父 Run** 做总结（`control-router.ts:47`）。
- 子代理彼此可并行（`MAX_INSTANCES=5`），但父会话 run 级严格串行（`run-coordinator.ts:33-42` 单活跃 Run + FIFO）。

### 根因 F — 每轮 CPU 开销（次要但高频）
- 每轮多次 `estimateTokens`（`loop-policy.ts:126`）、`capturePrefixShape/compareShapes`（`system-cache.ts:178-232`）、`stableArgsHash`（sha256）。纯 CPU、频率高，虽然不阻塞 IO 但累计可观。

---

## 2. 优化建议（按优先级）

> P0 = 收益最大、改动聚焦；P1 = 收益显著、需少量设计；P2 = 锦上添花。

### P0-1 改"全量重发"为"增量 + 服务端状态化上下文" —— 【已测量（2026-08-29）→ 结论修正，建议改走 P0-3 / P1-1】

> **测量结论**（脚本 `web/server/scripts/p01-cache-shape-measure.ts`：复用真实 `composeMessages`/`capturePrefixShape`/`compareShapes`/`shouldSnipTokens`/`shouldCompactTokens`/`trimToolResults`，按 `runLoopEngine` 的真实推进方式驱动 6 轮）：
> - **正常路径（direct）每轮输出已是纯 append-only**（A 场景 6/6 轮；可复用前缀比例随历史增长 33%→85%+，平均 ~68%）。即**每轮并没有"全量重发"**，provider 前缀缓存能稳定命中。原"每轮全量重发、无复用收益"的核心主张**不成立**。
> - **"服务端状态化上下文"在当前栈上不可行**：DeepSeek 类 provider 走无状态 `/chat/completions`；`/responses` 仅在 LM Studio/llama.cpp 被自动探测启用，且代码并未用其 `previous_response_id`，仍经 `toResponsesInput` 全量重建（`llm/client.ts:442`、`client.ts:405-440`）。
> - 真实会改写前缀的只有两处：① **snip/compact**（内存管理，`loop-policy.ts:186-230` `trimToolResults` / `compactWithRetries`；小窗口 + 大结果时会剪枝/用 `[Compacted History]` 替换旧历史 → 前缀失效，B 场景可复用前缀最低 0%，属预期、非每轮 bug）；② **plan-first/goal 的 `[Policy]` alert 尾部块**（瞬态；实测对复用率无实质影响——A2 的 break 轮复用率与同轮次 A 一致，均 60%）。

**结论**：不冒重写主链路之险做状态化上下文。收益与确定性更好的方向是：
- **等价小改（已安全落地）**：
  1. 跨 Run 重建瘦身——`buildInitialMessages`（`context-builder.ts:316-343`）在**每次 Run** 都对每条含 `@file/@folder/@url` 的 user 消息重复 `expandContextReferences`（文件反复 `readFileSync`、URL 反复 `fetch`，且 URL 内容变化会导致跨 Run 前缀漂移）。已加 `(resolvedPath, mtimeMs, size)` memo 缓存（文件）+ 60s TTL 缓存（URL），未变化不再重读/重抓（`context-references.ts`）；缓存有界、文件改动经 mtime/size 校验自动失效。
  2. 修复 `@file/@folder/@url` 引用解析——`REFERENCE_PATTERN` 缺失命名捕获组 `(?<kind>...)`/`(?<value>...)`，导致 `match.groups?.kind` 恒为 `undefined`、引用从来不被展开（实测产生 `"@undefined: could not be resolved"` 警告）。已补上命名捕获组，引用恢复正常展开。
- **把精力放到 **P0-3**（减少 alert/计划驱动的额外轮往返）与 **P1-1**（压缩收益判定/预算化）**——后者是唯一真实的前缀失效源，收益可量化。

### P0-2 工具 schema 瘦身 / 按需下发 —— 【已落地（2026-08-29）】

> **实施记录**：按用户确认的产品语义落地——**三种模式的差异由 alert 提示表达，不裁剪工具集**（direct 需保留 plan/goal 工具让模型自判"做不做"，裁剪会使能力被关闭）。`tsc --noEmit` 零错误、`control-registry.test.ts` ALL PASSED。
> - **✅ 项 1（模式语义；按设计落地为 alert 提示，不拆分工具 schema）**：设计确认——**direct = plan/goal 均可选（模型自判）**；**plan_first = plan 必做、goal 可选**；**goal = plan+goal 都必做**。实现于 `loop-engine.ts`（`loop-engine.ts:215-267`）：
>   - direct：无计划时不再强推 create_plan；有可选计划时 planRule 注明"这是可选计划，可继续推进或直接完成"；首轮注入 `directModeAlert`「当前为直接对话模式：是否创建计划/目标由你自行判断」（`loop-engine.ts:153,244-246`，仿 lastPlanAlert「变化才注入」，稳态不重复、尾部上下文字节稳定）。
>   - plan_first：无计划时注入 noPlanAlert 强制「先调用 create_plan」（`loop-engine.ts:220-226`）；goal alert 仅在 `executionMode === 'goal'` 注入 → plan_first 不强制 goal（goal 工具仍可见、可选）。
>   - goal：plan 必做（同上 noPlanAlert）+ goal alert 必注入（`loop-engine.ts:248-267`：有进行中目标时注入目标全文，无目标时软提示经 create_plan 的 goal/verification 字段声明）。
>   - `outer.ts:175` 保持全量下发 9 个控制工具（`getControlToolDefinitions()` 无模式参数）——按测量（`p02-out.txt`），"按模式裁剪工具"理论可再省 ~27%（direct 最小集 21→16 工具、3645→2668 tok），但与"direct 模型自判 plan/goal"的产品语义冲突，**放弃裁剪、改用 alert 提示**（提示 token 成本极低且变化才注入）。
> - **✅ 项 2（精简 description）**：`p02-apply-slim.py` 批量应用——`control-registry.ts` 全部 9 个控制工具 description 精简（删冗余参数描述、合并长句，`EXCLUSIVITY_NOTE` 同步压缩为 C 档版本，保留 `control-registry.test.ts` 断言子串）；`tools/edit/index.ts`（450 字符 → 一句）、`tools/webfetch/index.ts`、`tools/skill_manager/index.ts` 同步精简。测量（`p02-toolsize-measure.ts` → `p02-out.txt`）：精简前 21 工具 schema chars 11244 / ≈3645 tok；精简后（`p02-slim-eval.ts` → `p02-slim-out.txt` 基线）chars 8199 / ≈2551 tok，**省约 30%**。进一步压缩无收益（A 保守 -14% 反而更差、B 激进 -1%、C 激进+压缩注记 -1%），说明描述已到极简。
> - **✅ 项 3（懒注册保持）**：MCP 工具本就在 `outer.ts:130-160` 按配置动态注入（含失败重试/状态上报），保持；技能/角色工具按需注入**不做**（常规工具 12 个已在白名单内，收益低、风险高，不推进）。

**改动**（原建议，保留供对照）：
1. **拆分**：控制工具（`create_plan`/`update_plan_step`/`submit_result`/`create_goal`/`get_goal`/`complete_goal`/`ask_user`）从默认集合移除，仅在 `executionMode === 'plan_first'|'goal'` 或明确启用**计划/目标**时才注入 `tools`（`outer.ts:175` 处按模式条件化）。→ **放弃**：与 direct 模式"模型自判是否做 plan/goal"语义冲突（工具不可见则能力被关闭），改为 alert 提示。
2. **精简 description**：给 `edit`、`webfetch`、`skill_manager`、`delegate_to_agent`、`send_message_to_subagent` 等长描述压到一两句（参考 Penguin `default-config.ts` 的极简风格）。→ 已落地（上述项 2）。
3. **懒注册**：MCP 工具已在 `outer.ts:131-140` 动态注入，保持；但可对未用技能/角色工具按需注入。→ MCP 保持；技能/角色按需注入不推进。

**预期（已由测量部分兑现）**：原预期"每轮 tools 从 ~1700 token 降到 ~500-800 token"已修正——**实际收益为 description 精简省 ~30%（3645→2551 tok）**；"按模式裁剪减半"因产品语义放弃。若后续要压固定开销，方向是精简参数 schema（B 档删参数描述）或控制工具合并（如 get_goal 并入 create_goal 响应）。

### P0-3 减少每轮额外模型往返 —— 【项 1、2、3 已落地；项 4 保留（产品设计）；项 5 已测量（不值得做，2026-08-29）】

> **进度标注（2026-08-29，tsc --noEmit 通过；`inner-control-mix` / `inner-retry` / `control-registry` / `loop` / `context-builder` / `tool-result-pruner` 全部通过）**：
> - **✅ 项 1（已落地）**：`streamWithRetry` 重试次数 3→2（`inner.ts`）。"仅对可重试错误重试"原本就用 `isTransientLLMError` 判定（网络/5xx/429/timeout），4xx 已直接失败；本次把上限从 3 次收到 2 次。已同步更新 `inner-retry.test.ts` 的 `max_attempts` 断言。
> - **✅ 项 2（已落地）**：`loop-engine.ts` 非溢出 `result.type === 'error'` 不再"补整轮"（原来第 1 次 run 级错误会 `run.retrying`+`continue` 白跑一轮，第 2 次才失败）。瞬态错误已由 `streamWithRetry` 重试处理，到达 run 级的是系统性/非瞬态失败 → 立即 `run.failed` 结束，并删除死变量 `consecutiveErrors`。
> - **✅ 项 3（已落地）**：控制动作解独占。`inner.ts` 把内联的普通工具执行逻辑提取为 `executeToolCalls`（`inner.ts:266`，参数化 characterId/sessionId/stream/runId/workspace/signal/mcpClients/workspaces/cap，返回 `{toolCallRecords, messages}`）；解独占路径（`inner.ts:786-796`）：**单个控制动作 + 普通工具同轮不再整批拒绝**——普通工具先执行（结果并入本轮上下文、与 tool_call_id 配对完整，不会被 next-turn `fixOrphanToolCalls` 误删），控制动作随后正常路由。仍整批拒绝的仅：同轮多个控制动作互斥、控制动作 + delegate_to_agent 并行（`inner.ts:742-784`）。配套改动：
>   - `control-registry.ts`：模型可见约束文案同步为解独占语义（`EXCLUSIVITY_NOTE`：可与普通工具同轮、仍与其他控制动作/delegate 互斥），`control-registry.test.ts` 断言随新文案更新。
>   - `inner-control-mix.test.ts`：**修复了改动前就存在的坏 SSE 夹具**（`line 68` 数据缺闭合 `}`，`JSON.parse` 报 malformed，无法作为验证基线），新增「submit_result + read_file 同轮」解独占用例（read_file 真实执行并记录、submit_result 正常路由、无 control.rejected），8/8 用例通过。
> - **⏸ 项 4（保留，产品设计，2026-08-29 确认）**：`loop-engine.ts:597-616` 在 plan_first/goal 下「计划未完成/目标未标记完成时以 final_answer 结束」会 push `[Policy]`/`[Goal]` alert 并 `continue` 强制回炉——这是**刻意守卫**（防模型用 final_answer 提前结束）。已与产品确认：**保留**，不允许提前结束。它不是要消除的浪费，收益记为零，不再推进。
> - **✅ 项 5（已测量，结论：层次 1 不值得做，2026-08-29）**：`ask_user` resume 走「全新 Run 重建」的疑虑，用真实 `buildInitialMessages`/`composeMessages`/`capturePrefixShape` 测量（脚本 `web/server/scripts/p05-ask-user-resume-measure.ts`，模拟 ask_user → 回答 → resume 全路径，会话规模 24/104/304 条消息）：
>   - **resume 上下文相对旧 Run 结束时是纯 append-only**（3/3 规模，可复用前缀 95.8%→99.7%）→ provider 前缀缓存可命中，resume 的 LLM 侧成本 ≈ 只多一条用户回答消息，**没有额外模型往返**。
>   - **跨 Run 全量重建耗时仅 0.6–1.6 ms**（P0-1 的 `expandContextReferences` memo 已把 @file 展开变为 O(1)，同一进程内 resume 命中第二次构建）；层次 1（序列化 messages 存 checkpoint + parse 读回）也只省 0.5–1.2 ms，在 LLM 秒级延迟面前是噪声。**结论：不做 checkpoint 续跑，保留现状**；`ask_user` 的真实成本在「用户等待 + 新 Run 排队」的产品体验，不在上下文重建性能。

**预期**：项 1+2 消除的是**错误场景**下的额外往返（收益见于瞬时/协议错误时）；项 3 消除「控制动作 + 普通工具」场景下"普通工具被整批拒绝→下一轮重发"的白轮（模型一次发齐时直接省一轮；收益场景为模型同时要执行工具并结束/提问/计划时）。项 4 保留为产品守卫、项 5 测得无性能收益 → **P0-3 全部闭环**；回合数 3-6→2-3、耗时降 30-50% 的估算在项 1/2/3 落地后已部分兑现。

### P1-1 压缩改为"收益判定 + 预算化"，不再无脑摘要 —— 【已落地（2026-08-29，实施方案 1+2+3+5）】

> **实施记录**：按推荐组合落地四项改动，`loop.test.ts` ALL PASSED、`tsc --noEmit` 零错误：
> - **✅ 方案 2（阈值，先落地）**：`COMPACT_THRESHOLD` 0.75→0.85（`loop-policy.ts:18`）。预请求/回合后/溢出/冷恢复四路都经 `shouldCompactTokens` 跟随新阈值；主动压缩更晚触发，溢出强制压缩（`loop-engine.ts:344`）不受影响。
> - **✅ 方案 1（结束轮跳过，核心）**：`loop-engine.ts` 回合后 snip+compact 块（原 548-588）整体移到 final_answer/abort/收敛 break 判定之后、while 闭合之前（现 `loop-engine.ts:616-663`）。结束轮——final_answer 放行 / aborted / 收敛（soft-limit、doom）break / submit_result-done / ask_user break——全部先跳出循环，**不再白付一次摘要 LLM 调用**。移动后 final_answer 回炉轮（`continue`）也不在回合后压缩，由下一轮 282 预请求兜底（可接受）。
> - **✅ 方案 3（重试上限可覆盖）**：`SummarizeOptions` 增加 `maxAttempts?: number`（`context-compactor.ts:327-329`），`compactWithRetries` 内 `maxAttempts = opts?.maxAttempts ?? MAX_COMPACT_ATTEMPTS`（`context-compactor.ts:517-518`），`while (attempts <= maxAttempts)`（`context-compactor.ts:523`）；**仅回合后调用**（`loop-engine.ts:647`）传 `maxAttempts: 1`，安全阀路径（282 预请求 / 344 溢出 / 冷恢复）保持 `MAX_COMPACT_ATTEMPTS=2` 原语义（git diff 确认为 `<= MAX_COMPACT_ATTEMPTS`，行为不变）。
> - **✅ 方案 5（测量 + 测试更新）**：
>   - 新增测量脚本 `web/server/scripts/p11-compact-benefit-measure.ts`（真实 `shouldCompactTokens`，模拟旧行为 0.75/attempts2/结束轮也压 vs 新行为 0.85/attempts1/结束轮跳过）：
>     - short-fresh（2k 历史，4 轮）：旧 0 触发 / 新 0 触发 —— 短任务本就无收益，符合预期；
>     - resume-short-ask（155k 历史 + 小提问，2 轮）：旧 2 次触发、上界 4 次摘要调用 → 新 **0 次、省 100%**；
>     - mid-big-final（20k + 末轮 32k）：旧结束轮白付 1 次、上界 2 次 → 新 **0 次、省 100%**；
>     - long-session（160k 历史持续增长，10 轮）：旧 10×2=20 → 新 8×1=8，**省 12 次摘要调用（60%）**。
>   - `loop.test.ts` 补 2026×300 ≈ 160,054 token 边界用例（0.75 触发 / 0.85 不触发）+ 两处 P1-4 默认阈值断言 0.75→0.85 同步。

**改动**（原建议，保留供对照）：
1. `shouldCompact`（`loop-policy.ts:153`）**只保留溢出必压缩** + `shouldCompactTokens` 提高阈值（如 `0.85`，并保留 `MAX_COMPACT_ATTEMPTS=1`）。→ 已落地为：阈值 0.85 + 回合后 `maxAttempts=1`（安全阀保留 2）。
2. 压缩前先判断收益：若"本次对话总 token < 阈值 || 任务已接近完成"则跳过，避免短任务被打一次摘要。→ 由"结束轮跳过 + 阈值上移"实现等价收益（短任务/结束轮不再触发）。
3. 摘要调用复用主请求前缀缓存：确保摘要输入与主请求**字节一致**（参考 Penguin `context-engine.ts:1402-1405`），让摘要本身也能命中 KV cache。→ 未单独改动（P0-3 P0-1 已保证 append-only；摘要输入与主请求同源）。

**预期（已由测量部分兑现）**：消除短任务上"免费白付"的一次摘要调用 + 大输入。

### P1-2 send_message 子代理续跑改为同步 barrier —— 【已落地（2026-08-29）】

> **实施记录**：原建议（见下）经实测修正——Resume Run 不重放历史、跨 Run 重建仅 0.6–1.6ms、前缀可命中（P0-3 项5），「父 Run 全链路重跑」担忧不成立；真正可省仅 1 次 LLM 调用 + 1 个 Run。方案 B 落地：**`send_message_to_subagent` 从 fire-and-forget + wake 改为与 `delegate_to_agent` 同构的同步 barrier**——`handleSubAgentMessageRequest`（`control-router.ts:130`）内 `await continueSubAgentWithMessage(...)`，父 Run 本轮等待子会话续跑完成，完成后回注工具结果，父 LLM 下一轮直接消费；**删除 `wakeParentSession`/`WAKE_TERMINAL`/wakeAlert 整套 `sub_agent_callback` wake 机制**（约 60 行；`'sub_agent_callback'` 保留在 ResumeTrigger 类型以兼容历史数据）；`send_message_to_subagent` 工具 description 补「执行完成后才返回结果」。
> - 收益：单答复 UX（消灭「已派发占位 + wake 补总结」双 final_answer）；父侧每发生省 1 个 Run + 1 次 LLM 调用；消灭「第二个子完成于 wake run 执行中 → 结果静默丢失」去重竞态；失败直见（父下一轮直接看到 error 当场决策，不再依赖「失败也 wake + alert 提示」）；代码净删。
> - 代价（产品语义变更，已确认接受）：父 Run 串行队列阻塞时长 = 子执行时长（与 delegate 一致，期间用户消息排队）；模型无法并行追问多个子（内层一次只发一个 send_message，追问串行——并行追问需另做「send_message 批处理」，对齐 delegate 的 batch，不在本次范围）；派发后不再秒回「已派发」。
> - 验证：后端 `tsc --noEmit` 零错误；`control-registry.test.ts`、`loop.test.ts` ALL PASSED。落地脚本 `scripts/p12-apply-barrier.py`。

**原建议**（保留供对照）：`wakeParentSession`（`control-router.ts:47`）从"新建 Resume Run 全链路重跑"改为**只把子代理结果作为一条 tool 结果静态注入父上下文**，父模型在下一轮直接消费，不再重新跑父 Run 的既有轮次。
→ 经 P0-3 项5 测量「全链路重跑」前提不成立，且「进程内注入」（方案 A）竞态复杂、收益窗口小，最终采用与 delegate 对齐的同步 barrier（方案 B）。

### P1-3 提高每轮 CPU 开销的缓存化 —— 【已测量：无收益，不推进（2026-08-29）】

> **测量记录**（`scripts/p13-cpu-measure.ts`，2026-08-29）：对 `estimateTokens`/`capturePrefixShape`/`compareShapes`/`stableArgsHash` 四个函数在四个场景（fresh-short 6 条 ~0.5k tok / long-160k 4053 条 **241k tok**（比计划的 160k 更重的上界）/ compact-after 27 条 ~4.8k tok / subagent-inject 4055 条 241k tok）各测单次平均耗时，按真实调用点频率（`loop-engine.ts:209/282/632/633/635/638`、`310/312`；`inner.ts:292/366/481/482/487/769`）汇总每轮合计：
> - 每轮合计最坏（long-160k，snip 触发 5.2×est）：**~14.6ms**；其中 `capturePrefixShape`（`loop-engine.ts:310`，每轮无条件调用）占绝对大头——单次 **~11.6ms**（全程 sha256 逐条消息含 tool_calls）；`estimateTokens` 单次仅 0.55ms；`stableArgsHash` 可忽略（单次 ~10µs）。compacted 场景每轮仅 ~0.6ms。
> - 占整轮比例：按 241k tok 会话现实 LLM 往返 ≥5s 口径 **0.27%**（远 <1%）；按 1s 悲观口径也仅 1.35%——而 241k tok 的 prompt 仅预填充就要数秒，1s 往返不现实。fresh/compacted 场景 ≤0.05%。
> - **结论（按 P0-3 项5 判据：实测占比 <1%）**：增量缓存（estimateTokens 按 `(messages.length, lastMsgId)`、shape/hash key 化）最多省 ~12ms/轮、即 ~0.4s/30 轮 run，相对 LLM 往返可忽略；且需承担就地更新（`submit_result` 的 `messageStore.updateContent`，`control-router.ts:726-733`）的内容版本化复杂度与陈旧风险 → **不推进，P1-3 关闭**。若未来 `[cache-shape]` 诊断日志变热，可把 `capturePrefixShape` 降频或 env gate，非本轮范围。

**原建议**（保留供对照）：
1. `estimateTokens` 结果按 `(messages.length, lastMsgId)` 增量缓存，避免每轮重算全量。
2. `capturePrefixShape/compareShapes` 与 `stableArgsHash` 结果缓存 key 化，避免重复 sha256。

**预期**：降低每轮纯 CPU 负担（尤其在长会话）。→ 实测：长会话每轮纯 CPU 合计 ~13.5–14.6ms、占现实轮时长 0.27%，无可见收益。

**交叉提醒（P1-2 已落地后）**：send_message 结果改为**完成后落库**（不再先落 running 再就地 `updateContent/updateToolOutput` 改写同一条消息），「按 `(messages.length, lastMsgId)` 缓存上下文会命中就地改写陈旧内容」的风险面收窄——delegate/send_message 回注均为新落库行；但仍需注意 `submit_result` 会 `messageStore.updateContent` 就地改 assistant 行（`control-router.ts:726-733`），若未来做增量上下文缓存须对就地更新做内容版本化（content hash 入 key）。本轮因实测无收益未做缓存，该风险未引入。

### P2-1 参数化阈值暴露方便调优 —— 【已落地（2026-08-29）】

> **实施记录**：补齐最后两个硬编码常量，`loop-policy.ts` 全部阈值为配置项；后端 `tsc --noEmit` 零错误、`loop.test.ts` ALL PASSED（含新增 P2-1 断言）、前端 `tsc` 零错误。
> - **✅ `SNIP_RATIO`**（`loop-policy.ts:16`，决定何时 `trimToolResults`）：env `TSS_SNIP_RATIO`（默认 0.6）+ **模型级 `compact_snip_ratio`**（`CompactPolicy.snipRatio`，`resolveCompactPolicy` 解析，UI 在「模型服务 → 压缩策略」弹窗新增「剪枝阈值」输入，placeholder 0.6，可与 threshold/retain 并列 per-model 覆盖）；`shouldSnip` / `shouldSnipTokens` 改走 `policy.snipRatio`（`outer.ts:255`、`loop-engine.ts:634` 已传 compactPolicy）。
> - **✅ `SOFT_COMPACT_RATIO`**（`loop-policy.ts:15`，仅 outer.ts:251 打日志用）：env `TSS_SOFT_COMPACT_RATIO`（默认 0.5），不做 UI（无行为影响）。
> - 其余阈值（`COMPACT_THRESHOLD`/`RETAIN_RATIO`/`KEEP_TOKENS`/重试上限等）此前已全部 env 化 + 模型级覆盖，不动；`config.ts` 新增 `envFloat` helper（非负浮点 env，与 `envInt` 同风格）。

**改动**（原建议，保留供对照）：
把 `SOFT_COMPACT_RATIO`/`COMPACT_THRESHOLD`/`SNIP_RATIO`/`MAX_COMPACT_ATTEMPTS`（`loop-policy.ts:15-40`）统一暴露为模型级/运行级配置项，便于按任务类型（短任务用高阈值、长会话用低阈值）调优。→ 已全部落地（模型级压缩策略 UI 入口：`ModelCompactDialog.tsx`）。

---

## 3. 落地优先级建议 & 预期收益

| 优先级 | 动作 | 改动量 | 预期收益 |
|---|---|---|---|
| P0-1 | 已测量为不可行（状态化上下文），仅落地"跨 Run 重建瘦身 + @file 引用解析修复" | 小（已落地） | 消除跨 Run 重复读/抓；真实收益见 P0-3 / P1-1 |
| P0-2 | 工具瘦身/按需下发 —— **已落地（description 精简 + 模式 alert，2026-08-29）** | 小（已落地） | schema ~3645→2551 tok（省 30%）；放弃按模式裁剪（产品语义：direct 需保留自判能力） |
| P0-3 | 减少额外往返 | 小-中 | 回合数↓ 30-50%（项1+2+3落地；项4保留；项5测得无收益） |
| P1-1 | 压缩收益判定/预算化 —— **已落地（方案 1+2+3+5）** | 小（已落地） | 长会话省不到摘要调用：resume 场景省 100%、长会话省 60% 上界（见 §P1-1 测量） |
| P1-2 | send_message 改同步 barrier（删 wake 机制）—— **已落地（2026-08-29）** | 中（已落地） | 委托场景省 1 Run + 1 轮 LLM；单答复 UX；消灭唤醒竞态 |
| P1-3 | CPU 增量缓存 —— **已测量：无收益，不推进（2026-08-29）** | 极小（测量脚本） | 实测最坏 241k tok 会话每轮纯 CPU ~14.6ms、占现实轮时长 0.27%；增量缓存最多省 ~12ms/轮，不值得复杂度 |
| P2-1 | 参数化暴露阈值 —— **已落地（2026-08-29）** | 极小（已落地） | 全部阈值可调：SNIP_RATIO 走 env + 模型级剪枝阈值（压缩策略弹窗），SOFT_COMPACT_RATIO 走 env |

**建议顺序**：P0-1 已测量为不可行、改为落地跨 Run 瘦身（已完成）；P0-3 已闭环——项 1（重试 3→2）+ 项 2（run 级错误不补整轮）+ **项 3（控制动作解独占，含坏夹具修复与配套测试）**落地，**项 4（final_answer 回炉）经产品确认保留**，**项 5（ask_user resume）经测量（`scripts/p05-ask-user-resume-measure.ts`）确认无性能收益、不推进**；**P1-1 已闭环**（压缩阈值 0.85 + 回合后 maxAttempts=1 + 结束轮跳过，测量脚本 `scripts/p11-compact-benefit-measure.ts`）；**P0-2 已闭环**（description 精简省 30% + 模式 alert 提示表达 direct/plan_first/goal 语义，放弃按模式裁剪工具，测量脚本 `scripts/p02-toolsize-measure.ts` / `p02-slim-eval.ts`）；**P2-1 已闭环**（补 `TSS_SNIP_RATIO`/`TSS_SOFT_COMPACT_RATIO` env + 模型级剪枝阈值进压缩策略弹窗，落地脚本 `scripts/p21-apply-snip-config.py`）；**P1-2 已闭环**（`send_message_to_subagent` 改同步 barrier + 删除 wake 机制 + 工具描述补「执行完成才返回」，落地脚本 `scripts/p12-apply-barrier.py`；主因：经测量「全链路重跑」为伪收益，异步 fire-and-forget 的双答复/唤醒竞态得不偿失，产品确认接受 barrier 的队列阻塞语义）；**P1-3 已测量并关闭**（`scripts/p13-cpu-measure.ts`：最坏 241k tok 长会话每轮 4 个纯 CPU 函数合计 ~14.6ms、占现实 LLM 往返 0.27%，增量缓存收益可忽略且引入就地更新版本化风险 → 不推进）。**P0–P2 清单已全部闭环/关闭，无剩余主力**；后续可选方向：send_message 批处理（对齐 delegate batch 实现并行追问，P1-2 遗留）或新产品需求。

---

## 4. 风险与权衡

- **P0-1（状态化上下文）**：已实测当前 provider 为无状态、且每轮已是 append-only → 原方案不可行、不再推进。已落地的 memo 缓存在"文件改动经 mtime/size 校验、URL 经 60s TTL、不缓存失败结果"下无陈旧风险；但需注意**不要把文件缓存的结果写回 DB**（只影响内存态发送），并对 `reasoning_content` 透传保持谨慎（避免"be more consistent"式 API 拒绝）。
- **P0-2（工具瘦身，已落地）**：**放弃"按模式裁剪控制工具"**——若裁剪则 direct 模式下模型失去 plan/goal 能力（与"direct 模型自判"语义冲突），模式差异改由 alert 提示（变化才注入、字节稳定）表达。已落地的是 description 精简（省约 30%）；风险在于精简 description 可能影响模型对参数语义的理解——已保留 enum/必填结构且 `control-registry.test.ts` 断言子串不受影响；进一步压缩（删参数 description）实测无收益且可能伤语义，不推进。
- **P0-3（解独占，项 3 已落地）**：混合路径已配新用例（read_file 真实执行并记录 + submit_result 正常路由，断言无 control.rejected），普通工具结果与 tool_call_id 配对由 `executeToolCalls` 统一组装，不会被 next-turn `fixOrphanToolCalls` 误删；仍保留的整批拒绝（多控制互斥 / 控制+delegate）行为不变，由既有混合用例守卫（`inner-control-mix.test.ts:88-102`）。
- **P1-1（压缩预算化，已落地）**：阈值调高（0.85）后主动压缩更晚触发，但**溢出强制压缩（`loop-engine.ts:344`）不受阈值影响**，仍按 `MAX_OVERFLOW_COMPACTS=2` 兜底，长会话溢出风险受控；回合后 `maxAttempts=1` 只影响管理性压缩，安全阀路径保留原 2 次重试。移动块到循环尾后，final_answer 回炉轮（计划未完成 `continue`）的回合后压缩被跳过，由下一轮预请求（`loop-engine.ts:283`）兜底——语义等价、收益保持，测试已覆盖。另注意：**编辑 `loop-engine.ts` 时其行尾为 `\r\r\n`**（历史遗留），Python 默认 universal newlines 会将其翻译成 `\n\n` 导致多行匹配失败；用 `open(newline='')` 读原始字节 + 归一化/写回即可。
- **P1-2（send_message 改 barrier，已落地）**：父 Run 串行队列阻塞时长 = 子执行时长（与 delegate 一致，期间用户消息在父会话队列排队）；内层一次只发一个 send_message，模型无法在**一个 Run 内**并行追问多个子（若需并行追问，另做「send_message 批处理」对齐 delegate 的 batch）；墙钟预算默认 30 分钟（`run-policy.ts:53`）只在新建 continuation 时校验、运行中不中断，影响面小。
- **P1-3（CPU 增量缓存，已测量关闭）**：最坏场景（241k tok 长会话）每轮 4 个纯 CPU 函数合计 ~14.6ms、占现实轮时长 0.27%，增量缓存收益可忽略；主成本 `capturePrefixShape`（`loop-engine.ts:310` 每轮无条件、单次 ~11.6ms/241k tok）服务于 `[cache-shape]` 诊断日志，若未来该日志变热可降频或 env gate，本轮不做。未引入缓存，故无就地更新陈旧风险。
- 任何 cache 类优化都要以**字节一致前缀**为前提，否则会命中不了的 cache 反而加复杂度。

---

## 附录：关键代码索引

| 问题 | 文件:行 |
|---|---|
| 每次 Run 拉历史（非每轮） | `web/server/src/agent/outer.ts:216-221` |
| 静态提示组装 | `web/server/src/agent/loop/context-builder.ts:47,316-343` |
| 常规工具清单 | `web/server/src/tools/definitions.ts:16-19` |
| 控制工具叠加（保持全量下发，P0-2 不裁剪） | `web/server/src/agent/outer.ts:175` |
| 控制工具名 / 精简后 description | `web/server/src/agent/loop/control-registry.ts:21,28,39-186` |
| 三种模式 alert（P0-2：direct 自判 / plan_first plan 必做 / goal 双必做） | `web/server/src/agent/loop/loop-engine.ts:215-267`（directModeAlert 常量 `:153`） |
| 重试次数（已落地 3→2） | `web/server/src/agent/inner.ts:180` |
| 普通工具执行提取 executeToolCalls（P0-3 项3） | `web/server/src/agent/inner.ts:266` |
| 控制/普通工具分类 | `web/server/src/agent/inner.ts:733-734` |
| 整批拒绝：多控制互斥 / 控制+delegate | `web/server/src/agent/inner.ts:742-784` |
| 解独占：单控制 + 普通工具 → 普通工具先执行 | `web/server/src/agent/inner.ts:786-796` |
| delegate 推迟普通工具 | `web/server/src/agent/inner.ts:797-830` |
| 无控制路径统一走 executeToolCalls | `web/server/src/agent/inner.ts:973-976` |
| 控制工具互斥/共存文案（模型可见） | `web/server/src/agent/loop/control-registry.ts:36-38` |
| run 级补轮（已落地改为立即失败） | `web/server/src/agent/loop/loop-engine.ts:375` |
| final_answer 回炉 | `web/server/src/agent/loop/loop-engine.ts:597-616` |
| 压缩阈值（已落地 0.75→0.85，P1-1） | `web/server/src/agent/loop/loop-policy.ts:18` |
| snip/soft 阈值（P2-1：env TSS_SNIP_RATIO / TSS_SOFT_COMPACT_RATIO + 模型级 compact_snip_ratio） | `web/server/src/agent/loop/loop-policy.ts:15-16,59-83`；模型级 UI `web/client/src/components/ModelCompactDialog.tsx` |
| 摘要重试上限可覆盖（P1-1） | `web/server/src/agent/loop/context-compactor.ts:327-329,517-523` |
| 回合后压缩（已移至循环尾 + maxAttempts:1，P1-1） | `web/server/src/agent/loop/loop-engine.ts:616-663` |
| 摘要调用 | `web/server/src/agent/loop/context-compactor.ts:509-536` |
| send_message 同步 barrier（P1-2：wake 机制已删，不再有子代理唤醒） | `web/server/src/agent/loop/control-router.ts:130-218` |
| run 级串行 | `web/server/src/agent/runtime/run-coordinator.ts:33-42` |

（以上基于源码静态分析；其中 P0-1 已用真实函数测量脚本量化并修正结论，脚本：`web/server/scripts/p01-cache-shape-measure.ts`；P0-3 项 5 的 ask_user resume 成本测量脚本：`web/server/scripts/p05-ask-user-resume-measure.ts`；P1-1 压缩收益测量脚本：`web/server/scripts/p11-compact-benefit-measure.ts`；P0-2 工具体积/按模式拆分收益测量：`web/server/scripts/p02-toolsize-measure.ts`，description 精简后再压缩收益评估：`web/server/scripts/p02-slim-eval.ts`，落地脚本：`web/server/scripts/p02-apply-slim.py`（描述精简）、`web/server/scripts/p02-apply-mode-alert.py`（模式 alert 注入）；P2-1 参数化落地：`web/server/scripts/p21-apply-snip-config.py`（后端 env + 模型级 snipRatio）、`p21-apply-frontend-types.py`（前端类型/绿点）、`p21-apply-loop-test.py`（测试断言）；P1-2 落地：`web/server/scripts/p12-apply-barrier.py`（send_message 改 barrier + 删 wake 机制 + desc 更新）；P1-3 CPU 开销测量（结论：无收益、不推进）：`web/server/scripts/p13-cpu-measure.ts`。）
