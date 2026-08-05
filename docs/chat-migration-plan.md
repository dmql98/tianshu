# 天枢前端迁移文档 — 聊天页面

> 本文档供实施对话使用，包含项目背景、新旧前端对比、后端接口分析、以及聊天页面的完整迁移计划。

---

## 一、项目概览

天枢（Tianshu）是一款国风星官 AI 桌面端，核心特色是星官角色系统、事件驱动机制、工具系统和技能系统。

### 目录结构

```
TianShu/dev/web/
├── server/          ← 后端（Hono + Socket.IO + SQLite）
│   ├── src/
│   │   ├── index.ts          ← 入口，路由注册，Socket.IO 初始化
│   │   ├── routes/           ← REST API 路由
│   │   │   ├── characters.ts ← 角色 CRUD + 重命名
│   │   │   ├── sessions.ts   ← 会话 CRUD
│   │   │   ├── providers.ts  ← 模型服务商管理
│   │   │   ├── skills.ts     ← 技能管理
│   │   │   ├── tools.ts      ← 工具管理
│   │   │   ├── workspace.ts  ← 工作区路径浏览
│   │   │   ├── events.ts     ← 事件管理
│   │   │   ├── evolution.ts  ← 进化配置
│   │   │   └── prompts.ts    ← 提示词模板
│   │   ├── ws/chat.ts        ← Socket.IO 聊天处理
│   │   ├── agent/            ← AI 代理循环
│   │   ├── tools/            ← 工具系统（8 个内置 + MCP）
│   │   ├── db/               ← 数据库（characterStore, toolStore）
│   │   ├── character/        ← 角色内容存储（soul, user, memory, prompt）
│   │   ├── llm/              ← LLM 调用
│   │   ├── providers/        ← 模型服务商适配
│   │   ├── event/            ← 事件调度
│   │   ├── evolution/        ← 进化引擎
│   │   └── scheduler/        ← 定时任务
│   └── data/                 ← 数据目录
│       └── characters/{id}/  ← 每个角色一个目录
│           ├── character.json ← 元数据
│           ├── soul.md        ← 人格
│           ├── user.md        ← 用户画像
│           ├── memory.md      ← 记忆
│           └── prompt.md      ← 自定义提示词
│
├── client/          ← 新前端（React 18 + Zustand + react-router-dom）
│   └── src/
│       ├── App.tsx            ← 路由配置（react-router）
│       ├── main.tsx           ← 入口（BrowserRouter）
│       ├── api/               ← API 调用层
│       │   ├── client.ts      ← fetch 封装（apiGet/apiPost/apiPut/apiDelete）
│       │   ├── characters.ts  ← 角色 API
│       │   ├── sessions.ts    ← 会话 API
│       │   ├── providers.ts   ← 服务商 API
│       │   ├── skills.ts      ← 技能 API
│       │   ├── tools.ts       ← 工具 + MCP API
│       │   ├── events.ts      ← 事件 API
│       │   ├── socket.ts      ← Socket.IO 连接
│       │   ├── workspace.ts   ← 工作区 API
│       │   ├── evolution.ts   ← 进化 API
│       │   └── prompts.ts     ← 提示词 API
│       ├── stores/            ← Zustand 状态管理
│       │   ├── chatStore.ts   ← 聊天状态（目前较简单）
│       │   ├── charactersStore.ts
│       │   ├── providersStore.ts
│       │   └── uiStore.ts
│       ├── pages/             ← 页面组件（路由入口，re-export views）
│       ├── views/             ← 实际页面逻辑
│       ├── components/        ← 共享组件
│       │   ├── Chat/          ← 聊天相关组件（待充实）
│       │   ├── Layout/        ← 布局组件
│       │   └── Panels/        ← 面板组件
│       ├── types/index.ts     ← TypeScript 类型定义
│       └── index.css          ← 全局样式
│
└── client-old/      ← 旧前端（Vue 3 + Pinia + vue-router）
    └── src/
        ├── stores/chat.ts     ← 完整的聊天 store（会话/消息/流式/审批/工作区）
        ├── api/socket.ts      ← Socket.IO 连接
        ├── api/sessions.ts    ← 会话 API
        ├── components/        ← 20+ 组件
        └── views/             ← 页面视图
```

