# TianShu 全局字体显示设置开发计划

> 交接对象：OpenCode  
> 任务性质：前端显示偏好功能  
> 目标：在“设置 → 显示”中增加全局字体、字体大小和字体颜色设置

## 1. 开发目标

在“设置 → 显示”中增加以下全局显示选项：

1. 字体
2. 字体大小
3. 字体颜色
4. 恢复默认显示设置

要求：

- 修改后立即生效，不需要刷新页面。
- 重新启动 Web 或桌面客户端后继续生效。
- 所有页面共享同一套设置。
- 不需要修改后端数据库或增加 API。
- 不影响错误、成功、警告、链接等语义颜色。
- 不降低聊天气泡、按钮等区域的文字对比度。
- 保持当前默认视觉不变。

## 2. 当前代码情况

主要相关文件：

- `web/client/src/pages/SettingsPage.tsx`
  - 已有“显示”页签。
  - 已使用 `tianshu:*` 格式的 `localStorage` 保存主题等显示偏好。
  - 当前主题仅在打开设置页面后调用 `applyTheme()`。
- `web/client/src/index.css`
  - 全局字体硬编码在 `body`：

    ```css
    font-family:"霞鹜文楷","LXGW WenKai","Kaiti SC","STKaiti",serif
    ```

  - 文字颜色主要通过以下变量控制：

    ```css
    --ink-deep
    --ink-mid
    --ink-light
    --ink-faint
    ```

  - 存在约 284 个 CSS `font-size` 声明。
- `web/client/src/main.tsx`
  - 当前没有在 React 渲染前初始化显示偏好。
- TSX 文件中还存在约 176 个内联 `fontSize`，其中既有文字，也有图标、Emoji 和角色头像尺寸，不能全部机械缩放。

## 3. 功能范围定义

本功能定义为“全局界面文字显示设置”，覆盖：

- 导航栏文字
- 页面标题和正文
- 设置页面
- 会话列表
- 聊天消息
- Markdown 正文
- 输入框、按钮、下拉框
- 工具调用和推理内容
- 角色、技能、工具、知识库、事件等页面的普通文字

默认不覆盖：

- 代码块字体：继续使用等宽字体。
- 图标、Emoji、Logo、角色头像中的字符尺寸。
- 成功、错误、警告、链接和品牌色。
- 用户消息金色气泡中的白色文字。
- 角色视觉资源本身。
- 自定义字体文件上传。
- 从互联网动态下载任意字体。

## 4. 设置项设计

### 4.1 字体

设置名称：`界面字体`

建议选项：

```ts
type FontFamilyId =
  | 'wenkai'
  | 'system-sans'
  | 'system-serif'
  | 'monospace'
```

对应字体栈：

```ts
const FONT_FAMILIES = {
  wenkai: '"霞鹜文楷","LXGW WenKai","Kaiti SC","STKaiti",serif',
  'system-sans':
    'system-ui,-apple-system,"Segoe UI","Microsoft YaHei","PingFang SC",sans-serif',
  'system-serif':
    '"Noto Serif CJK SC","Source Han Serif SC","Songti SC","SimSun",serif',
  monospace:
    'Consolas,"Cascadia Code","SFMono-Regular","Courier New",monospace',
}
```

默认值：`wenkai`。

设置界面使用 `<select>`，每个选项名称：

- 霞鹜文楷
- 系统黑体
- 系统宋体
- 等宽字体

代码块仍应使用原有等宽字体，不继承用户选择。

### 4.2 字体大小

设置名称：`字体大小`

建议使用范围滑块：

- 最小：80%
- 最大：140%
- 步长：5%
- 默认：100%

同时显示当前值，例如：

```text
字体大小    [────●────] 110%
```

建议增加快捷预设按钮：

- 小：90%
- 标准：100%
- 大：115%
- 特大：130%

底层值使用整数百分比，不保存浮点数：

```ts
fontScale: number // 80–140
```

### 4.3 字体颜色

设置名称：`字体颜色`

控件：

- `<input type="color">`
- HEX 文本输入框
- 单项“恢复默认”按钮

要求：

- 只接受 `#RRGGBB`。
- 输入非法值时不要应用，也不要覆盖上一次合法值。
- 文本框失焦或按 Enter 后提交。
- 颜色选择器变化时立即应用。
- 默认颜色为现有 `--ink-deep` 的 `#2c2418`。
- 次要文字颜色由主字体颜色派生，不要求用户分别设置四种颜色。

建议派生关系：

```css
--ink-deep: var(--ui-text-color);
--ink-mid: color-mix(in srgb, var(--ui-text-color) 78%, transparent);
--ink-light: color-mix(in srgb, var(--ui-text-color) 58%, transparent);
--ink-faint: color-mix(in srgb, var(--ui-text-color) 38%, transparent);
```

注意：

- `--gold`、`--jade`、`--cinnabar`、各角色星色保持不变。
- `.msg-group.user .msg-bubble` 内继续使用白色文字，避免用户选深色后失去对比度。
- 按钮、标签等具有固定背景色的组件需要做一次对比度检查。

