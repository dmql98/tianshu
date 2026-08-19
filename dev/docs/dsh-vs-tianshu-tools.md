# DSH 工具系统 vs 天枢工具系统 — 对比分析与优化建议

> 调研日期：2026-08-20 ｜ 基准仓库：`deepseek-harness`（DSH, `C:\Users\dmql\Documents\GitHub\deepseek-harness`）
> 目标仓库：天枢（`web/server/src/tools/` + `web/server/src/agent/`）
> 结论速览：天枢的工具**能力覆盖面已经不错**（read/write/edit/bash/glob/grep/websearch/webfetch/MCP/技能/角色管理都有），
> 但**架构层面缺少 DSH 的 6 个关键机制**：① 结构化输出与 UI 呈现契约；② 可插拔执行管线（pre/post/guard）；③ 工具级系统提示注入；
> ④ 声明式并发安全；⑤ 后台任务与持久会话；⑥ 规范化工具名与 MCP 生命周期。另外发现 **1 个实际 Bug：tool.json 编码损坏导致约束配置全部失效**。

---

## 1. 总览对比

| 维度 | DSH | 天枢 |
|---|---|---|
| 工具注册机制 | Cordis 插件 + `ctx.tools.register()`，作用域分层（global/agent/child），支持运行时卸载 | `registry.ts` 静态扫描 `tools/<name>/index.ts` + `tool.json`，进程级 Map，一次性 init |
| 工具定义契约 | `defineTool({ name, description, parameters, output, presentCall, presentResult, isConcurrencySafe, timeoutMs })` | `ToolModule { name, description, parameters, dangerous, signal, constraintFields, execute }` |
| 参数校验 | schemastery DSL 编译为 JSON Schema，注册表统一校验 | zod schema + `validate()` 包装，参数一律 `Record<string,string>` 手工转换 |
| 输出 | **结构化 JSON schema + render() 投影为模型文本 + presentationMeta 持久化** | 只有 `{ output: string, error?, metadata?, attachments? }`，模型只看到纯文本 |
| UI 呈现 | `presentCall/presentResult` 纯函数 → read 卡片 / diff 卡片 / terminal 卡片 | socket 事件 `tool.started/completed/output`，前端自己渲染原始文本 |
| 执行管线 | pre-execute(审批) → guard(单调拒绝) → execute(waterfall: 超时/重试) → post-execute(改写) → result(观测) | `inner.ts` 硬编码 Phase1-4：绑定约束→策略→审批→执行 |
| 并发 | 工具声明 `isConcurrencySafe`，注册表调度并行组与屏障 | 硬编码 `READ_ONLY_TOOLS` 集合：读并行、写串行 |
| 系统提示 | 每个工具注册 `systemPrompt.section()`（`tool:read`、`tool:write`…） | 无；只通过 `description` 传给 API tools 参数 |
| 沙箱/审批 | `sandbox_permissions` + `justification` 升级，approval 服务统一 | 策略矩阵（5 档）+ `allowedRoots` + workspace 审批 |
| 观测/版本 | `fs/observed` 事件，read-before-write 策略，版本戳防陈旧写 | 无版本观测；write 只做 noop 检测 |
| MCP | 命名 `mcp__<server>__<tool>`（规范化+哈希），自动重连、generation 同步/回滚、listChanged | `mcp__<server>__<tool>` 手写正则解析，无重连/无 generation 管理 |
| 后台任务 | `ctx.jobs` + `job_output/job_list/job_kill`，`run_in_background` | 无；bash 同步阻塞 |
| 子代理 | provider 化 `subagents`（spawn/continuable），`send_message/interrupt/list_agents` 控制 | `delegate_to_agent` 同步控制工具 |
| 技能 | `tool-skill` 加载技能、会话技能目录、skill catalog 上下文 | `skill_manager` 工具 + `session-skill-store` |
| 目标/计划 | `tool-goal`（多轮持久化）+ plan 工具 | `create_goal/get_goal/complete_goal` + `create_plan/update_plan_step` 控制工具 |
| todo | `tool-todo`（全量替换任务列表） | ❌ 无 |
| 工作流 | `tool-workflow`（多子代理编排） | ❌ 无 |
| LSP/会话查询 | `tool-lsp`、`tool-session-query` | ❌ 无 |
| 持久终端 | `tool-terminal`（6 个 PTY 工具） | ❌ 无（bash 一次性） |
| 大文件读取 | 流式 + 窗口化 + 行/字节上限 | 1MB 上限 + offset/limit 分页 |
| 超时 | 协作式 `timeoutMs` + signal 融合 | 各工具自带常量（bash 60s、webfetch 30s） |
| 测试 | 每个工具包 vitest 单测 + e2e | 部分工具有（bash/abort、edit、write、matchers、skills、utils、mcp_discovery、sub-agent） |