### 路由表（新前端）

| 路径 | 页面 |
|---|---|
| `/`, `/home` | HomePage |
| `/chat` | ChatPage（含左侧会话面板 + 中间聊天区 + 右侧面板） |
| `/characters` | CharactersPage |
| `/characters/new` | CharacterDetailPage（新建模式） |
| `/characters/:id` | CharacterDetailPage（编辑模式，自动保存） |
| `/skills` | SkillsPage |
| `/skills/packages/:category/:packageId` | SkillPackageDetailPage |
| `/tools`, `/mcp`, `/events`, `/market`, `/knowledge`, `/settings` | 对应页面 |

---

## 二、后端接口分析

### REST API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/sessions` | 获取所有会话列表 |
| POST | `/api/sessions` | 创建会话 |
| GET | `/api/sessions/:id` | 获取单个会话 |
| PUT | `/api/sessions/:id` | 更新会话（标题、工作区等） |
| DELETE | `/api/sessions/:id` | 删除会话 |
| GET | `/api/sessions/:id/messages` | 获取会话消息历史 |
| POST | `/api/sessions/:id/messages/keep` | 保留前 N 条消息（重置） |
| GET | `/api/sessions/:id/children` | 获取子会话 |
| GET | `/api/characters` | 获取所有角色 |
| GET | `/api/characters/:id` | 获取单个角色 |
| POST | `/api/characters` | 创建角色（body 可含 id，服务端查重） |
| PUT | `/api/characters/:id` | 更新角色（body 含 id 则重命名） |
| DELETE | `/api/characters/:id` | 删除角色 |
| GET | `/api/characters/:id/stats` | 获取角色统计（会话数、最近活跃） |
| GET | `/api/providers` | 获取所有服务商 |
| POST | `/api/providers` | 添加服务商 |
| PUT | `/api/providers/:id` | 更新服务商 |
| DELETE | `/api/providers/:id` | 删除服务商 |
| GET | `/api/providers/:id/models` | 获取服务商的模型列表 |
| GET | `/api/skills/packages` | 获取技能包列表 |
| GET | `/api/skills/packages/:category/:packageId` | 获取技能包详情 |
| GET | `/api/tools` | 获取工具列表（内置 + MCP） |
| POST | `/api/tools/mcp` | 创建 MCP 服务器 |
| PUT | `/api/tools/mcp/:id` | 更新 MCP 服务器 |
| DELETE | `/api/tools/mcp/:id` | 删除 MCP 服务器 |
| POST | `/api/tools/mcp/:id/test` | 测试 MCP 连接 |
| GET | `/api/workspace/list` | 浏览工作区目录 |
| GET | `/api/events` | 获取事件列表 |
| GET | `/health` | 健康检查 |

### Socket.IO 事件

**客户端 → 服务端：**

| 事件 | 数据 | 说明 |
|---|---|---|
| `chat-run` | `{ session_id, character_id, input, attachments?, model?, provider_id?, workspace?, workspaces?, active_group?, session_type?, event_id?, thinking?, reasoning_effort? }` | 发送消息并触发 AI 运行 |
| `strategy.set` | `{ session_id, strategy }` | 切换执行策略（Plan/Ask/Bypass） |
| `approval.respond` | `{ session_id, tool_call_id, choice }` | 审批响应（once/always/reject） |
| `abort` | `{ session_id }` | 中止当前运行 |

**服务端 → 客户端：**

