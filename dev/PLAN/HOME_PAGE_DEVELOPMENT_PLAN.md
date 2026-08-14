# 天枢极简首页开发计划

> 目标读者：直接接手实现的 OpenCode / Codex。
>
> 本文仅描述开发方案，不包含业务代码修改。
>
> 视觉原型：`homepage-card-prototype.html`。

## 1. 产品结论

首页采用极简信息架构，只承担“回到最近对话”的职责，不承担新建任务、系统监控或模块导航职责。

最终页面只包含：

1. 页面中央的首页标题。
2. 最近更新的 3 个普通对话卡片。
3. “查看全部会话”入口。

标题文案属于主题内容。内置主题使用默认标题；每个自定义主题可以在主题工作台中保存自己的首页标题。切换主题后，首页标题应立即同步更新，无需刷新页面。

## 2. 明确范围

### 2.1 首版必须完成

- 使用真实会话数据替换 `HomePage.tsx` 中全部硬编码占位数据。
- 首页标题水平居中，并在主内容区域形成清晰但克制的视觉焦点。
- 展示按 `updated_at` 倒序排列的最近 3 个普通对话。
- 点击对话卡片跳转到 `/chat/:sessionId`。
- 点击“查看全部会话”跳转到 `/chat`。
- 自定义主题工作台增加“首页标题”编辑项，并在首页预览中实时展示。
- 自定义主题保存、编辑、复制和重新应用时保留首页标题。
- 保持浅色、深色、自定义主题以及带背景图主题下的可读性。
- 提供加载、空数据和请求失败状态，不展示虚构卡片。
- 桌面端三列展示；窄窗口自动降为单列。

### 2.2 明确不做

- 首页任务输入框。
- 快捷操作或任务模板。
- 系统状态。
- 常用角色。
- 最近使用的技能或能力。
- “继续工作”、运行进度、目标、审批、失败任务等状态面板。
- 今日自动任务或事件摘要。
- 项目统计、会话统计、Token 统计。
- 首页内直接新建会话。
- 首页标题的独立字号、颜色、对齐方式配置；这些继续由主题 Token 和固定首页布局控制。

左侧应用导航保持现状，不属于本次首页改造范围。

## 3. 页面结构