---

## 2. 逐工具对比

### 2.1 read

| | DSH | 天枢 |
|---|---|---|
| 参数 | `file_path` + `offset` + `limit` | `path` + `offset` + `limit` |
| 大文件 | ≥10MB 流式读取，窗口化（行数/行长/字节三重上限） | >1MB 直接拒绝（错误提示用 grep/offset） |
| 输出 | 结构化 `{path, offset, lines[], totalLines}`，render 成带行号文本，presentationMeta 供 UI 渲染 read 卡片 | 纯文本 `路径 (N lines, showing a-b)` + 行号 |
| 未找到 | 明确错误 | **模糊建议**（fuzzySuggest 相似文件名）— 天枢特色，值得保留 |
| 观测 | 读后记录版本，供 edit/write 防陈旧 | 无 |

**天枢优化点**：① 1MB 硬拒绝可改为"超限走流式/窗口化"或至少用 `offset` 定位（当前错误提示让模型用 grep，丢失上下文）；② 输出增加结构化字段（行数组、总行数），前端可渲染 read 卡片；③ fuzzySuggest 是好功能，建议移植保留。

### 2.2 write / edit

| | DSH | 天枢 |
|---|---|---|
| write | 原子写 + `fs/observed` 版本 + sandbox 升级字段 + diff 元数据 | 原子写（temp+rename）+ BOM 保持 + noop 检测 + metadata{path,bytes,status,hash} ✅ 已经很接近 |
| edit | 字面匹配唯一性默认 + replace_all；read-before-write 策略 | **模糊匹配链**（trim/block-anchor/whitespace/indent/escape/boundary）+ 文件锁 + CRLF/BOM 保持 ✅ 甚至更强 |

**天枢优化点**：edit 的 matchers 已经是 DSH 之上；write 缺 read-before-write 防覆盖策略（可通过"edit 前必须 read"的观测机制补）。write 的 `metadata.status='noop'` 已正确接入 `determineToolChanged`，这点比 DSH 直接。

### 2.3 bash

| | DSH | 天枢 |
|---|---|---|
| 后台 | `run_in_background` + jobs 系统 | ❌ 无 |
| 输出 | 退出码标记 `[exit code: N]`、长输出存文件 | 1MB 截断存文件 ✅ |
| 超时 | 协作式 timeoutMs + 二段 kill（TERM→KILL） | 60s 固定 + 二段 kill（WIN32 taskkill /T）✅ |
| 环境 | `workdir` 参数 + DSH 环境变量 | 无 workdir 参数（只能 cwd=workspace） |
| 沙箱 | `sandbox_permissions` 升级审批 | workspace 授权（path 级别） |
| Windows | bash/pwsh 双工具 + cmd 兜底 | Git Bash→cmd→powershell 候选链 + 代码页检测（GBK 解码）✅ 中文环境考虑周到 |

**天枢优化点**：① `run_in_background` 是最值得补的能力（长任务不阻塞 turn）；② 补 `workdir` 参数；③ grep 工具用 `execSync`（同步阻塞主进程 30s），应改异步 spawn 或 `@vscode/ripgrep` 子进程；④ 命令行路径扫描用正则启发式（`scanCommandPaths`），DSH 用 `ctx.fs` 规范解析，可减少误报。

### 2.4 websearch / webfetch

