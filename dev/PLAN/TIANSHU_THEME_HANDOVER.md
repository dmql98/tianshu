# 主题切换与自定义主题工作台阶段交接报告

> 阶段：TianShu 第三阶段（TIANSHU_THEME_SWITCHING_PLAN.md）
> 基线：Run Policy（提交 1bd5486）+ Builtin Content（提交 c0587f7/dfee84e）已完成
> 日期：2026-08-13

## 1. 修改文件

### 新增（前端）
| 文件 | 说明 |
|---|---|
| `web/client/src/features/theme/themeDefinitions.ts` | 主题数据模型 v2：`tianshu-light`/`tianshu-dark` 内置主题、`ThemeTokens`（25 语义 Token）、`ThemeArtwork`、`ThemeSelection`（system/builtin/custom）、旧 ID 迁移映射 |
| `web/client/src/features/theme/themePreferences.ts` | 轻量选择存储 v2（`tianshu:themePreferences`）：旧键 `tianshu:theme` 迁移、损坏/未知版本/未知 ID 回退、custom ID 拒绝路径/URL |
| `web/client/src/features/theme/themeRuntime.ts` | resolve/apply/监听：attributes+color-scheme+注册 Token+backdrop 写入、custom→builtin 残留清理、matchMedia 系统监听、storage 跨窗口同步、启动前初始化 |
| `web/client/src/features/theme/contrast.ts` | WCAG 相对亮度/对比度、`adjustToContrast` 二分校正（保留色相）、外观推断、颜色混色 |
| `web/client/src/features/theme/colorExtraction.ts` | 降采样预算（40k 像素）、k-means 聚类、相近簇合并、透明过滤、外观推断、对比度校正色板生成 |
| `web/client/src/features/theme/themeApi.ts` | 服务端主题 API 客户端（fetch/create/update/duplicate/delete/rename/assets） |
| `web/client/src/features/theme/ThemeSelector.tsx` | 设置页主题卡片：跟随系统/浅/深 + 自定义列表 + 应用/编辑/复制/重命名/删除（radio 语义） |
| `web/client/src/features/theme/ThemeStudio.tsx` | 工作台：选图/拖放/解码、取色、焦点拖动+滑块、色板微调、对比度提示+修正、撤销/重做、首页/任务页预览、保存 |
| `web/client/src/features/theme/ThemeBackdrop.tsx` | 统一背景层（pointer-events:none、aria-hidden、home/task 强度） |
| `web/client/src/features/theme/themePreferences.test.ts` | 迁移/回退/轻量存储测试（重写） |
| `web/client/src/features/theme/themeRuntime.test.ts` | resolve/apply/残留清理/系统监听测试 |
| `web/client/src/features/theme/themeColors.test.ts` | 对比度/取色/色板测试 |

### 新增（服务端）
| 文件 | 说明 |
|---|---|
| `web/server/src/theme/schema.ts` | 主题 schema：ID 形状校验（custom-<slug>）、素材文件名白名单（拒绝对路径/`..`/分隔符）、颜色 slot 白名单、记录解析/损坏识别 |
| `web/server/src/theme/image-validation.ts` | magic bytes（PNG/JPEG/WebP）+ 头部结构解码（IHDR/SOF/VP8X/VP8/VP8L）、APNG/动画 WebP 拒绝、字节/像素/单边/长宽比限制 |
| `web/server/src/theme/store.ts` | `themesRoot()` CRUD：`.tmp-` 原子提交（素材先写、theme.json 最后写、失败保留旧版）、损坏隔离、资产只读已登记文件、临时目录清理、复制/重命名/删除 |
| `web/server/src/routes/themes.ts` | 主题 API（见 §2）+ `initThemeStore()` 启动清理 |
| `web/server/test/theme-schema.test.ts` | 12 项 |
| `web/server/test/theme-image-validation.test.ts` | 13 项 |
| `web/server/test/theme-store.test.ts` | 17 项 |
| `web/server/test/theme-api.test.ts` | 11 项 |
| `scripts/verify-theme-e2e.mjs` | 主题端到端验证脚本（生命周期/原子/config 保留/损坏隔离/重启恢复） |