| 事件 | 数据 | 说明 |
|---|---|---|
| `run.started` | `{ session_id, context_window? }` | 运行开始 |
| `message.delta` | `{ session_id, delta?, reasoning? }` | 流式文本增量 |
| `tool.started` | `{ session_id, tool_name, tool_input, tool_call_id }` | 工具调用开始 |
| `tool.output` | `{ session_id, tool_call_id, output }` | 工具输出增量 |
| `tool.completed` | `{ session_id, tool_call_id, tool_status, tool_output }` | 工具调用完成 |
| `run.completed` | `{ session_id, cache? }` | 运行完成（含缓存统计） |
| `run.failed` | `{ session_id, error }` | 运行失败 |
| `run.compacted` | `{ session_id }` | 上下文已压缩 |
| `strategy.updated` | `{ session_id, strategy }` | 策略已更新 |
| `sub_agent.started` | `{ session_id, sub_session_id, target_character_id, task }` | 子代理启动 |
| `approval.requested` | `{ session_id, tool_call_id, tool_name, tool_input }` | 请求审批 |
| `session:new` | `{ sessionId, title, isEvent }` | 新会话（事件创建） |
| `event:status_changed` | `{ eventId, status, result_summary?, error? }` | 事件状态变更 |
| `evolution:insight_created` | `{ session_id, insight_type, description, notify_enabled, notify_timeout }` | 进化洞察 |
| `workspace.updated` | `{ session_id, workspaces }` | 工作区更新 |
| `usage` | `{ session_id, input_tokens, output_tokens, usage_type }` | Token 用量 |

---

## 三、旧前端聊天页面分析

### 核心 Store（chatStore）

旧前端的 `chatStore` 是聊天功能的核心，管理以下状态：

**状态：**
- `sessions: Session[]` — 所有会话
- `activeSessionId: string | null` — 当前活跃会话 ID
- `activeSession: Session` — 当前会话（computed）
- `isStreaming: boolean` — 是否正在流式输出
- `pendingApproval` — 待审批的工具调用
- `currentStrategy: Strategy` — 当前策略
- `workspaceGroups: WorkspaceGroup[]` — 按工作区分组的会话（computed）
- `attachments` — 待发送的附件列表
- `tokenUsage` — token 用量统计
- `contextUsage` — 上下文窗口用量（computed）
- `toolExpandAll` — 工具详情全局展开/折叠
- `isBatchMode` / `selectedSessionIds` — 批量操作模式
- `evolutionNotification` — 进化通知

**Session 结构：**
```typescript
interface Session {
  id: string
  character_id: string
  title: string
  messages: Message[]
  model?: string
  provider_id?: string
  workspace?: string
  workspaces?: string[]      // 多工作区支持
  pinned?: boolean           // 收藏
  thinking?: boolean         // 思考模式
  reasoning_effort?: string  // 推理力度
  current_strategy?: Strategy
  parent_id?: string         // 父会话（子代理）
  active_group?: string
  session_type?: 'chat' | 'event'
  event_id?: string | null
  context_window?: number | null
  compacted?: boolean        // 已压缩
  cacheStats?: { hitTokens, missTokens, hitRatio }
  created_at: number
  updated_at: number
}
```

**Message 结构：**
```typescript
interface Message {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  attachments?: { name: string; mime: string; dataUrl?: string }[]
  tool_name?: string
  tool_input?: string
  tool_output?: string
  tool_call_id?: string
  tool_status?: 'running' | 'done' | 'success' | 'error'
  is_streaming?: boolean
  reasoning?: string
  reasoning_duration?: number
  timestamp: number
}
```

**关键方法：**
- `createSession(opts)` — 创建会话（自动从 localStorage 恢复上次的 character_id、model、provider_id、workspace）
- `switchSession(id)` — 切换会话（加载消息历史）
- `sendMessage(input)` — 发送消息（创建会话 → 推送用户消息 → socket.emit('chat-run') → 注册流式监听）
- `setStrategy(strategy)` — 切换策略
- `respondApproval(choice)` — 审批响应
- `abortRun()` — 中止运行
- `resetToMessage(sessionId, messageId)` — 重置到某条消息
- `renameSession(id, title)` — 重命名会话
- `deleteSingleSession(id)` — 删除会话（含子会话）
- `addWorkspace(path)` / `removeWorkspace(path)` — 工作区管理
- `batchDeleteSessions()` — 批量删除

### 组件清单

