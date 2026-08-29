# 侧边栏对比报告：天枢 vs PenguinHarness（轨迹 / 智能体 / 工作区 / 记忆）

> 报告日期：2026-08-29
> 对比对象（均为实际代码核实）：
> - **PenguinHarness**：github.com/Prism-Shadow/penguin-harness（main 分支，`packages/web/src` 侧边栏/路由/各 feature 源码）
> - **天枢 TianShu**：本地仓库 `dmql98/tianshu` 的 `dev/web/client/src`（App.tsx nav-rail、pages/features）+ `dev/web/server/src`（db/sessionStore、characterStore、evolution/storage/trajectoryStore、agent/workspace-approval）
> 上一份《天枢 vs PenguinHarness 全面对比报告》因中文文件名未落盘，本报告改用 ASCII 文件名。

---

## 0. 结论速览（一句话）

**两侧的侧边栏形态同构、哲学相反**：都采纳了「会话列表 + 页面导航 + 底部设置」的单栏结构，且都不把「轨迹」放进顶级导航（轨迹=会话内的观察视图）。但 Penguin 把 **Agent / Workspace / Memory 做成了第一等公民**（可管理、可分组的对象），而天枢把它们**折叠进「角色」这一个对象里**（角色=人格+记忆+工具+技能的复合体），工作区则停留在工具审批层面。

| 维度 | PenguinHarness 侧边栏 | 天枢侧边栏 |
|---|---|---|
| 结构 | 项目切换器 → 新建会话(常驻) + 页面导航组 → 会话列表(三分组) → 底部用户设置 | Logo → 9 个导航项(会话/角色/技能/工具/MCP/知识/市场/事件/设置) |
| 页面导航项 | 智能体 / 技能 / 模型 / 用量(仅管理员) / 评估中心（可折叠为一组） | 会话 / 角色 / 技能 / 工具 / MCP / 知识 / 市场 / 事件(带徽标) / 设置 |
| 轨迹 | **不在导航**：聊天工具栏 dock tab（Trace Panel），跨实例导入在系统设置 | **不在导航**：聊天页子路由 `/chat/:sessionId/trajectory` |
| 会话组织 | 按工作区(默认)/按智能体/按时间 3 种分组 + 子代理/定时/归档文件夹 | 平铺会话列表（按角色/会话自身），无分组模式 |
| 对象模型 | Agent / Workspace / Memory / Skill 都是独立可管理实体 | 一切挂在「角色」下面（角色=人格+记忆+工具+技能+模型） |

---

## 1. 侧边栏全景

### 1.1 PenguinHarness（`sidebar.tsx`，2905 行，单列）

自上而下：
1. **项目切换器**（Project switcher，多项目数据根）
2. **新建会话**（常驻钉住，草稿态 `/chat/new`，在输入卡片上选 Model / Workspace / 审批模式）
3. **页面导航组**（可折叠，状态存 localStorage）——由 `NAV_GROUP_KEYS` 清单驱动：
   `agents → skills → models → usage → benchmark`，即 **智能体 → 技能 → 模型 → 用量(仅 admin) → 评估中心**；`machines`（远程装机）已构建但**未发布**，不显示。
   > 关键设计：**Traces 刻意不进导航**。源码注释原话：*"Traces is deliberately absent: reading a Trace happens in the chat toolbar's panel switcher, which is the only place it happens."*（轨迹只在产生它的会话旁边读。）
4. **会话区**：3 种分组模式（按 **Workspace** 默认 / 按 **Agent** / 按时间），可置顶分组与会话、右键菜单（重命名/归档/删除）、子代理/定时/归档文件夹、分页。
5. **底部**：主题 / 语言 / 系统设置（对话框）/ 退出。

另有独立全屏 `/terminal`（无侧边栏，仅登录校验）。

### 1.2 天枢（`App.tsx` nav-rail）

自上而下：
1. Logo（点击回首页）
2. 9 个导航项：**会话 / 角色 / 技能 / 工具 / MCP / 知识 / 市场** + 分隔线 + **事件**(活动事件数徽标，30s 轮询) + **设置**
3. 低频页面路由级懒加载（CharacterDetailPage 807 行、SettingsPage 1008 行按需下载）
4. 额外路由：`/chat/:sessionId/trajectory`（轨迹，会话页子视图）、`/skins`（主题皮肤，未进导航）