### 修改
| 文件 | 说明 |
|---|---|
| `web/client/src/main.tsx` | React 首次渲染前 `initializeThemeRuntime()` + `initializeDisplayPreferences()` |
| `web/client/src/App.tsx` | 挂载 ThemeBackdrop（路由驱动 home/task 强度）；启动后拉取服务端自定义主题并重新应用选择（§9.1） |
| `web/client/src/index.css` | `:root` 浅色 `--theme-*` 25 Token + `[data-color-scheme="dark"]` 深色覆盖 + 旧变量迁移映射（`--bg-main:var(--theme-canvas)` 等）+ ThemeBackdrop/focus-visible/scrollbar/reduced-motion + ThemeSelector/ThemeStudio 样式；硬编码颜色批量迁移为 token/color-mix |
| `web/client/src/pages/SettingsPage.tsx` | 移除裸 data-theme/旧 `tianshu:theme` select；挂载 ThemeSelector+ThemeStudio 独立组件；字体颜色对比度提示；"运行与安全"区域未动 |
| `web/client/src/features/display/displayPreferences.ts` | 新增 `textColorContrastOn()` 对比度提示 helper（v2 契约本已满足） |
| `web/client/src/pages/CharacterDetailPage.tsx`、`NewSkillPackagePage.tsx` | 硬编码语义色 → var(--cinnabar)/var(--star-ziwei) |
| `web/server/src/app.ts` | 挂载 `/api/themes` + `initThemeStore()` |
| `graphify-out/*` | `graphify update .` 更新（6187 nodes, 9805 edges） |

## 2. 主题目录与 API 协议

```text
<dataDir>/themes/                       # 只存用户自定义主题（公共 data-paths.ts themesRoot()）
├─ custom-<slug>-<rand>/
│  ├─ theme.json                        # 提交标记与事实来源（最后写入）
│  ├─ background.png|jpg|webp           # 规范化背景素材
│  └─ preview.webp                      # 列表缩略图（可选）
└─ .tmp-<id>-<nonce>/                   # 原子提交临时目录（启动清理超时残留）
```

theme.json：
```json
{
  "schemaVersion": 1,
  "id": "custom-forest-a1b2c3",
  "name": "森林",
  "appearance": "dark",
  "artwork": { "file": "background.png", "focusX": 0.58, "focusY": 0.36,
               "homeOpacity": 0.8, "taskOpacity": 0.35, "dim": 0.25 },
  "colors": { "canvas": "#111713", "surface1": "#1b241e", "accent": "#8faf76",
              "textPrimary": "#f2f5ef", "textSecondary": "#b8c2b5", "border": "#435047", "...": "..." },
  "createdAt": "...", "updatedAt": "..."
}
```

API（`web/server/src/routes/themes.ts`）：
```text
GET    /api/themes                      # 列表（损坏主题跳过并记录诊断）
GET    /api/themes/:id                  # 详情（缺素材视为无效 → 404）
POST   /api/themes                      # multipart 创建（name/appearance/colors/artwork/background/preview）
PUT    /api/themes/:id                  # multipart 更新；JSON {name} 重命名
POST   /api/themes/:id/duplicate        # 复制
DELETE /api/themes/:id                  # 删除目录
GET    /api/themes/:id/assets           # 资产清单
GET    /api/themes/:id/assets/:file     # 只读已登记文件（nosniff + CSP sandbox + immutable）
```

安全规则：ID/文件名/路径服务端校验（拒 traversal/绝对路径/符号链接/目录外访问）；图片只接受 JPEG/PNG/静态 WebP（magic bytes + 结构解码 + ≤15MB + ≤4000 万像素 + ≤10000px 单边 + 长宽比 1:20~20:1）；拒绝 SVG/HTML/GIF/动图/data URL/远程 URL；资产路由只访问已登记文件。

## 3. 取色算法与对比度策略

**取色**（`colorExtraction.ts`）：
1. 浏览器真实解码（createImageBitmap，fallback Image+canvas）→ 按 40k 像素预算降采样（最大边 256）。
2. 过滤透明像素（alpha<128）→ RGB 空间确定性初始化 k-means（6 簇 × 8 轮）→ 相近簇合并（距离<28）→ 丢弃占比 <3% 的噪声簇。
3. 加权亮度均值推断建议外观（≥0.5 → light）。
4. 从候选色选最饱和者为强调色源（饱和度过低退回默认金系）。