| 组件 | 文件 | 功能 |
|---|---|---|
| ChatView | views/ChatView.vue | 路由级页面，根据 URL 切换会话 |
| ChatArea | components/ChatArea.vue | 聊天区域容器（消息列表 + 输入 + 审批弹窗） |
| MessageList | components/MessageList.vue | 消息列表，自动滚动到底部 |
| MessageItem | components/MessageItem.vue | 单条消息渲染（user/assistant/tool 三种样式） |
| ChatInput | components/ChatInput.vue | 输入框（斜杠命令、拖拽调高、上下文引用） |
| InputToolbar | components/Chat/InputToolbar.vue | 输入上方工具栏（角色/模型/策略/思考/工作区/附件） |
| CharacterSelector | components/Chat/CharacterSelector.vue | 弹窗式角色选择器（搜索/分组） |
| ModelSelector | components/Chat/ModelSelector.vue | 下拉式模型选择器（按 Provider 分组） |
| StrategyIndicator | components/Chat/StrategyIndicator.vue | 策略状态条 |
| StrategyToggle | components/Chat/StrategyToggle.vue | 策略切换下拉 |
| ThinkingBlock | components/ThinkingBlock.vue | 可折叠的思考过程块 |
| ToolDetail | components/ToolDetail.vue | 工具调用详情（状态/输入/输出） |
| TokenBar | components/TokenBar.vue | Token 用量统计（SVG 环形图 + 条形图） |
| ConfigBar | components/ConfigBar.vue | 配置栏（角色/模型/工作区） |
| SessionList | components/SessionList.vue | 简单会话列表 |
| Sidebar | components/Sidebar.vue | 完整侧边栏（搜索/过滤/分组/批量操作） |
| WorkspacePicker | components/WorkspacePicker.vue | 目录浏览器选择器 |
| ApprovalDialog | components/ApprovalDialog.vue | 工具审批弹窗 |
| SidePanel | components/Panels/SidePanel.vue | 右侧面板容器（文件/大纲标签页） |
| FilesPanel | components/Panels/FilesPanel.vue | 工作区文件浏览器 |
| OutlinePanel | components/Panels/OutlinePanel.vue | 消息大纲（标题提取 + 点击跳转） |

---

## 四、新前端当前状态

### ChatPage.tsx — 纯静态 demo

当前 `ChatPage.tsx` 是一个静态页面，所有数据硬编码：
- 左侧会话面板（ctx-panel）：硬编码的项目树和会话列表
- 中间聊天区：硬编码的 6 条示例消息（2 条用户 + 4 条星官）
- 右侧面板（right-panel）：硬编码的星官详情

**没有任何数据绑定、API 调用或 socket.io 连接。**

### App.tsx 中的聊天路由

App.tsx 的 `/chat` 路由是更大的静态 demo（~170 行 JSX），包含：
- `showRightPanel` / `showFilePanel` 状态控制面板显示
- 右侧面板和文件面板的完整 HTML
- 同样是硬编码数据

### 新前端已有的 store 和 API

| 文件 | 状态 | 说明 |
|---|---|---|
| stores/chatStore.ts | 简单 | 基础会话管理，缺少旧前端的大部分功能 |
| stores/providersStore.ts | 可用 | 服务商管理 |
| api/socket.ts | 可用 | Socket.IO 连接基础 |
| api/sessions.ts | 可用 | 会话 API 调用 |
| api/characters.ts | 完整 | 角色 API（含 create/update/delete） |
| api/tools.ts | 完整 | 工具 + MCP API |
| api/skills.ts | 完整 | 技能 API |

---

## 五、demo HTML 参考

demo 文件位于 `TianShu/开发/demo/chat.html`，是聊天页面的视觉和交互参考。

### demo 中的关键交互

1. **星官切换** — `switchStar(starId)` 切换当前星官，更新头像、placeholder、右侧面板
2. **路由动画** — `showRoute('紫微遣 · 天璇执码')` 显示流星条，4 秒后消失
3. **消息渲染** — `addMessage(role, starId, content)` 动态添加消息
4. **思考块** — `addThinking(starId, content)` 添加思考过程
5. **工具调用** — `addToolCall(starId, toolName, status, detail, preview)` 添加工具调用（可展开详情）
6. **发送消息** — `sendMessage()` 发送用户消息 + 检测 @提及 触发星官切换
7. **面板 toggle** — 右侧面板、文件面板、左侧会话面板的展开/收起
8. **审批弹窗** — `approval-overlay` 工具权限申请（拒绝/仅本次/始终允许）
9. **星官头像动画** — `frames/` 目录下的逐帧动画（200 帧，42ms 间隔）
10. **右侧面板** — 动态渲染星官详情、运行配置、工作区（可增删）、运行状态、知识库、能力、统计