| | DSH | 天枢 |
|---|---|---|
| 搜索 | `ctx.web` 服务（可插拔 provider，Brave/Tavily/SerpAPI…），结构化输出+来源上限 | 4 个后端（自定义 API→Bing→DDG-HTML→DDG-Lite）正则解析 HTML ✅ 无外部依赖 |
| 抓取 | `web_fetch`：超时预算、200KB 上限、markdown 转换 | webfetch：Readability + turndown + 图片附件 ✅ 能力强 |
| 输出 | 结构化 sources 数组 + 渲染 | 纯文本列表 |

**天枢优化点**：① 搜索用 HTML 正则解析脆弱（Bing/DDG 改版即挂），建议升级为可插拔 provider（`SEARCH_API_URL` 已留口子）；② 结构化输出（title/snippet/url 数组）便于 UI 渲染。

### 2.5 MCP

| | DSH | 天枢 |
|---|---|---|
| 命名 | `mcp__<server>__<tool>`，规范化（≤64 字符，非法字符哈希后缀） | `mcp__<server>__<tool>` 手写正则 `^mcp__(.+?)__(.+)$` |
| 生命周期 | 自动重连（退避）+ generation 回滚 + listChanged 重新同步 | 一次性连接，失败即错误 |
| 发现 | 配置驱动 | opencode/claude/cursor 配置发现 + 导入 ✅ 特色 |

**天枢优化点**：① 至少补"自动重连"（DSH 有完整 reconnect 测试）；② 工具名规范化（含点号/斜杠的 MCP 工具名在天枢正则下会解析错位）；③ MCP 工具也应纳入结构化输出。

### 2.6 天枢独有、DSH 没有的能力

- `character_manager`（角色技能/工具绑定管理）、`provider_manager`（LLM provider 管理）、`skill_manager`（技能包 CRUD+激活）、`debug_sessions`（LLM 调用轨迹）— 这些是**管理面工具**，DSH 把它们放在配置/UI 而非模型工具里。天枢把它们暴露给模型是产品选择，但注意：**这些工具会占用模型上下文（每个 ~1-2KB schema），且危险度需要策略保护**（provider_manager 可改 API key）。建议：默认从模型可见工具集剔除，仅按需通过字符绑定启用。

---

## 3. 发现的 Bug（高优先级）

### 3.1 tool.json 编码损坏 → 约束配置全部失效

- **现象**：`web/server/src/tools/` 下 15 个 `tool.json` 中 **9 个是 GBK 编码**（含中文 label，如 `"label": "允许的命令"` 以 GBK 字节存储），非 UTF-8。
- **证据**：`bash/tool.json` 首字节 `7B 20...`（ASCII `{`），但 index 885 处 `D4 CA D0 ED B5 C4 C3 FC C1 EE` 是 GBK 的"允许的命令"；`New System.Text.UTF8Encoding($false,$true).GetString()` 抛 `Unable to translate bytes [D4]`。
- **影响链**：
  1. `registry.ts:readToolJson()` 以 `utf-8` 读 + `JSON.parse` → 抛异常 → `return null` → `mod.tool.constraintFields` **永远不会被设置**；
  2. `definitions.ts:validateConstraints()` 依赖 `tool.constraintFields` 才能对 `allowed_paths/allowed_commands/denied_patterns/max_file_size` 做校验；拿不到就跳过 → **字符级工具约束形同虚设**（`mcp__` 分支的 readonly/max_rows 除外）；
  3. `routes/tools.ts:readToolMetas()` 同样 UTF-8 解析失败 → **前端"工具约束配置界面"读不到 constraintFields**，UI 上约束为空。
- **修复**：把 9 个 GBK tool.json 转存为 UTF-8（`iconv -f GBK -t UTF-8` 或编辑器另存为 UTF-8），并加一个启动时/CI 校验：`tool.json` 必须是合法 UTF-8 + JSON。顺带统一 `registry.ts` 与 `routes/tools.ts` 的解析逻辑（当前两处重复实现，`routes` 里 catch 静默吞错）。