```text
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│                早上好，今天想推进什么？                       │
│                                                              │
│  最近对话                                  查看全部会话 →     │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │ 角色 · 时间   │  │ 角色 · 时间   │  │ 角色 · 时间   │       │
│  │ 会话标题      │  │ 会话标题      │  │ 会话标题      │       │
│  │ 最近消息摘要  │  │ 最近消息摘要  │  │ 最近消息摘要  │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

主区域允许保留大量留白。标题和卡片组整体在可用高度内视觉居中，不能为了填满页面增加其他内容。

### 3.1 标题

- 默认值：`早上好，今天想推进什么？`
- 文案来自当前实际生效的主题，而不是主题选择模式。
- `system`、`tianshu-light`、`tianshu-dark` 均使用默认值。
- 自定义主题未设置标题、标题为空或数据损坏时回退默认值。
- 最大长度为 60 个 Unicode 字符；保存前去除首尾空白和控制字符。
- 页面使用语义化 `<h1>`，不允许通过 `content` CSS 属性注入文字。

### 3.2 最近对话卡片

每张卡片展示：

- 角色头像或文字回退头像。
- 角色名称；角色数据不可用时显示 `Agent`。
- 相对更新时间，例如“刚刚”“10 分钟前”“昨天”或本地日期。
- 会话标题；空标题回退 `新会话`。
- 最近一条用户或助手消息的纯文本摘要；无消息时显示 `暂无消息`。

卡片不展示：模型名、Token、工作目录、运行状态、进度条和操作菜单。

卡片整体为单一可点击区域。鼠标、键盘和触控行为一致，焦点态必须清晰可见。

### 3.3 查看全部会话

- 使用真实链接或 `navigate('/chat')`，目标固定为 `/chat`。
- 不打开新窗口。
- 不在首页展开更多卡片。

## 4. 数据方案

### 4.1 当前基础

- `web/client/src/api/sessions.ts` 已提供 `fetchSessions()`。
- `web/server/src/db/sessionStore.ts` 的 `list()` 已按 `updated_at DESC` 排序。
- 当前会话摘要不包含最后一条消息文本。
- `web/client/src/api/characters.ts` 已提供 `fetchCharacters()`；首页可以复用角色名称和角色渲染能力。

直接对 3 个会话分别调用消息详情接口会形成 N+1 请求，因此首页不采用该方案。

### 4.2 新增最近会话接口

新增：

```http
GET /api/sessions/recent?limit=3
```

规则：

- `limit` 默认 `3`，限制在 `1..10`。
- 只返回 `session_type = 'chat'` 的普通对话，排除事件自动创建的会话。
- 包含分支会话；只要用户最近与该分支交互，它就属于最近对话。
- 按 `sessions.updated_at DESC` 排序。
- 使用单次数据库查询或固定次数查询取得最近消息摘要，不允许逐会话请求数据库。
- 最近消息只考虑 `user` 和 `assistant`，忽略工具消息。
- 摘要在服务端转换为单行纯文本、压缩连续空白并截断到 120 个 Unicode 字符。

建议返回类型：

```ts
export interface RecentSessionSummary extends SessionSummary {
  last_message_preview: string | null
}
```

角色名称不必耦合进会话 SQL。前端并行调用 `fetchRecentSessions(3)` 与 `fetchCharacters()`，按 `character_id` 建立映射；角色列表失败不应阻塞会话卡片显示。

### 4.3 数据更新策略

- 首页挂载时拉取一次最近对话。
- 用户从会话页返回首页时组件重新挂载并刷新。
- 首版不轮询、不新增 WebSocket 订阅。
- 请求进行中显示 3 个尺寸固定的骨架卡片，避免布局跳动。

## 5. 自定义主题标题契约

### 5.1 数据模型

在主题定义中增加可选的结构化首页配置：

```ts
export interface ThemeHome {
  title: string
}

export interface ThemeDefinition {
  // 现有字段保持不变
  home?: ThemeHome
}
```

服务端 `ThemeRecord` 同样增加：

```ts
home?: {
  title: string
}
```

这是向后兼容的可选字段，现有主题文件无需迁移，`schemaVersion` 首版继续保持 `1`。旧主题缺少 `home` 时使用默认标题。

服务端必须校验：

- `home` 只能是对象。
- `title` 只能是字符串。
- 去除控制字符并 `trim()`。
- 空字符串按“未设置”处理，不写入记录或在读取时回退默认值。
- 截断到最多 60 个 Unicode 字符。
- 不允许存储 HTML，前端始终以 React 文本节点渲染。

### 5.2 API 传输

更新以下客户端类型和 multipart 数据：

- `ThemeDto.home`
- `CreateThemeInput.home`
- `themeFormData()` 增加 `home` JSON 字段
- `toThemeDefinition()` 映射 `home`

服务端主题路由解析 `home`，并由主题 Store 完成创建、更新和复制时的持久化。复制主题必须复制首页标题；重命名主题不改变首页标题。

### 5.3 主题工作台

`ThemeStudio` 增加“首页标题”文本输入框：

- 放在主题名称之后、图片与色板设置之前。
- 输入时实时更新首页预览中的 `<h1>`。
- 字符计数显示 `当前长度 / 60`。
- 纳入 `StudioSnapshot`、撤销/重做、`cloneSnapshot()` 和 `snapshotEquals()`。
- 新建主题默认填入默认标题。
- 编辑旧主题时显示默认标题，但只有保存后才写入 `home.title`。

## 6. 主题运行时接入

定义共享常量：

```ts
export const DEFAULT_HOME_TITLE = '早上好，今天想推进什么？'
```

建议放在 `themeDefinitions.ts`，避免首页、工作台和服务端各自维护不同默认文案。服务端如需默认值只做校验，不主动写默认标题。

`applyResolvedTheme()` 在应用主题时，同时把解析后的标题写入根节点安全属性：

```ts
root.dataset.homeTitle = resolved.theme.home?.title || DEFAULT_HOME_TITLE
```

同时新增读取函数：

```ts
export function appliedHomeTitle(root?: HTMLElement | null): string
```

首页初始化时调用 `appliedHomeTitle()`，并监听现有 `tianshu:theme-changed` 事件。事件触发后重新读取标题。这样可覆盖：

- 主题选择切换。
- 自定义主题首次异步加载完成。
- 系统浅色/深色切换。
- 主题工作台保存后重新应用。

不要把标题写入 CSS 变量，也不要让 `HomePage` 自行重复解析主题选择和主题列表。

## 7. 前端组件设计

建议组件拆分：

```text
HomePage
├── HomeHeadline
└── RecentSessions
    ├── RecentSessionCard × 3
    ├── RecentSessionsSkeleton
    ├── RecentSessionsEmpty
    └── RecentSessionsError
