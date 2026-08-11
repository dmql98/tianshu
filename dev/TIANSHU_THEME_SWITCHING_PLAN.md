# 天枢主题切换开发计划

> 目标读者：直接接手实现的 OpenCode / Codex。
>
> 本文仅为开发计划，不包含业务代码修改。
>
> 参考项目：[Fei-Away/Codex-Dream-Skin](https://github.com/Fei-Away/Codex-Dream-Skin)。

## 1. 目标

为天枢增加真正可用、启动即生效、可持久化、可跟随系统的主题切换能力，并在基础能力稳定后增加具有天枢辨识度的装饰主题。

首版目标：

1. 修复现有“浅色 / 深色 / 跟随系统”控件只有属性变化、没有实际深色样式的问题。
2. 主题在 React 首次渲染前应用，避免进入设置页之前不生效和页面闪白。
3. 系统主题变化时，选择“跟随系统”的用户可以实时切换。
4. 主题颜色全部通过语义 CSS Token 管理，普通页面、会话、弹窗、表单、Markdown、代码块和状态色保持一致。
5. 与已经实现的字体、字号、字体颜色设置正确协作。
6. 增加至少一个 Dream Skin 思路的天枢装饰主题，但不复制其 CDP 注入方案。
7. 支持一键恢复默认主题；异常主题数据自动回退，不阻塞应用启动。

非目标：

- 首版不支持第三方任意 CSS 导入。
- 首版不建设在线主题市场、ZIP 主题包或远程一键应用。
- 不引入 CDP、renderer 注入、外部守护进程或修改桌面客户端安装包。
- 不改变角色颜色、任务状态、成功/警告/错误等业务语义。

## 2. Codex Dream Skin 研究结论

### 2.1 它解决的问题与天枢不同

Codex Dream Skin 无法修改 Codex 官方源码，因此通过本地 CDP 连接向 renderer 注入主题，不修改 `app.asar` 或官方安装目录。天枢拥有自己的 React 和 CSS 源码，不需要复制这一层外部注入架构。

天枢应借鉴它的“主题契约、变量映射、背景可读性、原子切换、失败回退和安全边界”，使用原生前端状态和 CSS 实现。

### 2.2 主题契约

参考项目使用 `theme.json + background image + theme.css`：

- `schemaVersion/id/name`：主题身份和版本化基础。
- `appearance`：`auto/light/dark`。
- `art.focusX/focusY`：背景视觉焦点。
- `art.safeArea`：内容安全区。
- `art.taskMode`：主页和任务页的背景强度差异。
- `colors`：背景、面板、强调色、文字、边界等主题色。
- `theme.css`：只能在 Safe CSS 白名单内调整公开主题部件。

参考文件：

- [`windows/assets/theme.json`](https://github.com/Fei-Away/Codex-Dream-Skin/blob/main/windows/assets/theme.json)
- [`runtime/renderer-inject.js`](https://github.com/Fei-Away/Codex-Dream-Skin/blob/main/runtime/renderer-inject.js)
- [`runtime/safe-css-policy.json`](https://github.com/Fei-Away/Codex-Dream-Skin/blob/main/runtime/safe-css-policy.json)

### 2.3 CSS 变量与公开部件

Dream Skin 不让主题直接控制整个 DOM，而是：

1. 把主题颜色和视觉参数转换为 CSS 自定义属性。
2. 给有限的界面区域标记公开 part，例如 root、sidebar、main、header、home、thread、message、composer、dialog。
3. Safe CSS 只能修改允许的变量和属性，限制规则数、声明数和单值长度。
4. 装饰层使用 `pointer-events: none`，真实交互控件始终在上层。

天枢首版没有第三方 CSS，不需要完整 Safe CSS 解析器，但应该从一开始建立稳定的语义 Token 和主题作用域，避免以后只能靠覆盖 100 多处硬编码颜色扩展主题。

### 2.4 自适应背景与可读性

参考 renderer 会：

- 根据原生或系统外观决定 light/dark shell。
- 从图片中分析强调色，但图片亮度不会擅自翻转用户选择的 shell。
- 使用面板透明度、模糊、暗化、焦点和 task intensity 保证内容可读。
- 主页允许背景更明显，普通任务页降低背景存在感。
- 导航或 reload 后重新确保主题存在。

天枢可以简化为预先设计好的主题色板和背景参数，不必首版实现图片取色。

### 2.5 保存、应用与回滚

参考项目将“导入/保存”和“应用”分开：

- 导入成功只进入 saved themes，不自动改变活动主题。
- 应用前验证主题配置、图片和 CSS。
- 图片和 CSS 先暂存，`theme.json` 最后作为提交标记发布。
- 失败时恢复 last-known-good；不能确认恢复时不会宣称成功。
- 主题切换会验证真实 renderer 是否已经显示目标主题。

天枢的本地内置主题不需要文件级事务，但应保留同样的状态原则：先解析和校验，再应用；成功后才持久化 selection；失败回退默认主题。

### 2.6 不应照搬的部分

- CDP 端口与 renderer 注入：天枢不需要。
- Windows/macOS 外部托盘主题管理器：首版在天枢设置页和导航区原生完成。
- 任意背景 ZIP、远程下载和 Safe CSS：安全与维护成本较高，放入后续可选阶段。
- 图片动态取色：首版使用人工校验色板更稳定、更易满足对比度要求。

## 3. 天枢当前状态

### 3.1 已存在的代码

- `web/client/src/pages/SettingsPage.tsx` 已有 `light/dark/system` 下拉框。
- 选择值保存在 `localStorage['tianshu:theme']`。
- `applyTheme()` 会给 `<html>` 写 `data-theme="light|dark"`。
- `web/client/src/index.css` 已大量使用 `--bg-*`、`--ink-*`、`--gold`、`--jade` 等变量。
- `web/client/src/features/display/displayPreferences.ts` 已负责字体、字号和字体颜色的初始化、持久化及跨窗口同步。

这些基础可以复用，不需要引入新的状态管理依赖。

### 3.2 当前缺陷

1. `index.css` 只有 `:root` 浅色变量，没有任何 `[data-theme="dark"]` 定义，当前深色切换没有实际效果。
2. 主题只在 `SettingsPage` mount 时应用；直接打开主页、会话页或刷新非设置路由时不会加载用户选择。
3. “跟随系统”只在用户选择或设置页加载时读取一次 `matchMedia`，没有监听系统主题变化。
4. 主题逻辑写在页面组件中，无法被启动流程、快捷切换或其他窗口复用。
5. 当前字体颜色默认值固定为浅色 `#2c2418`，`initializeDisplayPreferences()` 会把 `--ink-*` 写成 `<html style>` 内联变量。该优先级高于主题 CSS，未来深色主题会出现深色背景配深棕文字。
6. `index.css` 约 1070 行，TSX 中另有约 100 个硬编码 hex/rgba 值。部分属于合法业务状态色，部分属于应迁移的主题表面色。
7. 部分变量使用不完整，例如样式引用 `--blue`，根 Token 中未统一声明。
8. 设置控件是普通下拉框，无法预览主题背景、色板和 light/dark 属性。
9. 没有 `color-scheme` 声明，浏览器原生 select、滚动条等控件不能稳定匹配主题。
10. 没有主题单元测试、系统模式测试、对比度检查和关键页面视觉回归清单。

## 4. 产品范围建议

### 4.1 首版内置主题

建议首版提供三个选择：

1. `system`：跟随系统；浅色映射到“天枢宣纸”，深色映射到“天枢玄夜”。
2. `tianshu-paper`：天枢宣纸，保留现有米白、墨色、金色风格。
3. `tianshu-night`：天枢玄夜，深蓝黑背景、低亮度面板、金色或星蓝强调色。

可在第二阶段增加：

4. `tianshu-starry`：天枢星河，带内置背景图和半透明面板的装饰主题。

“系统”是一个 selection mode，不应伪装成独立主题包。它根据媒体查询解析到真正的 theme id。

### 4.2 入口

- 设置 → 显示：主题卡片选择器，展示名称、外观、缩略色板和选中状态。
- 导航栏底部：可选的快捷切换按钮，点击在“跟随系统 / 宣纸 / 玄夜”间循环，长按或菜单进入设置。
- 主题改变后立即预览并持久化，不要求重启。
- 提供“恢复默认主题”，只重置主题，不覆盖字体和其他设置。

### 4.3 装饰背景规则

- 背景只来自随应用发布的本地资源。
- 背景层放在 `.app` 的伪元素或独立 `ThemeBackdrop`，设置 `pointer-events:none` 和 `aria-hidden`。
- 主页背景强度可以较高；会话、设置、角色编辑等任务页必须降低透明度和对比度。
- 面板必须提供实色/半透明遮罩，不能让图片直接影响正文可读性。
- `prefers-reduced-motion: reduce` 时关闭背景动画、光晕漂移和主题过渡。

## 5. 目标数据模型

建议新增 `web/client/src/features/theme/themePreferences.ts`：

```ts
export type BuiltinThemeId =
  | 'tianshu-paper'
  | 'tianshu-night'
  | 'tianshu-starry'

export type ThemeSelection =
  | { mode: 'system' }
  | { mode: 'fixed'; themeId: BuiltinThemeId }

export interface ThemePreferences {
  version: 1
  selection: ThemeSelection
}

export interface ThemeDefinition {
  id: BuiltinThemeId
  name: string
  description: string
  appearance: 'light' | 'dark'
  tokens: ThemeTokens
  artwork?: {
    url: string
    focusX: number
    focusY: number
    homeOpacity: number
    taskOpacity: number
    dim: number
  }
}
```

存储键建议：`tianshu:themePreferences`。

兼容旧键：

- `tianshu:theme=light` -> fixed `tianshu-paper`。
- `tianshu:theme=dark` -> fixed `tianshu-night`。
- `tianshu:theme=system` -> system。
- 迁移成功后可保留旧键一个版本，便于旧构建回滚；新代码只写 versioned JSON。
- JSON 损坏、版本未知、theme id 不存在时回退 `{ mode:'system' }`。

## 6. 主题 Token 设计

### 6.1 分层原则

不要让主题直接覆盖每一个组件选择器。分两层：

1. 主题原始 Token：每个主题定义自己的 canvas、surface、text、accent、state 等值。
2. 现有兼容 Token：`--bg-main`、`--bg-card` 等映射到新 Token，逐步迁移组件，不要求一次改完所有 CSS 名称。

建议 Token：

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

兼容映射示例：

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

### 6.2 作用域

在 `<html>` 上写：

```html
<html data-theme-selection="system" data-theme-id="tianshu-night" data-color-scheme="dark">
```

- `data-theme-selection`：用户选择，用于调试和 UI。
- `data-theme-id`：实际解析后的主题。
- `data-color-scheme`：light/dark shell。
- 同时设置 `document.documentElement.style.colorScheme` 或 CSS `color-scheme`。

CSS 按 `data-theme-id` 定义主题变量，组件只消费变量。

### 6.3 文字颜色与主题的优先级

必须升级现有 `DisplayPreferences`，否则深色主题无法正确工作。

建议 v2：

```ts
interface DisplayPreferencesV2 {
  version: 2
  fontFamily: FontFamilyId
  fontScale: number
  textColorMode: 'theme' | 'custom'
  textColor?: string
}
```

规则：

- 默认 `textColorMode='theme'`，不向 `<html style>` 写 `--ink-*`，由当前主题控制文字层级。
- 用户明确选择自定义字体颜色后才写 override。
- 自定义颜色必须针对当前主题背景做对比度提示；不阻止保存可以作为产品选择，但至少显示“对比度较低”。
- “恢复默认显示设置”恢复到 theme text，而不是固定浅色棕色。
- 主题切换不得重置字体、字号；字体自定义不得覆盖背景、边界和业务状态色。

## 7. 初始化与切换流程

### 7.1 启动前初始化

在 `web/client/src/main.tsx` 的 React render 之前调用：

```text
load preferences
  -> migrate legacy key
  -> validate selection
  -> resolve system/fixed theme
  -> apply root attributes and tokens
  -> initialize display preferences
  -> render React
```

这保证首页和直接打开的 `/chat/:sessionId` 不闪回浅色默认值。

如实际构建仍可观察到首帧闪白，再将一个最小、无依赖的 selection bootstrap 放到 `index.html`，只负责写 `data-theme-id`；完整校验仍由 TypeScript 模块完成。

### 7.2 运行时切换

建议 API：

```ts
loadThemePreferences()
saveThemePreferences()
normalizeThemePreferences()
resolveTheme(selection, prefersDark)
applyResolvedTheme(theme)
setThemeSelection(selection)
initializeThemePreferences()
resetThemePreferences()
```

`setThemeSelection` 的顺序：

1. 校验 selection 和目标定义。
2. 应用到 DOM。
3. 读取关键属性确认目标 theme id 已生效。
4. 再写 localStorage。
5. dispatch `tianshu:theme-changed` CustomEvent。
6. 失败时恢复上一个 resolved theme；上一个也无效则恢复 system/default。

内置常量主题通常不会应用失败，但该顺序为未来自定义主题保留正确边界。

### 7.3 跟随系统

- 使用 `matchMedia('(prefers-color-scheme: dark)')`。
- 只有 selection.mode 为 system 时响应 `change`。
- 兼容 `addEventListener`，必要时为旧 Electron 保留 `addListener` fallback。
- 初始化函数返回 cleanup，测试和 HMR 时可解除监听。
- 系统切换只改变 resolved theme，不重写用户 selection。

### 7.4 跨窗口同步

- 监听 `storage` 事件中的 `tianshu:themePreferences`。
- 收到变化后重新 load + normalize + resolve + apply。
- 发送事件的原窗口由 `setThemeSelection` 直接更新。
- 与 `displayPreferences` 的 storage 监听互不覆盖。

## 8. UI 开发计划

主要文件：

- `web/client/src/pages/SettingsPage.tsx`
- 建议新增 `web/client/src/features/theme/ThemeSelector.tsx`
- 可选新增 `web/client/src/components/ThemeQuickSwitch.tsx`

### 8.1 设置页

将当前 `<select>` 替换为主题卡片：

- 跟随系统卡：展示当前解析结果，例如“当前使用：天枢玄夜”。
- 宣纸卡：浅色背景、面板和金色强调预览。
- 玄夜卡：深色背景、面板和星蓝/金色强调预览。
- 星河卡：展示本地背景缩略图；未进入 P2 时不显示占位卡。
- 卡片使用真实按钮语义、`aria-pressed` 或 radio group、键盘方向键/Tab 可操作。
- 切换即时生效，选中标记不只依赖颜色。
- 增加恢复默认按钮和简短说明。

### 8.2 导航快捷切换

可在 `.nav-spacer` 附近增加一个按钮：

- 图标根据 resolved appearance 显示太阳/月亮/系统。
- 点击切换固定浅色与固定深色；菜单可切回系统。
- title/aria-label 明确当前模式和下一动作。
- 该入口与设置页复用同一 API，不直接操作 DOM 或 localStorage。

### 8.3 主题预览

预览卡只使用该卡内部 CSS 变量，不临时修改全局主题，避免 hover/浏览时整页闪动。

## 9. CSS 与组件改造范围

### P0：Token 审计

将所有颜色分成三类：

1. 主题颜色：页面背景、面板、输入框、普通文字、边界、阴影、hover。
2. 业务语义：成功、失败、警告、运行中、角色星色。
3. 固定资产颜色：图片、Logo、确需白色文字的强调按钮。

只有第 1 类必须迁移主题 Token；第 2 类映射到主题可调的语义 Token，但保持含义；第 3 类保留并写注释说明。

### P1：核心页面

优先覆盖：

- App/nav rail/setup overlay。
- HomePage。
- ChatPage、SessionPanel、ChatArea、RightPanel、FilePanel。
- 消息气泡、Markdown、代码块、引用、表格、tool call、reasoning。
- SettingsPage 和所有 dialog/popover。

### P2：管理页面

- Characters/CharacterDetail。
- Skills/SkillPackage/NewSkillPackage。
- Tools/MCP/Knowledge/Market/Events。
- 空状态、加载态、错误态、toast。

### 硬编码整改重点

- `rgba(44,36,24,...)` 遮罩和阴影改为 overlay/shadow Token。
- 金色/蓝色/绿色透明背景使用可复用的 `color-mix()` 或预定义 soft Token；若 Electron 兼容性不足则提供固定主题变量。
- `#fff` 只保留在明确的 on-accent 文本变量中，例如 `--theme-text-on-accent`。
- `#ef4444` 等错误色改为 `--theme-danger`。
- 所有 focus 状态统一使用 `--theme-focus-ring`，不能只靠边框颜色。

## 10. Dream Skin 风格装饰主题阶段

在基础 light/dark 完整通过后实现 `tianshu-starry`：

1. 新增一张有明确授权、无 UI 元素、无文字的本地背景图。
2. 背景图放到 `web/client/public/themes/tianshu-starry/` 或受构建管理的 assets 目录。
3. 定义焦点、主页透明度、任务页透明度和 dim 参数。
4. `.app::before` 或 `ThemeBackdrop` 统一渲染，不在各页面重复 background-image。
5. 根节点通过路由标识 `data-theme-route='home|task'`，或 App 根据 location 设置；CSS 使用不同 opacity。
6. 侧栏、卡片、输入区使用半透明 surface + blur；在不支持 blur 时回退更不透明的实色背景。
7. 背景加载失败时仍显示完整色板，不出现透明文字或空白页面。
8. 图片纳入安装包和 release 校验，禁止运行时依赖外部 CDN。

首版不做图片取色。主题色板由设计时固定，并用对比度测试验证。

## 11. 第三方主题的后续边界

如果以后需要像 Dream Skin 一样导入主题，必须单独立项，不能直接开放 CSS 文本框。

建议最小合同：

```text
theme.json
preview.png（可选）
background.webp|jpg|png（可选且只能一张）
```

- `theme.json` 只能声明已注册 Token，不能携带任意选择器或脚本。
- 背景限制文件大小、像素、解码后尺寸和 MIME，拒绝 SVG/HTML/data URL/远程 URL。
- 路径必须为包内相对路径，拒绝 traversal、符号链接、嵌套归档和重复路径。
- 导入只保存，不自动应用。
- 应用前再次校验，并保留 last-known-good。
- 若未来支持 Safe CSS，采用 Dream Skin 的公开 part + 属性白名单模型，不能直接把 CSS 插入 document。

该能力不属于本次主题切换首版验收范围。

## 12. 分阶段实施任务

### P0：测试先行与现状基线

1. 为旧 `light/dark/system` 存储值建立迁移测试。
2. 增加损坏 JSON、未知版本、未知 theme id 的回退测试。
3. 保存当前浅色关键页面截图作为“宣纸主题不得明显退化”的基线。
4. 建立硬编码颜色清单并分类，不要求一次机械替换所有颜色。

### P1：主题核心

建议新增：

- `web/client/src/features/theme/themeDefinitions.ts`
- `web/client/src/features/theme/themePreferences.ts`
- `web/client/src/features/theme/themePreferences.test.ts`

修改：

- `web/client/src/main.tsx`
- `web/client/src/index.css`
- `web/client/src/features/display/displayPreferences.ts`
- 对应 display preference 测试

完成存储迁移、启动初始化、系统监听、跨窗口同步、root attributes、display v2 协作和 paper/night Token。

### P1：设置页与快捷入口

1. 删除 `SettingsPage` 内部的 `applyTheme` 和散落 localStorage 写入。
2. 使用统一主题 API。
3. 实现主题卡片和恢复默认。
4. 可选实现导航快捷切换。

### P1：核心页面 Token 化

完成 App/Home/Chat/Settings/弹窗/Markdown 的 light 与 dark 覆盖，确保日常核心流程可用。

### P2：全部页面与装饰主题

1. 完成管理页面 Token 化。
2. 增加 `tianshu-starry` 背景主题。
3. 增加 home/task 背景强度区别、reduced motion 和图片失败回退。

### P3：可选主题包

只有用户明确需要自定义主题导入时再启动，按第 11 节独立设计和安全评审。

## 13. 测试计划

### 13.1 单元测试

- 空存储返回 system 默认。
- 旧 `light/dark/system` 正确迁移。
- versioned preference 正常保存/加载。
- 损坏 JSON、未知版本、未知 id 安全回退。
- system 在 prefersDark true/false 时解析正确。
- fixed theme 不随系统变化。
- apply 写入正确的三个 data attributes 和 color-scheme。
- storage event 更新其他窗口。
- reset 只重置主题。
- display v1 -> v2 迁移，默认文字改为 theme mode。
- custom text color 只覆盖文字 Token，不覆盖状态色。

### 13.2 组件测试

- 主题卡片具备 radio/pressed 语义。
- 键盘可选择主题。
- 当前 system resolved theme 正确显示。
- 主题切换后 UI 状态与 root attribute 一致。
- 未知主题不会渲染空白预览。

### 13.3 手工与浏览器视觉测试

矩阵：

| 页面 | 宣纸 | 玄夜 | 系统切换 | 星河 |
|---|---:|---:|---:|---:|
| 首页 | 必测 | 必测 | 必测 | P2 必测 |
| 无会话占位 | 必测 | 必测 | 必测 | P2 必测 |
| 长会话/Markdown/代码块 | 必测 | 必测 | 必测 | P2 必测 |
| 设置页 | 必测 | 必测 | 必测 | P2 必测 |
| 角色详情 | 必测 | 必测 | 抽测 | P2 必测 |
| 工具/MCP/技能 | 必测 | 必测 | 抽测 | P2 抽测 |
| dialog/toast/approval | 必测 | 必测 | 抽测 | P2 必测 |

窗口宽度至少覆盖 1280、1440、1920 和窄窗口；字体缩放覆盖 80%、100%、140%。

### 13.4 可访问性

- 普通正文与背景至少达到 WCAG AA 4.5:1。
- 大字和非文本控件至少达到 3:1。
- focus-visible 在所有主题可见。
- 选中状态不只依赖颜色。
- reduced motion 下无非必要动画。
- 背景图不进入辅助技术，不拦截鼠标。

### 13.5 构建验证

在 `web/client`：

```powershell
npm test
npm run build
```

再通过项目 `run.bat` 启动真实桌面构建，验证刷新、直接深链、系统主题变化和跨窗口行为。

## 14. 验收标准

全部满足才算完成：

1. 浅色、深色和跟随系统都有真实视觉变化。
2. 任意路由刷新后，在首个 React 页面显示前应用正确主题。
3. system 模式能实时响应操作系统 light/dark 改变。
4. 用户选择在重启后保留，损坏设置会自动恢复。
5. 设置页不再直接操作 `data-theme` 或裸 localStorage。
6. 玄夜主题的首页、会话、输入框、Markdown、代码块、弹窗和设置页均可读。
7. 默认字体设置不会覆盖主题文字颜色；自定义字体颜色有明确优先级。
8. 状态色语义在所有主题保持一致。
9. 宣纸主题基本保持现有视觉，不因 Token 改造明显退化。
10. 装饰背景不拦截交互，任务页可读，图片失败时可安全降级。
11. 单元测试和前端构建通过。
12. 没有引入外部 CDP、远程 CSS 或运行时网络主题依赖。

## 15. 推荐实施顺序

1. P0 存储与视觉基线测试。
2. 建立 theme definitions/preferences 核心模块。
3. 在 main.tsx 启动前初始化，完成 system/storage 监听。
4. 升级 display preferences v2，解决字体颜色优先级。
5. 建立 paper/night Token 和现有变量兼容映射。
6. 改造 SettingsPage 主题卡片。
7. 完成 App/Home/Chat/Settings 核心页面颜色审计。
8. 完成剩余页面和弹层。
9. 做 WCAG、字体缩放、窗口尺寸和真实桌面回归。
10. P2 增加 starry 装饰主题。
11. 主题导入保持 P3，未经单独授权不实现。

## 16. 开发约束

- 不把所有硬编码颜色机械替换为同一个变量；先识别语义。
- 不在 React 组件内直接写 localStorage、`documentElement` 或 `matchMedia` 主题逻辑。
- 不让主题定义包含函数、HTML、JavaScript 或任意 CSS。
- 不用背景图替代真实 UI，不把按钮、文字、侧栏绘制进图片。
- 不为装饰效果降低正文对比度或控件可操作性。
- 不覆盖字体设置的独立职责；主题和显示偏好通过清晰的 Token 优先级组合。
- 不把 P3 第三方主题导入夹带进首版开发。