**色板生成**（`generatePalette`）：
- 画布：深色外观向黑混 70%、浅色外观向白混 72%（保持外观方向，不做反向提亮）。
- 表面/输入/边界由画布派生；语义色（success/warning/danger/info）固定双套深浅值。
- **对比度校正**（`contrast.ts`）：正文/次要文字经 `adjustToContrast` 二分搜索（32 轮、精度 1/65536、保留色相）保证与画布 ≥4.5:1；`textOnAccent` 按强调色亮度选黑白文字；面板正文 ≥4.5:1；次要 ≥4.5、弱化 ≥3。图片主色绝不直接作为文字色。
- 用户手动修改的色槽实时显示对比度（✓/✗），不合格提供"修正"按钮（`adjustToContrast` 自动校正）。

## 4. 数据迁移

- 前端 `tianshu:theme`（light/dark/system）→ `tianshu:themePreferences` v2 selection（旧键保留可回滚）。
- 旧内置 ID：`tianshu-paper`→`tianshu-light`、`tianshu-night`→`tianshu-dark`；`tianshu-starry` 不再内置 → system。
- 旧实验实现（`custom:` 主题存 localStorage、`tianshu-bg://` 协议）已整体替换为服务端模型；v2 存储只含轻量 selection。
- 自定义主题事实数据迁移到 `<dataDir>/themes/`；图片/完整主题不进 localStorage/IndexedDB/userData 固定目录。
- displayPreferences v1→v2（textColorMode）迁移逻辑保留（Builtin 阶段已实现）。
- **config.json 零改动**：主题功能不写 config；`dataDir`/`runPolicy` 原子保存契约不变（e2e 验证）。

## 5. Run Policy 回归结果

- 服务端 vitest：**15 文件 / 133 测试全部通过**（基线 80 + 主题新增 53）。
- Run Policy 专项：`run-policy` 18 + `run-policy-api` 5 + `run-store-policy` 10 + `recovery` 3 = **36 项通过**。
- 保留契约：config.json 同存 dataDir+runPolicy（e2e 确认主题保存后不变）；ActiveRunState/自动续跑事件归并/整链停止/重连恢复（chatStore 未改动）；SettingsPage"运行与安全"区域原样保留；RightPanel 运行策略摘要原样保留。

## 6. Builtin 回归结果

- `data-paths` 4 + `builtin-catalog` 6 + `copy-on-write` 5 = **15 项通过**（+ recovery 3）。
- `scripts/verify-builtin-e2e.mjs` 全部检查通过：7 角色/12 技能/17 Provider、config 保存重载、编辑物化、`.tianshu-source.json`、builtin 源 hash 不变。
- 主题模块复用 `themesRoot()`（与 `charactersRoot()`/`skillsRoot()` 同一 `dataRoot()`），未新建同义路径模块；内置主题由前端代码+CSS 提供，不写入 `<dataDir>/themes`；主题不参与角色/技能 copy-on-write 与 content-state 隐藏。

## 7. Theme 专项测试与视觉验收

| 测试文件 | 数量 | 覆盖 |
|---|---|---|
| client `themePreferences.test.ts` | 13 | 空偏好、旧键/旧 ID 迁移、损坏/未知版本/未知 ID 回退、custom ID 拒绝路径、轻量存储 |
| client `themeRuntime.test.ts` | 11 | resolve（system/builtin/custom）、attributes/color-scheme/token 写入、custom→builtin 残留清理、matchMedia 响应、持久化 dispatch |
| client `themeColors.test.ts` | 25 | WCAG 亮度/对比度、adjustToContrast AA 4.5、降采样预算、k-means/合并、透明/极暗/极亮/噪声、深/浅色板 ≥4.5:1 |
| server `theme-schema.test.ts` | 12 | ID/文件名/颜色校验、记录解析、损坏/未知版本/缺核心色板 |
| server `theme-image-validation.test.ts` | 13 | magic bytes、PNG/JPEG/WebP 尺寸、APNG/动画 WebP/GIF/SVG 拒绝、字节/像素/单边/长宽比/损坏 |
| server `theme-store.test.ts` | 17 | 同根、生命周期、原子性/失败保留/无残留、损坏隔离、资产安全、临时清理、createdAt 保留 |
| server `theme-api.test.ts` | 11 | 列表/详情/资产、multipart 创建校验、复制/重命名/删除、404/400 |
| `scripts/verify-theme-e2e.mjs` | 8 项 | 创建→列表→资产、**config.json 主题保存后 dataDir+runPolicy 不变**、同根、复制/重命名、损坏隔离、删除、**重启恢复** |