### demo CSS 变量

```css
:root {
  --bg-main: #f5f0e8;
  --bg-card: #ede6da;
  --bg-hover: #e0d8cc;
  --bg-input: #faf8f4;
  --border: rgba(180,160,130,0.15);
  --border-light: rgba(180,160,130,0.08);
  --gold: #c8960a;
  --gold-light: #f5d68a;
  --jade: #2a9d5c;
  --cinnabar: #c45c3c;
  --ink-deep: #2c2418;
  --ink-mid: #5c5040;
  --ink-light: #8a7d68;
  --ink-faint: #b8a890;
  --star-changgeng: #c8960a;
  --star-tianxuan: #2563eb;
  --star-wenqu: #059669;
  --star-ziwei: #7c3aed;
}
```

---

## 六、聊天页面迁移计划

### 6.1 数据层

#### chatStore（重写）

基于旧前端的 chatStore 重写为 Zustand 版本，保留所有核心功能：

```typescript
interface ChatStore {
  // 状态
  sessions: Session[]
  activeSessionId: string | null
  activeSession: Session | null       // derived
  isStreaming: boolean
  pendingApproval: PendingApproval | null
  currentStrategy: Strategy           // derived
  workspaceGroups: WorkspaceGroup[]   // derived
  attachments: Attachment[]
  tokenUsage: TokenUsage
  contextUsage: ContextUsage          // derived
  toolExpandAll: boolean
  isBatchMode: boolean
  selectedSessionIds: Set<string>
  evolutionNotification: EvolutionNotification | null

  // 会话操作
  loadSessions: () => Promise<void>
  createSession: (opts?) => Promise<Session>
  switchSession: (id: string) => Promise<void>
  renameSession: (id: string, title: string) => Promise<void>
  deleteSession: (id: string) => Promise<void>
  resetToMessage: (sessionId: string, messageId: string) => Promise<void>
  toggleSessionStar: (id: string) => void

  // 消息操作
  sendMessage: (input: string) => Promise<void>
  abortRun: () => void
  setStrategy: (strategy: Strategy) => void
  respondApproval: (choice: 'once' | 'always' | 'reject') => void

  // 附件
  addAttachment: (name, mime, data, dataUrl?) => void
  removeAttachment: (idx: number) => void
  clearAttachments: () => void

  // 工作区
  addWorkspace: (path: string) => void
  removeWorkspace: (path: string) => void
  toggleWorkspaceCollapse: (workspace: string) => void

  // 批量操作
  toggleBatchMode: () => void
  toggleSessionSelection: (id: string) => void
  selectAllSessions: () => void
  batchDeleteSessions: () => Promise<void>

  // UI
  toggleAllTools: () => void
}
```

**关键实现要点：**
- `sendMessage` 是核心方法：创建/复用会话 → 推送用户消息 → socket.emit('chat-run') → 注册临时事件监听（message.delta、tool.started/completed、run.completed/failed）→ 运行完成后清理监听
- 区分"持久监听"（sub_agent.started、session:new 等，注册一次）和"临时监听"（每次 sendMessage 注册，完成后清理）
- `switchSession` 需要先清理上一个会话的临时监听
- localStorage 持久化：上次使用的 character_id、model、provider_id、workspace、activeSessionId

#### socket.ts（扩展）

确保 Socket.IO 连接正确初始化，并导出 `connectSocket()` 和 `getSocket()` 方法。

#### sessions.ts（扩展）

确保包含以下 API：
- `fetchSessions()` — 获取会话列表
- `createSession(data)` — 创建会话
- `fetchSessionMessages(id)` — 获取消息历史
- `fetchChildSessions(id)` — 获取子会话
- `renameSession(id, title)` — 重命名
- `deleteSession(id)` — 删除
- `updateSession(id, data)` — 更新（工作区等）
- `keepMessages(id, count)` — 保留前 N 条消息

### 6.2 组件实施

#### 阶段 1：左侧会话面板（SessionPanel）