## 5. 数据结构和持久化

新增文件：

```text
web/client/src/features/display/displayPreferences.ts
```

建议结构：

```ts
export interface DisplayPreferences {
  fontFamily: FontFamilyId
  fontScale: number
  textColor: string
}

export const DEFAULT_DISPLAY_PREFERENCES: DisplayPreferences = {
  fontFamily: 'wenkai',
  fontScale: 100,
  textColor: '#2c2418',
}
```

localStorage Key：

```text
tianshu:displayPreferences
```

保存为一个带版本号的 JSON：

```json
{
  "version": 1,
  "fontFamily": "wenkai",
  "fontScale": 100,
  "textColor": "#2c2418"
}
```

不要为三个字段继续增加三个零散 Key，便于后续迁移。

模块至少导出：

```ts
loadDisplayPreferences()
saveDisplayPreferences(preferences)
applyDisplayPreferences(preferences)
resetDisplayPreferences()
isValidHexColor(value)
normalizeDisplayPreferences(value)
```

读取时必须容错：

- JSON 损坏时使用默认值。
- 字体枚举非法时使用默认字体。
- 字号小于 80 时修正为 80。
- 字号大于 140 时修正为 140。
- 字体颜色非法时使用默认颜色。
- 不允许把未经验证的字符串直接写入 `font-family`。

## 6. CSS 实现

### 6.1 增加全局变量

在 `index.css` 的 `:root` 中增加：

```css
:root {
  --ui-font-family: "霞鹜文楷","LXGW WenKai","Kaiti SC","STKaiti",serif;
  --ui-font-scale: 1;
  --ui-text-color: #2c2418;

  --font-2xs: calc(9px * var(--ui-font-scale));
  --font-xs: calc(10px * var(--ui-font-scale));
  --font-sm: calc(11px * var(--ui-font-scale));
  --font-md: calc(12px * var(--ui-font-scale));
  --font-base: calc(13px * var(--ui-font-scale));
  --font-lg: calc(14px * var(--ui-font-scale));
  --font-xl: calc(16px * var(--ui-font-scale));
  --font-2xl: calc(18px * var(--ui-font-scale));
  --font-3xl: calc(20px * var(--ui-font-scale));
}
```

将 `body` 改为：

```css
body {
  font-family: var(--ui-font-family);
  color: var(--ink-deep);
}
```

### 6.2 字号改造原则

不能只设置：

```css
html { font-size: ... }
```

因为项目中绝大多数字号使用固定 `px`，这种方案不会真正改变全局字号。

需要把普通文字字号迁移到字号 Token，例如：

```css
.msg-bubble {
  font-size: var(--font-lg);
}

.setting-label {
  font-size: var(--font-base);
}

.setting-hint {
  font-size: var(--font-sm);
}
```

处理顺序：

1. 聊天正文、Markdown、输入框。
2. 设置页面。
3. 导航和会话列表。
4. 其他业务页面。
5. TSX 内联文字字号。

不要迁移以下内容：

- `.nav-item` 中用于 Emoji 图标的 18px。
- 角色头像、空状态插图、Logo。
- 图表视觉标记。
- 纯装饰字符。
- 依靠 `font-size` 控制图标大小的元素。

TSX 普通文字的内联字号应尽量移到 CSS class 中，不要大量写：

```tsx
style={{ fontSize: 'var(--font-base)' }}
```

确实无法迁移时才使用 CSS 变量字符串。

### 6.3 页面布局保护

字号提高到 140% 后重点检查：

- 导航栏标签是否溢出。
- 180px 设置侧栏是否需要增宽或允许文字换行。
- 会话标题是否仍正确省略。
- 按钮高度是否足够。
- 设置项左右布局是否重叠。
- 输入区是否被挤压。
- 小窗口下是否出现无法访问的内容。

允许必要时为设置行增加响应式规则：

```css
@media (max-width: 760px) {
  .setting-row {
    align-items: stretch;
    flex-direction: column;
    gap: 8px;
  }

  .setting-control {
    width: 100%;
  }
}
```

## 7. 初始化流程

在 `web/client/src/main.tsx` 渲染 React 之前执行：

```ts
const preferences = loadDisplayPreferences()
applyDisplayPreferences(preferences)
```

`applyDisplayPreferences()` 应修改根元素变量：

```ts
const root = document.documentElement

root.style.setProperty('--ui-font-family', FONT_FAMILIES[prefs.fontFamily])
root.style.setProperty('--ui-font-scale', String(prefs.fontScale / 100))
root.style.setProperty('--ui-text-color', prefs.textColor)
```

这样可以：

- 避免启动时先显示默认字体再闪变。
- 不依赖用户先进入设置页面。
- 同时适用于浏览器和 Electron。

建议把现有主题初始化也迁移到启动阶段，至少保证字体功能不要重复现有“只有进入设置页才应用”的问题。

## 8. SettingsPage 改造

在“显示”区域的主题设置下面增加三个 `setting-row`：