视觉验收矩阵（自动层）：两个内置主题（浅=暖纸色延续、深=完整深色 Token）、system 实时解析（matchMedia 测试）、自定义主题 Token 全量注入（runtime 测试）、首页/任务页背景强度（backdrop CSS）、focus-visible 全部主题可见（全局样式）、reduced-motion 关闭动画。**浏览器内人工视觉验收为未完成项（见 §9）**。

## 8. 构建结果

| 目标 | 命令 | 结果 |
|---|---|---|
| Client 测试 | `npm test --prefix web/client` | ✅ 69/69（基线 29 + 主题 40） |
| Client 构建 | `npm run build --prefix web/client` | ✅ tsc + vite |
| Server 测试 | `npm test --prefix web/server` | ✅ 133/133（基线 80 + 主题 53） |
| Server 构建 | `npm run build --prefix web/server` | ✅ tsc + tool.json |
| Desktop 测试 | `npm test --prefix desktop` | ✅ 16/16 |
| Desktop 构建 | `npm run build --prefix desktop` | ✅ tsc |
| graphify | `graphify update .` | ✅ 6187 nodes / 9805 edges / 494 communities |

## 9. 未完成项、已知限制与人工验收项

1. **浏览器内人工视觉验收未执行**：浅/深/自定义主题在真实窗口（1280/1440/1920/窄窗口、80%/100%/140% 字体缩放）下的逐页视觉矩阵、跨窗口同步实机验证、系统主题热切换实机验证需人工在 `run.bat` 启动后确认。
2. **ThemeStudio 预览为结构化占位**：首页/任务页预览使用简化 UI 骨架（侧栏+卡片+文字），非完整页面截图级预览；真实页面渲染以运行时 Token 生效为准。
3. **preview.webp 缩略图未自动生成**：工作台保存时预览图留空（首版允许无预览图，列表卡片以背景图+色板呈现）。
4. **Web Worker 取色未实现**：40k 像素降采样在 UI 线程执行；超大图（接近 4000 万像素）解码可能短暂卡顿（计划 P2 优化项）。
5. **ZIP 主题包导入导出**（计划 P3）未实现。
6. **技能/角色页面隐藏/恢复 UI**（Builtin 交接遗留）仍未实现，与主题无关。
7. **安装包构建**（`npm run dist:win`）未在本机执行（Builtin 交接遗留，需网络下载 portable Node）；desktop build（tsc）已通过。
8. 遗留：`graphify-out/graph.html` 因节点超限（6187 > 5000）未生成 HTML 可视化；graph.json/GRAPH_REPORT.md 已更新。
9. 人工验收建议清单：① 设置→显示切换浅/深/system 并刷新各路由；② 切换 Windows 深色模式观察 system 实时跟随；③ 创建自定义主题（选图→取色→调焦点→保存→重启验证恢复）；④ 删除当前主题验证自动回退 system；⑤ 双窗口同步；⑥ 手动损坏 `<dataDir>/themes/<id>/theme.json` 验证安全回退；⑦ 检查 `config.json` 在全部主题操作后 dataDir/runPolicy 不变。

## 10. 契约履行确认

- ✅ `themesRoot()` 复用公共 `data-paths.ts`（未新建同义模块）；Builtin 阶段缺失时本阶段已按计划停止并报告（未发生）。
- ✅ 主题不整对象覆盖 config.json；不删除/重置/迁移 runPolicy。
- ✅ 内置主题由前端代码+CSS 提供，不放入 content/builtin、不复制进 `<dataDir>/themes`。
- ✅ 主题不参与角色/技能 copy-on-write、content-state、同 ID 双层覆盖。
- ✅ 未修改 CharacterRunPolicy / SystemRunPolicy / character revision / RunPolicySnapshot schema。
- ✅ SettingsPage"运行与安全"保留；Theme UI 独立组件挂载；RightPanel 运行策略摘要与业务逻辑未动。
- ✅ chatStore ActiveRunState/自动续跑事件归并/整链停止/重连恢复未动；主题切换不触碰 activeRunId/输入框状态。
- ✅ 图片与完整主题不存 localStorage/IndexedDB/固定 userData/远程 CDN；localStorage 仅存轻量 selection。
- ✅ 未提交/推送/发布安装包/修改安装目录。
