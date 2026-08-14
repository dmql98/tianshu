# 极简首页阶段交接报告

> 阶段：TianShu 首页改造（HOME_PAGE_DEVELOPMENT_PLAN.md）
> 基线：主题切换阶段（TIANSHU_THEME_HANDOVER.md）已完成
> 日期：2026-08-13

## 1. 修改文件

### 新增
| 文件 | 说明 |
|---|---|
| `web/server/test/recent-sessions.test.ts` | listRecent 单元测试 12 项 + GET /recent API 测试 2 项 |
| `web/client/src/features/home/homeFormat.test.ts` | 相对时间纯函数测试 6 项 |
| `web/client/src/features/theme/themeStudioSnapshot.test.ts` | StudioSnapshot 首页标题（clone/equals）+ 客户端 normalizeHomeTitle 测试 6 项 |

### 修改
| 文件 | 说明 |
|---|---|
| `web/server/src/db/sessionStore.ts` | `sessionStore.listRecent(limit)`：单条 SQL（相关子查询取最近 user/assistant 消息）、`session_type='chat'` 过滤、含分支、`updated_at DESC`、limit 收敛 1..10；`cleanMessagePreview()`（去控制字符→压缩空白→120 Unicode 码点不切代理对→空回退 null） |
| `web/server/src/routes/sessions.ts` | `GET /recent?limit=`（默认 3），放在 `router.get('/')` 之后、全部动态参数路由之前 |
| `web/server/src/theme/schema.ts` | `ThemeHomeSpec`、`HOME_TITLE_MAX=60`、`normalizeHomeTitle()`（去控制字符→trim→60 码点）、`normalizeThemeHome()`（空=未设置）；`ThemeRecord.home` 可选（旧主题无需迁移）；parseThemeRecord/buildThemeRecord 支持 home |
| `web/server/src/theme/store.ts` | `ThemeWriteInput.home`；saveTheme 更新时继承旧 home（未传时保留）；duplicateTheme 展开保留 home |
| `web/server/src/routes/themes.ts` | multipart/JSON `home` 字段解析；themeView 透出 home |
| `web/client/src/features/theme/themeDefinitions.ts` | `ThemeHome`、`DEFAULT_HOME_TITLE`（'早上好，今天想推进什么？'）、`HOME_TITLE_MAX`、`normalizeHomeTitle()`、`normalizeThemeHome()`；`ThemeDefinition.home` 可选；normalizeThemeDefinition 往返保留 |
| `web/client/src/features/theme/themeApi.ts` | `ThemeDto.home`、`toThemeDefinition` 映射 home（空标题过滤）、`CreateThemeInput.home`、`themeFormData()` 追加 home JSON |
| `web/client/src/features/theme/themeRuntime.ts` | `applyResolvedTheme` 写 `root.dataset.homeTitle`（custom 标题 / 内置默认）；新增 `appliedHomeTitle()`（缺失/空白回退默认值） |
| `web/client/src/features/theme/ThemeStudio.tsx` | 主题名称后插入"首页标题"输入框（字符计数 当前/60、placeholder 默认值）；`StudioSnapshot.homeTitle`（初始/取色回退/next 全携带）；cloneSnapshot/snapshotEquals 含 homeTitle；首页预览 `<h1>` 用 homeTitle；保存时非空才写 `home.title` |
| `web/client/src/api/sessions.ts` | `RecentSessionSummary`（extends SessionSummary + `last_message_preview`）、`fetchRecentSessions(limit=3)` |
| `web/client/src/pages/HomePage.tsx` | **整体重写**：删除全部硬编码角色/项目/输入框/快捷操作；`<h1>` 用 `appliedHomeTitle()` + 监听 `tianshu:theme-changed`；最近 3 会话卡片（角色名回退 Agent、相对时间、标题回退新会话、摘要回退暂无消息）；**卡片头像使用 `CharacterRenderer`（mode='avatar'，visualCache 共享请求，角色视觉缺失时 fallback 名称首字符）**；骨架×3/空态/失败态（重试+查看全部）；`navigate('/chat/:id')` 与 `navigate('/chat')`；导出 `formatRelativeTime` |
| `web/client/src/index.css` | 删除旧 `.home-content/.home-slogan/.home-input-*/.home-role-*/.home-project-*` 占位样式；新增极简首页样式（`.home`、`.home-headline`、`.home-card-*`、`.home-state`、骨架、880px 单列、reduced-motion、focus-visible 用 `--theme-focus-ring`），全部使用 `--theme-*` Token |
| `scripts/verify-theme-e2e.mjs` | 创建携带 home → 详情断言 home.title → 重启后 home 保留 |

## 2. 数据方案

- `GET /api/sessions/recent?limit=3`：默认 3，服务端收敛 1..10；只返回 `chat` 会话（排除 event）；含分支；`updated_at DESC`；单条 SQL（相关子查询，无 N+1 API 请求）。
- 摘要：只取最近一条 `user`/`assistant` 消息（忽略工具消息）；服务端 `cleanMessagePreview` 去控制字符、压缩连续空白、截断 120 Unicode 码点（按码点切分，代理对安全）；无消息/清洗后为空 → `null`。
- 首页并行 `fetchRecentSessions(3)` + `fetchCharacters()`；角色映射失败不阻塞卡片（名称回退 `Agent`、头像用 `character.color` 或 `--theme-surface-2` + 名称首字符）。
- 无轮询、无 WebSocket；返回首页时组件重新挂载自动刷新；失败提供"重试"。