**文件：** `components/Chat/SessionPanel.tsx`

**功能：**
- 顶部：标题"会话" + 操作按钮
- 搜索框：关键字过滤会话
- "新建会话"按钮
- 会话树：按工作区分组（WorkspaceGroup），可折叠
  - 每个工作区组显示名称 + 会话数
  - 会话项显示：标题、时间、角色 badge、收藏标记
  - 子会话缩进显示（parent_id 关系）
  - 当前活跃会话高亮
- 事件区：分隔线后显示事件类型的会话
- 批量操作模式：长按或多选按钮进入

**依赖：** chatStore（sessions、workspaceGroups、activeSessionId、createSession、switchSession）

#### 阶段 2：聊天区（ChatArea + MessageBubble）

**文件：**
- `components/Chat/ChatArea.tsx` — 容器
- `components/Chat/MessageList.tsx` — 消息列表
- `components/Chat/MessageBubble.tsx` — 单条消息
- `components/Chat/ThinkingBlock.tsx` — 思考块
- `components/Chat/ToolCallTag.tsx` — 工具调用标签
- `components/Chat/MarkdownRenderer.tsx` — markdown 渲染

**MessageBubble 规格：**
- 用户消息：右对齐，金色气泡，底部圆角只保留右下
- 助手消息：左对齐，卡片色气泡 + 边框，底部圆角只保留左下
  - 顶部显示发送者信息：星官图标 + 名字（颜色）+ 职衔
  - 如有 reasoning → 显示 ThinkingBlock（可折叠）
  - 内容用 MarkdownRenderer 渲染
  - 流式输出时显示闪烁光标
- 工具消息：左对齐
  - 显示 ToolCallTag（工具名 + 状态 + 可展开详情）
  - 状态：running（黄）、success（绿）、error（红）
  - 展开后显示工具输入/输出（等宽字体，深色背景）
- 底部：时间戳
- 非流式消息可显示"重置到此处"按钮

**自动滚动：** 新消息到达时自动 scrollTop = scrollHeight

#### 阶段 3：输入区（ChatInput）

**文件：**
- `components/Chat/ChatInput.tsx`
- `components/Chat/InputToolbar.tsx`（可选，第一版可简化）

**功能：**
- 左侧：当前星官头像（可点击切换星官）
- textarea：自动高度（24px-120px）、Enter 发送、Shift+Enter 换行
- 底部工具栏：
  - "+ 附件"按钮（文件选择）
  - "🔓 完全访问"权限指示
- 右下角操作区：
  - 模型选择按钮（显示当前模型名 + ⌄）
  - 发送按钮（金色，⬆ 图标）
- 流式输出时：发送按钮变为中止按钮

**后续增强（可后期做）：**
- 斜杠命令（/plan /ask /bypass）
- @提及 星官
- 上下文引用（@file: @url: @folder:）
- 附件预览（图片缩略图）
- 思考模式开关 + 推理力度

#### 阶段 4：右侧面板（RightPanel）

**文件：** `components/Chat/RightPanel.tsx`

**功能（参考 demo HTML）：**
- 标题栏："星官详情" + 关闭按钮
- 星官立绘卡片（rp-art-card）：立绘图 + 名字 + 职衔 + 描述
- 运行配置（rp-section）：模型服务、模型、策略、角色类型、最大步数
- 项目区：当前工作区路径
- 授权工作区：可增删的工作区路径列表
- 运行状态：上下文用量（进度条）、缓存命中率、当前策略
- 绑定知识库：知识库列表 + 添加按钮
- 能力：技能数、工具数
- 会话统计：消息数、Tokens、工具调用、事件（2x2 网格）

**数据来源：** 当前 activeSession + 对应的 character 数据

#### 阶段 5：文件面板（FilePanel）

**文件：** `components/Chat/FilePanel.tsx`

**功能：**
- 标题栏："文件" + 关闭按钮
- 附件区：当前会话的附件列表
- 输出文件区：工具调用产生的输出文件

#### 阶段 6：审批弹窗（ApprovalDialog）

**文件：** `components/Chat/ApprovalDialog.tsx`