差异要点：
- Penguin 的会话区是一等 UI（分组/置顶/归档/文件夹），天枢的会话只是导航第一项，没有分组组织。
- 天枢有 Penguin 没有的 **知识 / 市场 / 事件** 三个产品化入口（知识库、技能市场、事件任务），没有 Penguin 的 用量/评估中心（数据层有自进化，但没有评测 UI）。

---

## 2. 轨迹（Trajectory / Traces）

> 两者惊人一致：**都不在侧边栏里**，都是「会话内的观察视图」。天枢是刚补上的新功能（`/chat/:sessionId/trajectory` + `evolution/storage/trajectoryStore.ts`），Penguin 则是同款思路的成熟版（chat dock trace panel）。

| 方面 | 天枢 轨迹 | PenguinHarness Traces |
|---|---|---|
| 入口 | 会话页内子路由 `/chat/:sessionId/trajectory` | 聊天工具栏面板切换器（dock tab） |
| 数据结构 | messages 表时间线 + run 边界；服务端 trajectories 表存 `user_goal / tool_calls / summary / success_rate`（供进化挖掘） | Trace 文件（每会话多 shard：压缩分片会生成新文件，pills 最新优先），服务端分析出 TaskStats/ModelSegment/ToolSpan |
| 时间线 | user / assistant / tool 三类行，跨 run 全局 step 号；run 边界分隔条；生命周期事件条（run.* / approval.* / ask_user） | 按 **Task(round)** 分组的执行时间线 + 消息列表 |
| 模型指标 | LLM 调用指标：llmMs / ttftMs / decodeMs / tokenSpeed / input+output+cache 命中 token；工具时长 durationMs | 分类 token（input 含 cache hit 括号、output）、tool 调用数/成本/时长/输出 TPS、context 用量环（cacheRead/cacheWrite/output） |
| 可视化 | 列表式时间线 + 过滤 + 汇总 + 系统提示 token 估算；子 agent 摘要内联（对齐 opencode `formatSubagentToolcalls`） | **CUDA profiling 风格二维泳道图**：5 类色段（思考/模型回复/工具调用生成/审批等待/工具执行，每工具一行），时间轴缩放/平移、时间线↔消息联动高亮 |
| 实时性 | 由 durable 事件驱动重拉（run.* message.created/metrics tool.* approval.* ask_user usage sub_agent.started），节流 400ms | 首次显示/每次重显/turn 结束时刷新；隐藏 tab 不拉 |
| 导出/导入 | —（无跨实例） | 导出选中文件原始 Trace；**跨实例导入**在系统设置（曾经有独立浏览页已废弃） |
| 附加职能 | 轨迹摘要/成功率为离线挖掘（offlineMiner）、洞察提取（InsightExtractor）、技能生成（SkillGenerator）供料 | Trace 供**评估中心**（benchmark）做量化评分回放 |

结论：天枢轨迹覆盖了「看过程」的主干（行级时间线+指标+实时），Penguin 更进一步做了任务级分组的泳道图与成本/缓存透视。两者都把「轨迹」定位为**生产现场的观察窗**而非导航页，这是值得保持的正确形态。

---

## 3. 智能体面板（Agents / 角色）

