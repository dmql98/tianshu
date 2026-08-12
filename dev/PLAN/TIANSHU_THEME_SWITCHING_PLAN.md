# 天枢主题与自定义主题工作台开发计划

> 目标读者：直接接手实现的 OpenCode / Codex。
>
> 本文仅为开发计划，不包含业务代码修改。
>
> 交互参考：[DreamSkin Studio](https://dreamskin.cc/studio)；参考代码：[Fei-Away/Codex-Dream-Skin](https://github.com/Fei-Away/Codex-Dream-Skin)。

## 1. 产品目标

为天枢建立一套启动即生效、可持久化、可跟随系统、支持用户图片自定义的主题系统。

主题产品模型固定为：

1. 两个内置主题：`tianshu-light`（浅色）和 `tianshu-dark`（深色）。
2. `system` 是选择模式，根据操作系统外观自动解析到浅色或深色，不是第三个主题。
3. 用户可以选择本地图片创建自定义主题，调节图片焦点，自动提取主题色，手动微调后保存和应用。
4. 自定义主题及其全部素材保存到系统配置所选择的数据根目录 `<dataDir>/themes/`，与 `<dataDir>/characters/`、`<dataDir>/skills/` 同级。
5. 两个内置主题始终可用；自定义主题损坏或丢失时安全回退，不阻塞应用启动。

首版必须完成：

- 修复现有浅色、深色、跟随系统只有属性变化而没有完整视觉效果的问题。
- 在 React 首次渲染前应用主题，避免闪白和路由刷新后失效。
- 跟随系统模式实时响应 `prefers-color-scheme` 变化。
- 用语义 CSS Token 覆盖首页、会话、设置、弹窗、表单、Markdown、代码块及状态色。
- 正确处理字体、字号、自定义字体颜色和主题文字颜色的优先级。
- 提供主题管理界面和自定义主题工作台。
- 支持选图、焦点调节、自动取色、实时预览、颜色微调、保存、重新编辑、复制和删除。
- 自定义主题通过服务端 API 落盘到 `<dataDir>/themes/`，不把图片或完整主题存入 `localStorage`、IndexedDB 或 Electron 固定 `userData/backgrounds`。

非目标：

- 不开放任意 CSS、HTML 或 JavaScript 导入。
- 不建设在线主题市场、远程下载或运行时 CDN 依赖。
- 不引入 CDP、renderer 注入、外部守护进程或修改桌面安装包。
- 不改变角色颜色、任务状态、成功、警告、错误等业务语义。
- 首版不要求 ZIP 主题包导入导出；本地自定义主题工作台属于首版范围。

## 2. 参考实现结论

### 2.1 借鉴范围

DreamSkin Studio 已验证的核心交互包括：

- 选择或拖入 JPEG、PNG、静态 WebP 图片。
- 在真实界面预览旁调节水平焦点和垂直焦点。
- 选择自动、浅色或深色外观。
- 编辑背景、面板、次级面板、强调色、正文、次要文字、分隔线等颜色。
- 实时展示主题效果和文字对比度。
- 将图片、焦点、画面强度和色板共同组成主题。

天枢拥有自己的 React 和 CSS 源码，因此只借鉴产品交互、主题契约、背景可读性、原子保存、失败回退和安全边界，不复制 CDP 注入架构。

### 2.2 天枢主题契约

主题只允许声明结构化数据：

- `schemaVersion/id/name`：主题身份和版本。
- `appearance`：`light` 或 `dark`；工作台可以提供 `auto` 作为生成时的推断选项，但保存时必须解析成确定值。
- `artwork.file`：主题目录内的相对图片路径。
- `artwork.focusX/focusY`：图片视觉焦点，范围 `0..1`。
- `artwork.homeOpacity/taskOpacity/dim`：首页和任务页的背景强度及暗化参数。
- `colors`：背景、面板、强调色、正文、边界及语义色映射。

自定义主题不包含任意 CSS。所有界面样式都由天枢注册的 Token 和组件规则控制。

### 2.3 图片取色原则

图片取色是首版核心能力，不是后续可选项。算法不能简单选取出现次数最多的像素，应执行：

1. 在浏览器中解码并按最大边或固定像素数降采样，避免超大图片阻塞 UI。
2. 转换到适合感知距离的颜色空间后聚类，得到有限候选色。
3. 合并相近颜色，过滤透明像素、极小簇和没有区分度的噪声色。
4. 分析整体亮度、焦点区域和主色，推断建议的 `light/dark` 外观。
5. 从候选色中选择强调色；背景、面板和文字色应经过亮度、饱和度及对比度校正，而不是原样复制照片像素。
6. 自动生成的正文与背景至少达到 WCAG AA 4.5:1；控件边界和大字至少达到 3:1。
7. 自动结果只是初始值，用户可以手动修改所有公开色槽，并可一键重新从图片生成。

图片亮度不能擅自改变用户明确选择的浅色或深色外观；只有 `auto` 模式允许算法建议外观。

## 3. 当前代码基础与缺陷

### 3.1 可复用基础

- `web/client/src/pages/SettingsPage.tsx` 已有 `light/dark/system` 控件。
- 旧选择保存在 `localStorage['tianshu:theme']`。
- 现有 `applyTheme()` 会向 `<html>` 写 `data-theme="light|dark"`。
- `web/client/src/index.css` 已大量使用 `--bg-*`、`--ink-*`、`--gold`、`--jade` 等变量。
- `web/client/src/features/display/displayPreferences.ts` 已处理字体、字号和字体颜色的初始化、持久化及跨窗口同步。
- 服务端 `web/server/src/config.ts` 通过 `getDataDir()` 解析系统配置所选择的数据根目录；本计划与内置内容计划应共同把 `characters`、`skills`、`themes` 等路径收敛到公共 `data-paths.ts`。

### 3.2 当前缺陷

1. `index.css` 缺少完整深色 Token，深色切换没有真实视觉覆盖。
2. 主题只在设置页挂载时应用，其他路由直达或刷新时不会及时加载。
3. 跟随系统没有持续监听系统主题变化。
4. 页面组件直接操作 DOM 和 `localStorage`，无法复用和验证。
5. 默认字体颜色以内联变量覆盖主题 CSS，深色主题会产生错误文字颜色。
6. CSS 和 TSX 中仍有大量需要分类迁移的硬编码表面色。
7. 设置页没有主题预览、图片编辑、色板或对比度提示。
8. 当前没有自定义主题目录协议、服务端 API、图片校验、原子写入和资源清理机制。
9. 没有主题单元测试、取色算法测试、文件安全测试或关键页面视觉回归。

## 4. 产品交互

### 4.1 主题选择页

设置 → 显示中的主题区域包含：

- 跟随系统卡片：展示当前实际解析结果，例如“当前使用：深色”。
- 浅色主题卡片。
- 深色主题卡片。
- 已保存的自定义主题卡片，展示预览图、名称、外观和色板。
- “创建自定义主题”按钮。
- 自定义主题菜单：应用、编辑、复制、重命名、删除。
- “恢复默认”只把主题选择恢复为 `system`，不得重置字体和其他显示设置。

选择主题后应立即应用并持久化，不要求重启。主题选择状态不能只依赖颜色表达，应使用选中图标、文字和 `aria-checked`/`aria-pressed`。

### 4.2 自定义主题工作台

工作台采用“真实界面预览 + 设置面板”的结构，最少包含：

1. 选择或拖入本地图片。
2. 图片格式、文件大小、像素尺寸和解码结果校验。
3. 实时主题预览；预览至少覆盖首页和会话/任务页两种画面强度。
4. 在预览中拖动图片调节焦点，并同步水平、垂直焦点滑块。
5. `auto/light/dark` 外观选择；保存时 `auto` 转换为确定外观。
6. 自动提取候选色并生成完整主题色板。
7. 背景、面板、次级面板、输入框、强调色、正文、次要文字、边界等颜色的手动编辑。
8. 实时对比度提示；不合格项明确标记，并提供自动修正。
9. 背景首页透明度、任务页透明度和暗化强度调节。
10. 撤销、重做、恢复本组默认和重新取色。
11. 新建时“保存主题”，编辑时“保存修改”；保存成功后才允许应用新版本。

焦点坐标使用图片空间的归一化值，`0.5/0.5` 表示中心。预览尺寸变化不能改变已保存焦点。

### 4.3 背景渲染规则

- 使用 `.app::before` 或独立 `ThemeBackdrop` 统一渲染，不在各页面重复设置背景图。
- 背景层必须 `pointer-events: none`、`aria-hidden="true"`。
- `object-position` 或 `background-position` 由 `focusX/focusY` 驱动。
- 首页允许较明显背景；会话、设置、角色编辑等任务页必须降低背景存在感。
- 面板使用实色或半透明 surface 保证可读性；不支持 blur 时回退到更不透明的颜色。
- 图片加载失败时仍显示完整色板和可读界面。
- `prefers-reduced-motion: reduce` 下关闭非必要的背景和主题过渡动画。

## 5. 共享数据目录与主题包协议

### 5.1 与内置内容计划共享的路径契约

本计划与 `BUILTIN_CONTENT_DEVELOPMENT_PLAN.md` 使用同一套路径定义：

```text
Electron userData/
├── config.json                    # 系统配置：dataDir 选择、SystemRunPolicy 等
└── data/                          # 未自选目录时的默认 <dataDir>
    ├── characters/
    ├── skills/
    ├── themes/
    ├── content-state.json
    ├── providers.json
    └── sessions.db

仓库或安装资源/
└── content/builtin/               # 角色、技能等随应用发布的只读内容
```

术语和环境变量：

- `TIANSHU_CONFIG_DIR` 指向 Electron 壳层配置目录，`config.json` 位于这里，保存 `dataDir` 选择和 Run Policy 等系统级配置；它不是业务资源根。
- `TIANSHU_DEFAULT_DATA_DIR` 提供默认数据根，通常为 `<Electron userData>/data`。
- `TIANSHU_DATA_DIR` / `DATA_DIR` 是测试、容器或高级用户的显式覆盖。
- `getDataDir()` 返回最终 `<dataDir>`，是所有可写业务资源的唯一根。
- `TIANSHU_BUILTIN_CONTENT_DIR` 只影响角色、技能、Provider 等只读发行内容，不影响用户主题目录。

两个内置主题由前端代码和随应用发布的静态资源提供，不放入 `content/builtin`，也不复制到 `<dataDir>/themes`。`<dataDir>/themes` 只保存用户创建或以后显式导入的自定义主题。角色/技能的 copy-on-write、同 ID 覆盖及 `content-state.json` 隐藏机制不适用于主题。

若共享路径契约发生变化，必须同步更新本计划与 `BUILTIN_CONTENT_DEVELOPMENT_PLAN.md`，不能让某个功能单独增加另一套 dataDir 推导。

公共路径基础只实现一次：无论先开发主题还是内置内容，最先进入实现的计划负责建立 `web/server/src/data-paths.ts` 及其测试；后进入的计划只能复用和补充测试，不能创建同义模块。`getDataDir()` 的解析、迁移和缓存行为仍归 `web/server/src/config.ts` 负责，`data-paths.ts` 只提供经过命名的子路径，不重复读取环境变量或 `config.json`。

### 5.1.1 前两阶段交接约束

本计划在 Run Policy 和 Builtin Content 两阶段完成后实施，必须复用其最终代码契约：

交接时以当前代码及前两阶段测试为事实来源；本文件“当前代码基础与缺陷”中已经被前两阶段改造改变的描述只作历史背景，不得据此覆盖新 config schema、角色 revision、公共路径模块、Run 事件或前端状态模型。

- 复用 `<TIANSHU_CONFIG_DIR>/config.json` 中已经存在的 `dataDir` 和 `runPolicy`；主题功能不得以整对象覆盖方式保存 config，也不得重置 SystemRunPolicy。
- 复用公共 `web/server/src/data-paths.ts` 的 `themesRoot()`；不得新增平行 dataDir/config 解析模块。
- 不修改角色 `runPolicy`、character revision 或 RunPolicySnapshot schema。
- 不把主题偏好混入 SystemRunPolicy 或 CharacterRunPolicy；主题选择是独立显示偏好。
- 保留 SettingsPage 已有“运行与安全”区域，主题 UI 必须作为独立组件挂载，不能用重写整个 SettingsPage 的方式覆盖前阶段功能。
- 保留 `chatStore` 的 ActiveRunState、自动续跑事件归并、整链停止和重连恢复；主题切换不得以全量 store 重构破坏这些行为。
- 保留 RightPanel 的运行策略摘要；主题 Token 化只能修改样式消费，不能删除或改变运行策略业务逻辑。
- 复用 Builtin 阶段已经稳定的 Electron dev/packaged dataDir 和 resources 编排。

Theme 阶段开始前必须记录 Run Policy 与 Builtin 的全套测试/构建基线；完成后再次执行，任何失败都视为主题阶段回归。

### 5.2 目录位置

自定义主题必须使用服务端 `getDataDir()`，目录结构为：

```text
<dataDir>/
├─ characters/
├─ skills/
├─ themes/
│  ├─ custom-forest/
│  │  ├─ theme.json
│  │  ├─ background.webp
│  │  └─ preview.webp
│  └─ custom-starry/
│     ├─ theme.json
│     ├─ background.jpg
│     └─ preview.webp
├─ sessions.db
└─ providers.json
```

建议先由两份计划共同建立公共路径模块：

```text
web/server/src/data-paths.ts
```

公共接口至少包括：

```ts
export function dataRoot(): string
export function charactersRoot(): string
export function skillsRoot(): string
export function themesRoot(): string
export function contentStateFile(): string
```

`data-paths.ts` 内部唯一允许调用 `getDataDir()`；主题 store 使用 `themesRoot()`，不得自行散落 `resolve(getDataDir(), 'themes')`。数据目录发生切换时，主题列表和当前主题校验必须跟随新的 `dataDir`。不得把自定义主题固定到 `TIANSHU_CONFIG_DIR`、Electron `app.getPath('userData')` 的其他子目录或前端存储。

### 5.3 每个主题目录

- 目录名使用服务端生成或校验后的稳定 ID，例如 `custom-<uuid>` 或安全 slug。
- `theme.json` 是提交标记和主题事实来源。
- `background.<ext>` 是规范化后的背景素材；允许保留原始格式，但运行时只引用主题目录内文件。
- `preview.webp` 是列表缩略图，可由服务端或客户端生成后上传。
- 首版每个主题只允许一张活动背景图和一张预览图。
- JSON 中所有素材路径必须为主题目录内相对文件名，禁止绝对路径和 `..`。

示例：

```json
{
  "schemaVersion": 1,
  "id": "custom-forest",
  "name": "森林",
  "appearance": "dark",
  "artwork": {
    "file": "background.webp",
    "preview": "preview.webp",
    "focusX": 0.58,
    "focusY": 0.36,
    "homeOpacity": 0.8,
    "taskOpacity": 0.35,
    "dim": 0.25
  },
  "colors": {
    "canvas": "#111713",
    "surface1": "#1b241e",
    "surface2": "#263129",
    "input": "#202a23",
    "accent": "#8faf76",
    "accentHover": "#a3c48a",
    "textPrimary": "#f2f5ef",
    "textSecondary": "#b8c2b5",
    "border": "#435047"
  },
  "createdAt": "2026-08-12T00:00:00.000Z",
  "updatedAt": "2026-08-12T00:00:00.000Z"
}
```

### 5.4 保存与原子性

创建或更新主题时：

1. 服务端校验元数据和文件。
2. 写入 `<dataDir>/themes/.tmp-<id>-<nonce>/`。
3. 图片和预览图先写，`theme.json` 最后写。
4. 完整读取并复验临时目录。
5. 原子替换正式目录；Windows 下需要使用同卷临时目录并提供可恢复的替换流程。
6. 成功后清理旧目录和临时文件。
7. API 成功返回后，前端才更新当前选择。

更新失败时保留原版本。启动时清理超时临时目录，但不能删除无法确认归属的文件。

### 5.5 删除与资源回收

- 删除非当前主题：删除对应主题目录，返回明确结果。
- 删除当前主题：先把活动选择切换到 `system` 或安全的内置主题，确认生效后再删除。
- 更换背景图后清理旧素材。
- 找不到图片、JSON 损坏或 schema 不支持时，把主题标记为无效，不让其成为活动主题。
- 删除属于不可恢复操作，UI 必须明确显示主题名称并要求确认。

## 6. 目标数据模型

客户端运行时模型：

```ts
export type BuiltinThemeId = 'tianshu-light' | 'tianshu-dark'

export type ThemeSelection =
  | { mode: 'system' }
  | { mode: 'builtin'; themeId: BuiltinThemeId }
  | { mode: 'custom'; themeId: string }

export interface ThemePreferences {
  version: 2
  selection: ThemeSelection
}

export interface ThemeArtwork {
  url: string
  previewUrl?: string
  focusX: number
  focusY: number
  homeOpacity: number
  taskOpacity: number
  dim: number
}

export interface ThemeDefinition {
  id: string
  source: 'builtin' | 'custom'
  name: string
  appearance: 'light' | 'dark'
  tokens: ThemeTokens
  artwork?: ThemeArtwork
  updatedAt?: string
}
```

客户端只缓存轻量选择：`localStorage['tianshu:themePreferences']`。图片、完整自定义主题和主题列表的事实来源均为服务端 `<dataDir>/themes`。

旧键迁移：

- `tianshu:theme=light` → `{ mode:'builtin', themeId:'tianshu-light' }`。
- `tianshu:theme=dark` → `{ mode:'builtin', themeId:'tianshu-dark' }`。
- `tianshu:theme=system` → `{ mode:'system' }`。
- 旧计划中的 `tianshu-paper` → `tianshu-light`。
- 旧计划中的 `tianshu-night` → `tianshu-dark`。
- `tianshu-starry` 不再作为内置主题；若已有数据，应迁移成自定义主题或安全回退。
- JSON 损坏、版本未知或主题 ID 不存在时回退 `{ mode:'system' }`。

## 7. 主题 Token 设计

主题定义只提供语义 Token，组件不得感知某个具体主题 ID：

```css
--theme-canvas;
--theme-surface-1;
--theme-surface-2;
--theme-surface-hover;
--theme-input;
--theme-overlay;
--theme-border;
--theme-border-subtle;
--theme-text-primary;
--theme-text-secondary;
--theme-text-muted;
--theme-text-faint;
--theme-text-on-accent;
--theme-accent;
--theme-accent-hover;
--theme-accent-soft;
--theme-link;
--theme-focus-ring;
--theme-success;
--theme-warning;
--theme-danger;
--theme-info;
--theme-shadow-color;
--theme-code-bg;
--theme-scrollbar;
--theme-backdrop-image;
--theme-backdrop-home-opacity;
--theme-backdrop-task-opacity;
--theme-backdrop-dim;
--theme-backdrop-focus-x;
--theme-backdrop-focus-y;
```

现有变量在迁移期映射到新 Token：

```css
--bg-main: var(--theme-canvas);
--bg-card: var(--theme-surface-1);
--bg-hover: var(--theme-surface-hover);
--bg-input: var(--theme-input);
--ink-deep: var(--theme-text-primary);
--ink-mid: var(--theme-text-secondary);
--ink-light: var(--theme-text-muted);
--ink-faint: var(--theme-text-faint);
--gold: var(--theme-accent);
--jade: var(--theme-success);
--cinnabar: var(--theme-danger);
--blue: var(--theme-info);
```

根节点建议：

```html
<html
  data-theme-selection="system"
  data-theme-source="builtin"
  data-theme-id="tianshu-dark"
  data-color-scheme="dark"
>
```

同时设置 `color-scheme`。自定义主题 Token 可以通过受控的 root style 写入，但只能写注册变量；切换前清除上一个自定义主题留下的变量。

### 7.1 字体颜色优先级

升级显示偏好：

```ts
interface DisplayPreferencesV2 {
  version: 2
  fontFamily: FontFamilyId
  fontScale: number
  textColorMode: 'theme' | 'custom'
  textColor?: string
}
```

- 默认 `textColorMode='theme'`，不以内联样式覆盖主题文字 Token。
- 用户明确选择自定义文字颜色后才写覆盖值。
- 自定义文字颜色必须给出当前背景下的对比度提示。
- 恢复显示设置时回到主题文字，而不是固定浅色棕色。
- 主题切换不得重置字体和字号。

## 8. 服务端主题模块与 API

建议新增：

- `web/server/src/theme/schema.ts`
- `web/server/src/theme/store.ts`
- `web/server/src/theme/image-validation.ts`
- `web/server/src/routes/themes.ts`
- 对应单元测试和 API 测试

最小 API：

```text
GET    /api/themes
GET    /api/themes/:id
POST   /api/themes
PUT    /api/themes/:id
POST   /api/themes/:id/duplicate
DELETE /api/themes/:id
GET    /api/themes/:id/assets/:file
```

创建和更新使用 `multipart/form-data`，提交结构化 JSON、背景图和预览图。也可以拆分为草稿上传 API，但正式主题只有在完整校验并提交成功后才出现在列表中。

服务端规则：

- `id`、文件名和所有路径必须服务端校验，拒绝 traversal、绝对路径、符号链接和目录外访问。
- 只接受 JPEG、PNG、静态 WebP；以实际解码结果和 magic bytes 为准，不能只信扩展名或请求 MIME。
- 限制上传字节数、像素尺寸、解码后内存预算和长宽比。
- 拒绝 SVG、HTML、动图、data URL 和远程 URL。
- 资产路由只能访问已经登记在有效 `theme.json` 中的文件。
- 返回适当的 `Content-Type`、缓存头和不可执行内容策略。
- 列表扫描遇到损坏主题时跳过并记录诊断，不让整个接口失败。

## 9. 初始化与切换流程

### 9.1 启动

```text
读取轻量 selection
  → 迁移旧键并校验
  → system/builtin 可同步解析并立即应用
  → custom 先应用 last-known-good 快照或安全内置主题
  → 拉取服务端主题定义和素材 URL
  → 校验并应用自定义主题
  → 初始化 display preferences
  → 渲染 React
```

为避免自定义主题启动闪烁，可以在轻量偏好中缓存经过服务端验证的非敏感 Token 快照和主题版本，但缓存不是事实来源；服务端主题加载失败时回退内置主题。

### 9.2 运行时切换

1. 校验 selection 和目标主题定义。
2. 预加载背景图片；图片失败时决定使用纯色降级或拒绝应用。
3. 原子写入 root attributes、注册 Token 和背景参数。
4. 读取关键属性确认目标主题已生效。
5. 再持久化 selection 和 last-known-good。
6. dispatch `tianshu:theme-changed`。
7. 失败时恢复上一个有效主题；恢复也失败则回到内置浅色或深色。

### 9.3 跟随系统与跨窗口同步

- 使用 `matchMedia('(prefers-color-scheme: dark)')`。
- 只有 selection 为 `system` 时响应系统变化。
- 兼容 `addEventListener`，必要时保留 `addListener` fallback。
- 监听轻量偏好的 `storage` 事件同步其他窗口。
- 自定义主题保存后通过应用事件或轮询/刷新主题列表同步；不能依赖浏览器文件系统状态。
- 初始化函数返回 cleanup，支持测试和 HMR。

## 10. 前端模块建议

建议新增：

- `web/client/src/features/theme/themeDefinitions.ts`
- `web/client/src/features/theme/themePreferences.ts`
- `web/client/src/features/theme/themeRuntime.ts`
- `web/client/src/features/theme/themeApi.ts`
- `web/client/src/features/theme/ThemeSelector.tsx`
- `web/client/src/features/theme/ThemeStudio.tsx`
- `web/client/src/features/theme/ImageFocusEditor.tsx`
- `web/client/src/features/theme/PaletteEditor.tsx`
- `web/client/src/features/theme/colorExtraction.ts`
- `web/client/src/features/theme/contrast.ts`
- 对应测试

主要修改：

- `web/client/src/main.tsx`
- `web/client/src/App.tsx`
- `web/client/src/pages/SettingsPage.tsx`
- `web/client/src/index.css`
- `web/client/src/features/display/displayPreferences.ts`

取色算法首版可使用自研的小型降采样和聚类模块；若引入依赖，必须评估包体积、浏览器兼容性、维护状态和许可证，不引入需要原生构建的依赖。

## 11. CSS 与组件改造范围

### P0：Token 审计

把颜色分为：

1. 主题表面色：背景、面板、输入框、普通文字、边界、阴影和 hover，必须迁移。
2. 业务语义色：成功、失败、警告、运行中和角色标识，映射到语义 Token，含义不变。
3. 固定资产色：Logo、图片或必须为白色的 on-accent 文本，保留并说明原因。

### P1：核心页面

- App、导航栏、setup overlay。
- HomePage。
- ChatPage、SessionPanel、ChatArea、RightPanel、FilePanel。
- 消息气泡、Markdown、代码块、引用、表格、tool call、reasoning。
- SettingsPage、ThemeStudio、dialog、popover、toast。

### P2：其余页面

- Characters、CharacterDetail。
- Skills、SkillPackage、NewSkillPackage。
- Tools、MCP、Knowledge、Market、Events。
- 空状态、加载态和错误态。

所有 focus 状态使用 `--theme-focus-ring`；`#fff` 只通过 `--theme-text-on-accent` 等明确语义保留。

## 12. 分阶段实施

### P0：基线和主题核心

1. 先运行并记录 Run Policy、Builtin Content 的全套测试与构建基线。
2. 为旧 `light/dark/system` 建立迁移测试。
3. 建立浅色关键页面视觉基线和硬编码颜色分类清单。
4. 实现 `tianshu-light`、`tianshu-dark`、`system` 的统一定义和运行时 API。
5. 在 `main.tsx` 渲染前初始化，完成系统监听、跨窗口同步和失败回退。
6. 升级 display preferences v2。
7. 完成核心页面 Token 化和真实深色覆盖，同时保留 SettingsPage 的“运行与安全”区域及 RightPanel 的运行策略业务逻辑。

### P1：主题目录和服务端 API

1. 本阶段按既定顺序实施时，公共 `data-paths.ts` 必须已由 Builtin Content 阶段提供；直接复用 `themesRoot()`。若缺失，停止主题实现并把它作为前阶段未完成项报告，不能在 Theme 阶段另建同义模块。
2. 新增 `<dataDir>/themes` store、schema 和路由。
3. 完成列表、读取、创建、更新、复制、删除和资产读取。
4. 完成 multipart 上传、文件解码校验、路径安全和原子保存。
5. 完成损坏主题隔离、临时目录清理和当前主题删除回退。
6. 数据目录切换后重新加载主题列表并校验当前选择。

### P1：自定义主题工作台

1. 完成选图、拖放和错误提示。
2. 完成图片降采样、取色、外观建议和色板生成。
3. 完成焦点拖动、双滑块和背景强度控制。
4. 完成真实首页/任务页预览和颜色手动编辑。
5. 完成对比度提示、自动修正、撤销、重做和重置。
6. 完成保存、编辑、复制、重命名和删除流程。

### P2：全页面回归和体验完善

1. 完成剩余页面 Token 化。
2. 完成键盘操作、窄窗口、字体缩放和 reduced motion。
3. 优化超大图片取色性能，必要时使用 Web Worker。
4. 完成真实桌面构建和数据目录迁移场景回归。

### P3：可选主题包导入导出

ZIP 导入、导出和第三方主题分享另行设计。即使未来实现，也只能携带结构化 `theme.json` 和受限图片，不能携带任意 CSS 或脚本。

## 13. 测试计划

### 13.1 客户端单元测试

- 空偏好返回 `system`。
- 旧 `light/dark/system` 和旧主题 ID 正确迁移。
- 损坏 JSON、未知版本和未知 ID 安全回退。
- system 在 `prefersDark` true/false 时解析正确。
- builtin/custom 固定选择不随系统变化。
- apply 写入正确 attributes、`color-scheme`、Token 和背景参数。
- 切换自定义主题时清除旧主题残留 Token。
- display v1 → v2 迁移正确。
- 图片降采样不会超出预算。
- 取色结果稳定、去重，并能处理单色、灰度、透明、极暗和极亮图片。
- 自动生成的文字和背景达到规定对比度。
- 焦点始终归一化到 `0..1`。
- undo/redo 和重新取色不会破坏已确认状态。

### 13.2 服务端测试

- `<dataDir>/themes` 与 characters、skills 使用同一 `getDataDir()` 根。
- 空目录、多个合法主题、损坏 JSON 和缺失图片的列表行为。
- 创建、更新、复制和删除完整生命周期。
- 写入失败保留旧版本，成功后无残留临时目录。
- 当前主题删除前正确回退。
- 拒绝路径穿越、绝对路径、符号链接、伪造 MIME、SVG、HTML、动图和远程 URL。
- 拒绝超大字节数、超大像素、异常长宽比和解码炸弹。
- 资产接口不能读取主题目录外文件或未登记文件。
- 切换 `TIANSHU_DATA_DIR` 后只读取新根目录主题。

### 13.3 组件和端到端测试

- 主题卡片具备 radio/pressed 语义和键盘操作。
- system 卡片显示当前解析结果。
- 选图后显示预览、焦点和自动色板。
- 拖动焦点与两个滑块双向同步。
- 编辑颜色后真实预览即时更新。
- 对比度不合格有非颜色提示，自动修正可工作。
- 保存成功后主题出现在列表并可应用、重启后仍存在。
- 保存失败不产生半成品主题，也不改变活动主题。
- 编辑、复制、重命名和删除行为正确。

### 13.4 视觉和可访问性矩阵

| 页面 | 浅色 | 深色 | 跟随系统 | 自定义浅色 | 自定义深色 |
|---|---:|---:|---:|---:|---:|
| 首页 | 必测 | 必测 | 必测 | 必测 | 必测 |
| 会话/任务页 | 必测 | 必测 | 必测 | 必测 | 必测 |
| Markdown/代码块 | 必测 | 必测 | 抽测 | 必测 | 必测 |
| 设置/主题工作台 | 必测 | 必测 | 抽测 | 必测 | 必测 |
| 角色/技能/工具 | 必测 | 必测 | 抽测 | 抽测 | 抽测 |
| dialog/toast/approval | 必测 | 必测 | 抽测 | 必测 | 必测 |

覆盖 1280、1440、1920 和窄窗口；字体缩放覆盖 80%、100%、140%。正文对比度至少 4.5:1，大字及非文本控件至少 3:1，focus-visible 在所有主题中可见。

### 13.5 构建验证

```powershell
npm test --prefix web/client
npm run build --prefix web/client
npm test --prefix web/server
npm run build --prefix web/server
npm test --prefix desktop
npm run build --prefix desktop
```

再通过项目 `run.bat` 或 `npm run dev` 启动真实桌面构建，验证刷新、直接深链、系统主题变化、跨窗口、自定义主题重启恢复和数据目录切换。

此外必须重新运行 Run Policy 与 Builtin Content 阶段的专项测试，重点验证：

- `config.json` 保存主题相关流程后 `runPolicy` 和 `dataDir` 均未丢失。
- 系统“运行与安全”设置和角色运行策略设置仍可读写。
- ActiveRunState、自动续跑、整链停止和重连恢复不受主题状态重构影响。
- builtin 角色/技能双层加载和 copy-on-write 不受主题目录扫描影响。
- `themesRoot()` 与 `charactersRoot()`、`skillsRoot()` 仍来自同一公共 data root。

## 14. 验收标准

全部满足才算完成：

1. 浅色、深色和跟随系统具有完整、真实且可读的视觉效果。
2. 任意路由刷新后，在首个 React 页面显示前应用正确内置主题；自定义主题加载期间无不可读闪烁。
3. system 实时响应操作系统 light/dark 变化。
4. 用户能选择图片、调节焦点、自动提取主题色、手动微调并实时预览。
5. 用户能保存、应用、重新编辑、复制、重命名和删除自定义主题。
6. 自定义主题完整保存到 `<dataDir>/themes/<id>/`，与 characters、skills 同级；切换数据目录后跟随新根目录。
7. 图片和主题事实数据不存入 `localStorage`、IndexedDB 或固定 `userData/backgrounds`。
8. 主题保存具有校验和原子性，失败不会覆盖有效版本或产生可见半成品。
9. 损坏、缺失或已删除的当前主题会自动回退到安全内置主题。
10. 设置页不再直接操作裸 `data-theme` 或散落的 `localStorage`。
11. 默认字体设置不覆盖主题文字颜色；用户自定义文字颜色有明确优先级和对比度提示。
12. 首页、会话、输入框、Markdown、代码块、弹窗和设置页在内置及自定义主题中均可读。
13. 背景不拦截交互，任务页背景强度受控，图片失败时可降级到纯色主题。
14. 文件格式、尺寸、路径和资产访问安全测试通过。
15. 单元测试、服务端测试和前后端构建通过。
16. 没有引入 CDP、任意 CSS、远程主题代码或运行时网络主题依赖。
17. Run Policy 的系统/角色配置、Run 快照、自动续跑及前端状态协调全部回归通过。
18. Builtin Content 的公共路径、双层加载、copy-on-write 和打包资源全部回归通过。

## 15. 推荐实施顺序

1. 建立浅色视觉基线和颜色审计。
2. 记录前两阶段测试/构建基线，确认 `data-paths.ts`、SystemRunPolicy 和 SettingsPage 现有组件边界。
3. 实现两个内置主题、system 模式和统一 theme runtime。
4. 在 React 渲染前初始化主题，完成 storage/system 监听。
5. 升级 display preferences v2 并完成核心页面 Token 化。
6. 复用公共 `data-paths.ts` 的 `themesRoot()`，再实现 `<dataDir>/themes` schema、store、API 和安全测试。
7. 实现设置页主题卡片和自定义主题列表，不覆盖“运行与安全”区域。
8. 实现选图、降采样、自动取色和对比度生成。
9. 实现焦点编辑、真实预览、色板微调、撤销和重做。
10. 实现创建、更新、复制、重命名、删除和回退流程。
11. 完成剩余页面 Token 化、前两阶段回归、桌面回归和数据目录切换验证。
12. 主题包导入导出保持 P3，未经单独设计不实现。

## 16. 开发约束

- 不把所有硬编码颜色机械替换为同一个变量，必须先识别语义。
- 不在 React 页面组件中直接实现 `documentElement`、`matchMedia` 或散落的持久化逻辑。
- 前端不得直接拼接本地文件路径；主题文件统一通过服务端 API 管理和读取。
- 自定义主题定义不能包含函数、HTML、JavaScript、任意 CSS 或远程 URL。
- 不用背景图替代真实 UI，不把按钮、文字、侧栏等界面元素绘制进图片。
- 不为装饰效果降低正文对比度或控件可操作性。
- 不让图片主色直接决定文字色，所有生成色必须经过对比度校正。
- 不让主题覆盖字体设置的独立职责；主题与显示偏好通过明确 Token 优先级组合。
- 不把内置主题复制到用户 `themes` 目录；内置主题随应用发布，自定义主题随 `dataDir` 管理。
- 不在保存成功前切换到尚未提交的主题版本。