**功能：**
- 遮罩层 + 居中弹窗
- 标题："⚠️ 工作区权限申请"
- 描述：工具名 + 需要访问的路径
- 三个按钮：拒绝（红色描边）、仅本次（灰色）、始终允许（金色填充）

#### 阶段 7：路由动画（RouteBar）

**文件：** `components/Chat/RouteBar.tsx`

**功能：**
- 顶部窄条，金色渐变背景
- 显示路由文案（如"紫微遣 · 天璇执码"）
- 流星动画（从左到右划过）
- 4 秒后自动消失

### 6.3 ChatPage 主布局

**文件：** `pages/ChatPage.tsx`

```
+----------+---------------------------+------------+
| Session  |  input-top-bar            |            |
| Panel    |  +-----------------------+| Right      |
|          |  | ChatArea              || Panel      |
| (220px)  |  |   MessageList         ||            |
|          |  |   ChatInput           || (240px)    |
|          |  +-----------------------+|            |
|          |                           |            |
+----------+---------------------------+------------+
                                            +--------+
                                            | File   |
                                            | Panel  |
                                            | (240px)|
                                            +--------+
```

- 三栏布局：左侧会话面板（220px）+ 中间聊天区（flex:1）+ 右侧面板（240px）
- 文件面板在右侧面板左侧或右侧（可选叠加）
- 左侧面板和右侧面板可展开/收起（CSS transition）
- RouteBar 在聊天区顶部（条件显示）
- ApprovalDialog 全屏遮罩（条件显示）

---

## 七、新前端已有的可复用代码

### API 层（已完整）

- `api/client.ts` — fetch 封装（apiGet/apiPost/apiPut/apiPatch/apiDelete）
- `api/sessions.ts` — 会话 API
- `api/socket.ts` — Socket.IO 连接
- `api/characters.ts` — 角色 API
- `api/providers.ts` — 服务商 API
- `api/tools.ts` — 工具 + MCP API
- `api/skills.ts` — 技能 API

### 类型定义（types/index.ts）

已定义：SessionSummary、Session、Message、Character、Provider、RunEvent、WorkspaceGroup 等。

### 样式（index.css）

已定义的 CSS 类（部分可直接复用）：
- `.msg-group`, `.msg-group.user`, `.msg-group.star` — 消息布局
- `.msg-sender`, `.msg-bubble`, `.msg-time` — 消息元素
- `.thinking-block`, `.th-header` — 思考块
- `.tool-tag`, `.tool-tag.success`, `.tool-tag.error` — 工具标签
- `.input-area`, `.input-main`, `.input-star-avatar`, `.input-box` — 输入区
- `.chat-textarea`, `.input-bottom`, `.input-actions` — 输入元素
- `.send-btn`, `.model-select` — 按钮
- `.right-panel`, `.rp-*` — 右侧面板
- `.file-panel`, `.fp-*` — 文件面板
- `.approval-overlay`, `.approval-dialog`, `.approval-*` — 审批弹窗
- `.ctx-panel`, `.ctx-*` — 左侧会话面板
- `.project-item`, `.session-item`, `.session-dot` — 会话树
- `.route-bar`, `.meteor` — 路由动画

---

## 八、注意事项

1. **Socket.IO 连接**：确保在 chatStore 初始化时建立连接，不要在每次 sendMessage 时重复创建
2. **事件监听清理**：每次 sendMessage 注册的临时监听必须在 run.completed/run.failed 时清理，避免内存泄漏
3. **子会话**：sub_agent.started 事件会创建子会话（parent_id 指向父会话），UI 需要缩进显示
4. **流式更新**：message.delta 事件会频繁触发，直接修改 messages 数组中最后一条消息的 content/reasoning，不要创建新消息
5. **自动滚动**：只在用户已经在底部时自动滚动，如果用户手动上滚了不要强制拉回
6. **会话压缩**：run.compacted 事件标记会话已压缩，UI 可显示提示
7. **工作区路径**：Windows 路径使用反斜杠，注意转义
8. **demo HTML 中的样式**：`index.css` 中已有大部分样式类，直接复用，不要重复定义
9. **react-router**：会话切换可通过 URL 参数（`/chat/:sessionId`）或状态管理实现，建议先用状态管理，后期加 URL 支持