```

首版组件较小，可以全部放在 `HomePage.tsx`；只有单文件明显过长时再拆到 `features/home/`。不要为三个卡片引入新的全局状态库。

### 7.1 HomePage 状态

```ts
type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; sessions: RecentSessionSummary[] }
  | { status: 'error' }
```

使用局部 `useState/useEffect` 即可。卸载时通过布尔标记或 `AbortController` 避免过期请求回写。

### 7.2 导航

- 卡片：`navigate(`/chat/${encodeURIComponent(session.id)}`)`。
- 查看全部：`navigate('/chat')`。
- 不在点击卡片前修改 `chatStore.activeSessionId`；`ChatPage` 按路由参数完成加载，保持单一入口。

## 8. 样式规范

所有类名使用 `home-` 前缀，避免与会话页现有卡片样式冲突。

### 8.1 布局

- 主内容宽度上限建议 `980px`。
- 标题与卡片组作为整体在内容区视觉居中。
- 桌面端卡片 `repeat(3, minmax(0, 1fr))`。
- 小于约 `880px` 时改为单列。
- 保持宽松留白，不增加装饰性统计或占位区块。

### 8.2 主题 Token

仅使用现有语义变量：

- `--theme-surface-1`
- `--theme-surface-hover`
- `--theme-border`
- `--theme-text-primary`
- `--theme-text-secondary`
- `--theme-text-muted`
- `--theme-accent`
- `--theme-accent-soft`
- `--theme-focus-ring`
- `--theme-shadow-color`

不得在新首页 CSS 中写死暖金色、浅色背景或白色卡片。原型中的颜色仅表达视觉方向，业务实现必须由主题 Token 驱动。

### 8.3 卡片交互

- 默认：轻边框、主题表面色、低强度阴影。
- Hover：轻微上移，边框转强调色。
- Focus-visible：使用 `--theme-focus-ring`，不能只依赖 Hover。
- 卡片标题单行省略；摘要最多两行省略。
- `prefers-reduced-motion: reduce` 下关闭位移动画。

## 9. 空状态与异常处理

### 9.1 无会话

标题保持显示。卡片区域显示：

```text
暂无最近会话
前往会话页开始 →
```

不要自动创建会话，也不要显示三张空卡片。

### 9.2 请求失败

显示简短提示“最近会话加载失败”，提供“重试”和“查看全部会话”两个操作。失败不得影响标题和导航。

### 9.3 角色数据失败

会话卡片仍正常显示，头像使用 `character_id` 的首字符或通用图形，名称回退为 `Agent`。

### 9.4 自定义标题损坏

客户端类型规范化和主题运行时均回退 `DEFAULT_HOME_TITLE`，不得让首页出现空白标题、`undefined` 或原始 HTML。

## 10. 文件改造清单

### 10.1 前端

- `web/client/src/pages/HomePage.tsx`
  - 删除全部硬编码角色、项目、模型、输入框和快捷操作。
  - 接入真实最近会话、主题标题与导航。
- `web/client/src/index.css`
  - 删除或替换旧 `.home-*` 占位样式。
  - 新增极简标题和三卡片响应式样式。
- `web/client/src/api/sessions.ts`
  - 增加 `RecentSessionSummary` 和 `fetchRecentSessions()`。
- `web/client/src/features/theme/themeDefinitions.ts`
  - 增加 `ThemeHome`、`home` 和 `DEFAULT_HOME_TITLE`。
- `web/client/src/features/theme/themeApi.ts`
  - 增加 `home` 的 DTO、FormData 和映射。
- `web/client/src/features/theme/themeRuntime.ts`
  - 应用并读取当前首页标题。
- `web/client/src/features/theme/ThemeStudio.tsx`
  - 增加标题编辑、历史状态、保存和实时预览。

### 10.2 服务端

- `web/server/src/db/sessionStore.ts`
  - 增加最近普通会话及最后消息摘要查询。
- `web/server/src/routes/sessions.ts`
  - 增加 `GET /recent`，并放在可能冲突的动态参数路由之前。
- `web/server/src/theme/schema.ts`
  - 增加 `home.title` 类型、清洗、解析和构建。
- `web/server/src/theme/store.ts`
  - 创建、更新和复制时保留 `home`。
- `web/server/src/routes/themes.ts`
  - 解析 multipart `home` 字段。

## 11. 测试计划

### 11.1 服务端单元测试

最近会话查询：

- 按 `updated_at` 倒序返回。
- 最多返回指定数量。
- 排除 `session_type = 'event'`。
- 包含最近分支会话。
- 忽略工具消息。
- 消息摘要压缩换行和连续空白。
- Unicode 截断不切坏代理对。
- 没有消息时返回 `null`。

主题 Schema：

- 旧版无 `home` 的主题仍能加载。
- 合法标题完整往返。
- 标题首尾空白被清理。
- 空标题回退默认值。
- 超长标题被限制到 60 个 Unicode 字符。
- 控制字符和 HTML 仅作为普通文本处理，不进入 DOM HTML。
- 复制主题保留标题。

### 11.2 前端单元/组件测试

- 加载时显示三个骨架卡片。
- 成功时最多显示三个会话。
- 点击卡片导航到对应会话路由。
- “查看全部会话”导航到 `/chat`。
- 空状态和失败状态正确。
- 角色接口失败时卡片仍显示。
- 主题切换事件后标题立即变化。
- 无主题标题时使用默认值。
- Theme Studio 修改标题后预览立即变化。
- Theme Studio 撤销、重做和保存包含标题。

### 11.3 人工验收

- 浅色、深色和至少一个带背景图的自定义主题。
- 1920、1366、1024 和窄窗口布局。
- 长会话标题、长角色名、中文和英文消息摘要。
- 键盘 Tab 可到达三张卡片与“查看全部会话”。
- 开启“减少动态效果”后无卡片位移动画。
- 连续切换多个主题，标题不滞后、不闪回默认值。

## 12. 实施顺序

### 阶段一：数据与契约

1. 增加最近会话查询和接口。
2. 增加主题 `home.title` 服务端契约。
3. 增加客户端主题类型与 API 映射。
4. 完成数据层和 Schema 单元测试。

### 阶段二：主题工作台

1. 将首页标题加入 `StudioSnapshot`。
2. 增加编辑输入和实时预览。
3. 接入保存、编辑、复制和运行时应用。
4. 完成主题运行时与工作台测试。

### 阶段三：首页

1. 重写 `HomePage.tsx`。
2. 替换旧首页 CSS。
3. 接入最近会话、角色映射和导航。
4. 完成加载、空状态、失败状态和响应式布局。

### 阶段四：集成验收

1. 运行客户端与服务端测试。
2. 运行生产构建。
3. 按人工验收矩阵检查关键主题和窗口尺寸。
4. 执行 `graphify update .` 更新代码知识图谱。

## 13. 完成标准

满足以下全部条件才算完成：

- 首页除标题、最近三个对话和“查看全部会话”外没有其他业务区域。
- 页面不再包含任何硬编码角色、会话、模型或项目数据。
- 最近对话来自真实接口，排序和过滤正确。
- 所有入口导航正确。
- 自定义主题可以编辑并持久化自己的首页标题。
- 切换主题后标题立即更新。
- 旧自定义主题无需迁移即可正常加载。
- 加载、空数据、接口失败和角色失败均有稳定回退。
- 浅色、深色、自定义主题和窄窗口均可读、可操作。
- 自动化测试与生产构建通过。