| 方面 | PenguinHarness 智能体 | 天枢 角色 |
|---|---|---|
| 列表页 | GitHub 仓库列表风格紧凑行：头像+名称+agentId、描述、统计行（会话数/工具数）、**30 天活动 sparkline**、按状态高亮；操作：新建会话/设置/用量/删除 | 星官卡片/列表：名称、主/子 Agent 标签、**立绘动效预览**（待机/思考/工作/说话/完成/出错 6 组动画）、皮肤 |
| 详情/设置 | 8 个 tab：**Overview / System Prompt(AGENTS.md+system_prompt) / Runtime(max_turns,model,compaction) / Tools(内置工具表+MCP) / Skills / Memory / Vault(密钥库) / Schedule(定时)** | 6 个 tab：**基础 / 视觉与动画 / 记忆 / 工具 / 技能 / 统计** |
| 创建 | 表单：名称+描述+技能多选（技能库 + 项目 `.agents/skills` / `.claude/skills`）；内置 Agent 不可删 | 角色新建/复制，内置角色 copy-on-write（source=user） |
| 状态管理 | Agent State 快照：版本、导出/导入（分片按 member 可下载、owner 可写回）、State 路径可复制 | 角色 revision-store（版本）、builtin/user 双层覆盖模型 |
| 对象模型 | Agent 独立：AGENTS.md、skills、tools、vault、schedule、memory 各自成体系，跨 Agent 有**层级（父→子）** | 角色复合：角色=人格(soul/user/memory)+工具+技能+模型+helpers(子角色白名单)+runPolicy+策略，无全局技能库之外的层级 |
| 代际差异 | 面向「多 Agent 分工协作」管理（可被另一个 Agent 创建/优化——AI Build AI） | 面向「人格扮演」管理（星官人格、动效、皮肤），自进化包装为「星官觉醒」 |

差异本质：Penguin 的智能体面板是**工程对象管理**（配置即代码、可快照、可调度、可评测），天枢的角色面板是**角色扮演对象管理**（人格+视觉+养成）。天枢的 `helpers`（工作帮手白名单）在概念上接近 Penguin 的子 Agent，但粒度停在角色级配置。

---

## 4. 工作区（Workspace）

| 方面 | PenguinHarness | 天枢 |
|---|---|---|
| 数据模型 | Session 带 **Workspace 路径**，临时目录并入 trailing 组；workspace-registry 支持手动手工注册（别名、重命名、删除） | Session 表有 `workspace` + `workspaces`(JSON 数组) 字段，但**无注册表、无别名** |
| 侧边栏角色 | **第一等分组维度**：默认「按工作区」分组；组头 "+" 在该工作区新建草稿会话；组可置顶/折叠/分页 | 无：会话平铺，工作区不参与侧边栏组织 |
| 会话内 | 草稿输入卡可选 **Model / Workspace / 审批模式**；会话行显示审批 pending 徽标 | 工作区=文件系统工具：`/api/workspace/list` 浏览目录、resolve、在文件管理器中打开（ChatInput/FilePanel/FolderPicker 用于选目录） |
| 审批 | 工具权限矩阵 + workspace 根授权 | workspace-approval.ts：审批「工作区根目录扩张」，Auto Approve 策略直接放行 |
| 记忆联动 | 每个 Workspace 有**独立 Memory scope**（见 §5） | 无此概念 |
| 语义 | 工作区 = 会话的组织单元 + 记忆的边界 + 资源隔离 | 工作区 = 工具要操作的目录（更像「当前文件夹」而非组织维度） |

结论：这是两者差距最大的模块。Penguin 把 Workspace 做成了**会话组织 + 记忆边界 + 项目分割**的枢纽概念；天枢的 session 表虽已预留 `workspace/workspaces` 字段，但 UI 与产品层还没把它立起来。

---

## 5. 记忆（Memory）

| 方面 | PenguinHarness | 天枢 |
|---|---|---|
| 存储形态 | 文件即记忆：**MEMORY.md**（每文件一个条目，frontmatter 元数据，正文 Markdown），分 **user scope**（每个会话都读）+ **每 Workspace 一组**（按 `.workspace` 路径标签、最新活动排序） | 每角色 **3 个文件**：`soul.md`（魂/系统人格）、`user.md`(用户设定)、`memory.md`(运行时记忆)；CharacterDetailPage 记忆 tab 直接编辑 |
| 开关/配置 | Memory **总开关**（即时写，不进 tab 保存）；关掉=不进上下文、不建目录，但文件保留 | `CharacterMemory { enabled, selfEvolution, charLimit, maxEntries }`：启用记忆 + **自进化** + 字符上限 |
| 写入方式 | **不直接编辑文件**：bridge 模态 = 文本框 + 生成 prompt 实时预览 → 跳去新会话让 Agent 自己改记忆（workspace scope 的 draft 会钉住对应工作区） | 用户在角色设置里手工改 memory.md / soul.md |
| 变更可见性 | 聊天侧 **Memory 侧面板**：两 scope 话题列表 + 本会话改过的条目打标；每轮 turn 后展示 **memory-changes 卡**；删除同步清 MEMORY.md 索引行 | 无变更流；记忆更新仅存在于角色文件内，需手动开设置查看 |
| 版本/迁移 | Agent State 快照导出/导入，组级 export/import（任何成员可下载、owner 可写回） | revision-store（记忆版本/回退）、asset 生命周期 GC |
| 上下文注入 | 记忆作为上下文的一部分进入每次会话（User scopes 全部 + 会话所属 Workspace scope） | 记忆/魂/用户设定在 context-builder 组装（`presence-projector` 投影） |
| 进化 | 记忆靠 Agent 自我维护（自进化引擎的产物之一是记忆条目） | `selfEvolution` + 离线挖掘 offlineMiner / 洞察提取 / 技能生成写回记忆 |