1. 界面字体
2. 字体大小
3. 字体颜色

再增加：

- 预览区域
- “恢复默认显示设置”按钮

预览内容建议：

```text
天枢 TianShu · 让智能体拥有长期记忆
当前字体  100%  #2c2418
```

预览框应直接使用当前 CSS 变量，用户修改后立即变化。

状态初始化：

```ts
const [displayPreferences, setDisplayPreferences] =
  useState(loadDisplayPreferences)
```

统一更新函数：

```ts
function updateDisplayPreferences(
  patch: Partial<DisplayPreferences>
) {
  const next = normalizeDisplayPreferences({
    ...displayPreferences,
    ...patch,
  })

  setDisplayPreferences(next)
  saveDisplayPreferences(next)
  applyDisplayPreferences(next)
}
```

恢复默认时：

1. 写入默认值。
2. 立即应用。
3. 同步全部表单。
4. 显示现有 Toast：“显示设置已恢复默认”。

## 9. 跨窗口同步

桌面客户端可能打开多个渲染窗口，因此增加 `storage` 监听：

```ts
window.addEventListener('storage', event => {
  if (event.key === DISPLAY_PREFERENCES_STORAGE_KEY) {
    applyDisplayPreferences(loadDisplayPreferences())
  }
})
```

如果当前 Electron 只使用单窗口，这部分依然保留，成本很低。

必须在卸载时移除监听，或者在入口模块只注册一次。

## 10. 测试计划

### 10.1 单元测试

客户端当前没有测试脚本，建议增加 Vitest：

```json
{
  "scripts": {
    "test": "vitest run"
  }
}
```

新增：

```text
web/client/src/features/display/displayPreferences.test.ts
```

覆盖：

- localStorage 无数据时返回默认值。
- 合法数据能正确读取。
- 损坏 JSON 回退默认值。
- 非法字体 ID 回退默认字体。
- 字号低于 80 被钳制为 80。
- 字号高于 140 被钳制为 140。
- 合法 HEX 被接受。
- 简写 `#fff`、无 `#`、含非法字符的颜色被拒绝。
- `applyDisplayPreferences()` 正确写入三个 CSS 变量。
- reset 后恢复默认配置。

### 10.2 构建验证

执行：

```powershell
npm run build --prefix web/client
```

如果增加测试：

```powershell
npm test --prefix web/client
```

### 10.3 手工验收矩阵

至少测试：

- 浏览器开发模式。
- Electron 桌面客户端。
- 80%、100%、140% 三档字号。
- 四种字体。
- 黑色、白色、高饱和颜色。
- 刷新页面后配置保留。
- 关闭并重新打开客户端后配置保留。
- 直接打开 `/chat` 时立即应用，不需要先进入设置。
- 聊天消息、Markdown、代码块、推理块、工具调用。
- 设置、角色、技能、工具、知识、事件页面。
- 用户消息气泡、错误提示、成功提示仍清晰可读。

## 11. 验收标准

以下条件全部满足才算完成：

- “设置 → 显示”存在字体、字号、字体颜色控件。
- 修改任一选项后 100ms 内全局生效。
- 刷新和重启后设置仍然存在。
- 默认值与当前界面视觉基本一致。
- 字号 80%–140% 范围有效且不会把主要控件挤出可视区域。
- 普通界面文字随字号变化，不能只有聊天正文变化。
- Emoji、Logo、角色头像没有被错误放大。
- 代码块保持等宽字体。
- 语义颜色没有被全局字体颜色覆盖。
- 用户消息气泡仍保持足够对比度。
- 非法 localStorage 数据不会导致白屏。
- TypeScript 构建通过。
- 完成代码修改后执行：

  ```powershell
  graphify update .
  ```

## 12. 推荐实施顺序

1. 创建 `displayPreferences.ts`，完成类型、默认值、校验和持久化。
2. 在 `main.tsx` 增加启动前应用逻辑。
3. 在 `index.css` 增加字体、缩放、颜色变量。
4. 修改 `SettingsPage.tsx`，加入控件、预览和重置。
5. 优先迁移聊天及设置页面字号。
6. 审核并迁移其他普通文字字号。
7. 单独审核 TSX 内联 `fontSize`，区分文字与图标。
8. 加入测试并执行客户端构建。
9. 完成 80%/100%/140% 和多颜色人工验收。
10. 运行 `graphify update .` 更新知识图谱。

## 13. 实施约束

- 不要修改后端配置、数据库结构或桌面 IPC；该功能属于设备本地的纯前端显示偏好。
- 不要直接对所有 `font-size` 做无差别批量替换，必须区分普通文字与图标/装饰字符。
- 不要允许用户输入任意未经校验的 CSS 字体字符串。
- 不要用 `zoom` 或 `transform: scale()` 实现字体缩放，这会破坏窗口尺寸、固定定位和滚动区域。
- 不要让用户字体颜色覆盖成功、错误、警告、品牌色和需要固定高对比度的文字。
- 保留用户工作区中的既有改动，不要清理或覆盖无关文件。