## 3. 主题首页标题契约

- 客户端常量 `DEFAULT_HOME_TITLE = '早上好，今天想推进什么？'`（themeDefinitions.ts 唯一来源）；服务端只做校验不写默认值。
- `ThemeDefinition.home.title` / `ThemeRecord.home.title`：可选、向后兼容，旧主题无 `home` 直接加载（schemaVersion 保持 1）。
- 服务端校验：`home` 必须是对象、`title` 字符串；去控制字符 + trim；空串=未设置（不写入记录）；截断 60 Unicode 码点；前端始终以 React 文本节点渲染（HTML 只作普通文本）。
- 传输：multipart 增加 `home` JSON 字段；创建/更新/复制均持久化；重命名不影响 home。
- 运行时：`applyResolvedTheme` 写 `root.dataset.homeTitle`（安全属性，非 CSS 变量）；`appliedHomeTitle()` 读取，缺失/空白回退默认值；首页监听 `tianshu:theme-changed` 事件实时更新标题（覆盖切换主题、自定义主题异步加载完成、system 浅深切换、工作台保存后重新应用）。
- 工作台：标题输入在主题名称之后；实时更新首页预览 `<h1>`；字符计数 当前/60；纳入撤销/重做快照；保存时标题非空才写入。

## 4. 测试结果

| 测试 | 数量 | 结果 |
|---|---|---|
| Server 全量 | 16 文件 / 162 | ✅（基线 133 + 新增 29） |
| └ listRecent 单元 | 12 | ✅ 倒序/limit/排除 event/含分支/忽略工具/空白压缩/Unicode 代理对/无消息 null/控制字符回退 |
| └ GET /recent API | 2 | ✅ 摘要+preview、limit 收敛 |
| └ theme home schema/store/API | 11+3+2 | ✅ 旧版兼容/往返/空白清理/空回退/60 截断/控制字符/HTML 文本/复制保留/更新继承 |
| Client 全量 | 7 文件 / 86 | ✅（基线 68 + 新增 18） |
| └ themeRuntime homeTitle | 3 | ✅ apply 写 dataset、无 home 回退默认、dataset 空白回退 |
| └ ThemeStudio 快照 | 6 | ✅ clone/equals 含 homeTitle、normalizeHomeTitle 清理/截断/代理对 |
| └ homeFormat | 6 | ✅ 刚刚/分钟/小时/昨天/本地日期/非法时间戳 |
| Desktop | 2 文件 / 16 | ✅ |

## 5. 构建与 e2e

| 目标 | 结果 |
|---|---|
| Server `npm run build` | ✅ tsc + tool.json |
| Client `npm run build` | ✅ tsc + vite |
| Desktop `npm run build` | ✅ tsc |
| `verify-theme-e2e.mjs` | ✅ 含 home.title 创建/详情/重启保留，全检查通过 |
| `verify-builtin-e2e.mjs` | ✅ 全检查通过（config.json dataDir+runPolicy 保留） |
| `graphify update .` | ✅ 6281 nodes / 9937 edges / 490 communities |

## 6. 完成标准核对

- ✅ 首页只含标题、最近三对话、"查看全部会话"；无其他业务区域。
- ✅ 无硬编码角色/会话/模型/项目数据（HomePage.tsx 全部真实接口）。
- ✅ 最近对话排序/过滤正确（chat 排除 event、updated_at DESC、摘要服务端清洗）。
- ✅ 导航正确：卡片 → `/chat/:id`（encodeURIComponent）；查看全部 → `/chat`。
- ✅ 自定义主题可编辑并持久化首页标题（工作台+服务端全链路）。
- ✅ 切换主题后标题立即更新（dataset.homeTitle + theme-changed 事件）。
- ✅ 旧自定义主题无需迁移（home 可选字段）。
- ✅ 加载（骨架×3）/空数据/接口失败（重试+查看全部）/角色失败（Agent 回退）全部稳定。
- ✅ 浅色/深色/自定义/窄窗口（880px 单列）可读可操作；focus-visible 全局可见；reduced-motion 关闭位移动画。
- ✅ 自动化测试（Server 162 + Client 86 + Desktop 16）与生产构建通过。

## 7. 未完成项与人工验收

1. **浏览器人工视觉验收未执行**：原型 `homepage-card-prototype.html` 的视觉方向（标题居中、卡片留白）需在真实应用对照；1920/1366/1024/窄窗口、浅/深/自定义主题、长标题/长角色名/中英文摘要需人工确认。
2. 首页不轮询（首版决策）；从会话页返回时靠组件重挂载刷新——若未来需要实时性可加 WebSocket/轮询（计划外）。
3. ~~卡片头像为纯色+首字符文字头像~~ → **已改用 `CharacterRenderer`（mode='avatar'）**：使用角色真实视觉资产（静态图/视频），`visualCache` 让 3 张卡片共享同一角色请求；角色视觉缺失或加载失败时自动回退名称首字符文字头像，不阻塞卡片显示。
4. 人工验收建议：① 首页三卡片显示真实最近会话并点击跳转；② 切换主题后标题立即变化；③ 创建自定义主题设置标题→保存→重启→应用→首页显示；④ 断网刷新首页显示失败态可重试；⑤ 清空会话数据库验证空态；⑥ Tab 键遍历三卡片与"查看全部会话"。