### 3.2 其他小问题

- `registry.ts` 与 `routes/tools.ts` 重复实现 tool.json 解析，规则漂移风险（如 routes 不读 constraintFields 的 validateArg 细节）。
- `getCharacterToolDefinitions` 里外部工具 fallback 的 description 是 `External tool`，无 schema —— 模型会盲调用；应至少带 properties。
- `bash` 的 `scanCommandPaths` 用正则扫描路径做安全断言，`/c/...`、`-f` 等 Windows 参数需大量特判（代码里已有），仍可能误杀/漏过；DSH 由 fs 层统一解析。

---

## 4. 建议的优化路线图

### 阶段一：正确性修复（1-2 天）

1. **修复 tool.json GBK→UTF-8**，加 CI/启动校验（这是当前最大的隐性失效点）。
2. `grep` 工具 `execSync` → 异步（`spawn` + 流式输出，遵守 signal 中止），避免 30s 阻塞事件循环。
3. 统一 registry 与 routes 的 tool.json 解析（提取公共 `readToolMeta()`）。

### 阶段二：执行管线抽象（1 周）

把 `inner.ts` 里硬编码的 Phase1-4 抽成可插拔的执行管线，对齐 DSH 的扩展点：

```
precheck(name, args, ctx) → { allow | ask | deny | reason }   // 绑定约束 + 策略
guard(exec) → string | undefined                               // 单调拒绝
execute(name, args, exec) → ToolResult                          // 可被 wrapper 包一层（超时/重试/指标）
postprocess(exec, result) → result                              // 结果改写（截断/剪枝/元数据）
```

收益：① 新策略/新约束不需要改 `inner.ts`；② 超时策略可以按工具声明（`timeoutMs`）而非散落各工具；③ 审批逻辑与执行逻辑解耦，便于测试。

### 阶段三：结构化输出 + UI 呈现契约（1-2 周）

1. 扩展 `ToolResult`：`output` 保留（模型文本），新增可选 `structured` 字段，或按 DSH 思路给 `ToolModule` 增加 `output: { schema, render, presentationMeta }`。
2. read/glob/grep/websearch 返回结构化数组，前端按类型渲染（read 卡片带行号、diff 卡片、搜索结果卡片）。
3. 迁移成本控制：先只改 read/edit/write 三个高频工具，其余保持 `{output}` 兼容。

### 阶段四：补齐 DSH 关键能力（按产品优先级排序）

| 能力 | 工作量 | 价值 |
|---|---|---|
| `run_in_background` + 后台任务（bash 长命令） | 中 | 高 — 长任务不再阻塞 turn |
| 工具级系统提示注入（每个工具一段 usage 指导） | 低 | 高 — 显著减少工具误用（DSH 每个工具都有 `tool:xxx` section） |
| 声明式并发安全（`isConcurrencySafe` 替代 READ_ONLY_TOOLS 硬编码） | 低 | 中 — 避免"读并行写串行"误伤只读 MCP 工具 |
| MCP 自动重连 + 工具名规范化 | 中 | 中 — 稳定性 |
| read 大文件流式化 | 中 | 中 — 摆脱 1MB 上限 |
| todo / 持久终端 / LSP / 会话查询 | 高 | 视产品定位 |

### 阶段五：测试与回归

- 每个工具补 vitest 单测（对齐 DSH：read 窗口、edit 匹配、bash abort、MCP reconnect 都有现成测试可参考移植）。
- 在 CI 里加"tool.json 必须 UTF-8 合法 JSON"的校验，防止编码问题复发。

---

## 5. 附：天枢工具清单（现状）

内置工具：`bash, character_manager, debug_sessions, edit, get_time, glob, grep, mcp_manager, provider_manager, read, skill_manager, webfetch, websearch, write`（14 个）
控制工具（loop 层处理，`CONTROL_TOOL_NAMES`）：`delegate_to_agent, submit_result, ask_user, create_plan, update_plan_step, create_goal, get_goal, complete_goal`（8 个）
MCP 工具：`mcp__<server>__<tool>` 动态注册。