差异本质：Penguin 的记忆是**运行时自我维护的上下文资产**（Agent 自己改、会话可见变化、按工作区隔离），天枢的记忆是**角色人格的静态配置**（人工设定、随角色永久生效）。Penguin 的「桥接式写入」（对话框→新会话让 Agent 改记忆）和「变更卡」是天枢可以借鉴的两处亮点；天枢的 selfEvolution 开关则是 Penguin 用户需要靠记忆目录约定手动达到的能力（虽然 penguin 有 agent-optimization/benchmark 引擎）。

---

## 6. 综合结论与建议

### 6.1 设计哲学一句话
- **PenguinHarness**：快速原型的“工厂”式世界——对象（Agent/Workspace/Memory/Skill）都可枚举、可管理、可分组、可快照、可评测；侧边栏是管理控制台。
- **天枢**：“星阁”式世界——一切收敛到「角色」这个复合对象上，侧边栏是人格入口；管理深度藏在角色详情，非对象化、但更聚焦体验（立绘/动效/事件/市场）。
- 轨迹在两侧都是**会话级观察窗**，说明这是双方共识的正确形态。

### 6.2 天枢可借鉴（按性价比排序）
1. **工作区晋升为会话组织维度**：session 表已预留 `workspace/workspaces`，加一个「按工作区分组」的会话列表模式（对齐 Penguin 默认模式）成本低、收益明显。
2. **记忆变更可见性**：在轨迹/消息流里加「本轮记忆变更卡」（对齐 memory-changes-card），让「星官觉醒/自进化」可感知。
3. **桥接式记忆写入**：角色设置里点击「让 TA 自己更新记忆」→ 开一个带任务的新会话，由角色自己改 memory.md（对齐 bridge modal），比手写记忆文件自然。
4. （可选）在导航组外放一个「评估中心」页，把已存在的 evolution/trajectoryStore 的 success_rate 数据可视化，对应 Penguin 的 benchmark。

### 6.3 Penguin 可借鉴天枢
- 「角色」复合模型对 C 端更友好（一个对象管完人格+记忆+工具），Penguin 的 8-tab 设置页更适合开发者而不适合普通用户。
- 事件化任务（带徽标、定时触发）和“市场/知识库”入口是 Penguin 侧边栏没有的产品力。

---

## 附：核验依据（文件级）

- Penguin：`packages/web/src/components/layout/sidebar.tsx`、`lib/nav-group-collapse.ts`(NAV_GROUP_KEYS)、`router.tsx`（路由）、`features/agents/{agents-page,agent-settings-page,memory-tab}.tsx`、`features/chat/{memory-nav,memory-view,memory-changes-card}.tsx`、`features/traces/{trace-panel,trace-file-view,timeline-chart}.tsx`、`components/ui/icons.tsx`(NAV_ICONS)
- 天枢：`web/client/src/App.tsx`（navItems+路由）、`pages/CharactersPage.tsx`、`pages/CharacterDetailPage.tsx`（6 tabs）、`features/trajectory/{trajectory.ts,TrajectoryView.tsx}`、`api/workspace.ts`、`web/server/src/db/sessionStore.ts`（workspace 字段）、`web/server/src/db/characterStore.ts`（CharacterRecord/CharacterMemory）、`web/server/src/agent/workspace-approval.ts`、`web/server/src/evolution/storage/trajectoryStore.ts`