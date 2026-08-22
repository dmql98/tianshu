# 内置内容单层化方案：seed-once, read-dataDir-only

> 拟案日期：2026-08-22 ｜ 关联：上一轮已修复主题/iconpack 的「服务端 config 持久化」接线路由
> 目标：明确初次安装初始化；运行链路完全只依赖 `<dataDir>`，`content/builtin` 仅作为首装/补种的 seed 源，运行期零依赖。

---

## 0. 背景与动机

上一轮修复主题/图标包无法持久化时确认：桌面端每次启动随机端口 → `localStorage` 按 origin 隔离失效，已把权威来源改为服务端 `<dataDir>/config/{theme,iconpack}.json`。

但更底层的事实是：**运行链路仍有多处直接读取 `content/builtin`（随安装包分发的只读出厂底稿）**。这意味着 `dataDir` 目前并不是唯一的权威来源。本方案的目标是把 `content/builtin` 降级为「只在启动早期被复制一次」的 seed 源，之后所有 store/catalog 的读路径只扫 `dataDir`，实现「初次安装初始化明确化 + 运行链路完全只使用 dataDir」。

---

## 1. 现状诊断

### 1.1 运行时对 `content/builtin` 的依赖（5 个消费点）

| 内容类型 | builtin 层读取方（代码位置） | 用户层位置 | 启动是否已 seed |
|---|---|---|---|
| characters | `character/store.ts` 的 `characterDir()` 回退分支、`db/characterStore.ts`、`character/visual-store.ts`、`skin/migrate.ts` | `<dataDir>/characters` | ✅ 已有 COW 物化 |
| skills | `agent/skill-catalog.ts`（含 `manifest.json` 版本号读取） | `<dataDir>/skills/<cat>/<id>` | ✅ 已有 COW 物化 |
| iconpacks | `iconpacks/store.ts:89` 双层扫描；`:63 rootFor()` 按静态清单分流读写目录 | `<dataDir>/iconpacks` | ❌ 运行时直读出厂目录 |
| prompts | `routes/prompts.ts` 的 `BUILTIN_PROMPT_FILE` 回退读 | `<dataDir>/prompts/default.md` | ❌ 未 seed |
| providers | `provider-catalog/loader.ts` 的 `getCatalogRoot()` 默认出厂目录，**无用户层** | 无 | ❌ 未 seed |

**themes 不涉及**：内置主题定义在客户端代码（`themeDefinitions` 的 `BUILTIN_THEMES`），自定义主题已在 `<dataDir>/themes`，不经过 `content/builtin`。

### 1.2 已具备、可复用基础设施

- `content/copy-on-write.ts`：`materializeCharacter` / `materializeSkillPackage` + `readSourceTag` / `markSourceAsUser` 元数据标签体系（`character.json` / `skill-package.json` 自带 `source` 字段）。
- `content/materialize-builtin.ts`：`app.ts:171` 启动时调用 `materializeAllBuiltinContent()`，幂等（存在即跳过）、不覆盖用户修改、单条失败不中断。
- `content/builtin/manifest.json`：已为五类内容预留开关位（`"characters": true, "skills": true, "providers": true, "prompts": true, "iconpacks": true`，`contentVersion: "1.0.0"`）——**原始设计即规划了全量 seed**。
- desktop 已传 `TIANSHU_BUILTIN_CONTENT_DIR` → `resources/content/builtin`（`desktop/src/server-manager.ts:238`）。
- iconpack asset 走 `/api/iconpacks/:id/assets/:file` 动态读取（`routes/iconpacks.ts:168`），改存储根后前端无感。
- `iconpacks/schema.ts:24`：`BUILTIN_ICON_PACK_IDS = ['lucide', 'streamline-freehand']` 静态清单（当前用来区分内置/用户）。

**死代码（可顺手清理）**：
- `data-paths.ts:48` 的 `builtinMirrorRoot*` 三函数零引用（全仓 grep 仅定义处出现）。

**易误判点（非死代码）**：`data-paths.ts:73` 的 `contentStateFile()`（`<dataDir>/content-state.json`）已由 `content/state.ts` 实现读写（记录用户对内置内容的操作状态），但属于 lazy 创建——`devdata/content-state.json` 实际不存在是「尚未触发」而非「未实现」。阶段 1 的 seed 状态记录应**复用 `content/state.ts`**，而非新建逻辑。

**现有「恢复默认内容」兜底（可复用，但需随单层化改造）**：服务端 `routes/config.ts` 的 `POST /reimport-builtin` 已实现「把搞坏的内置角色/技能从出厂源重新复制、自建内容不动」，客户端 `SettingsPage.tsx:280` 已接入口（`已恢复 {n} 项内置内容`）。当前仅覆盖 characters/skills：
- `restoreBuiltinCharacter(id)`（`copy-on-write.ts:145`）现在是**删掉 dataDir 副本**，依赖运行时回退读 `content/builtin` 层「让内置重新可见」；
- 单层化后该回退分支（见阶段 2）将被删除，所以 restore 语义必须改为**「先删 dataDir 内置副本 + 再 `copyTree` 一份干净的出厂副本回 dataDir」**（覆盖式物化），否则删了就彻底读不到；
- 本方案把该能力扩展到 iconpacks/prompts/providers 三类，并改造既有 characters/skills 的 restore 语义（见阶段 6）。

### 1.3 `content/builtin` 与 `dataDir` 内容对照（截至 2026-08-22 devdata）

`content/builtin`（247MB / 519 文件）：
- `characters/`：coder, ram, taro, ui-designer, xiaohong, yi, ziwei（各含 `character.json` + `soul.md` + `user.md`）
- `skills/`：8 分类（design, diagram, finance, low-code-platform, mysticism, patent, tianshu, web），分类下再分包
- `iconpacks/`：lucide, streamline-freehand（各含 `pack.json` + `assets/*.svg`）
- `prompts/`：`default.md`
- `providers/`：17 个服务商预设（alibaba…xai）+ LICENSE/README
- 根部：`manifest.json`、`README.md`、`LICENSES.md`

`devdata`（当前 dataDir，467MB）：
- `characters/`：7 个内置角色副本**已全部物化**（如 `coder` 的 `source` 标签已是 `"user"`，证明 COW 链路与「编辑置 user」机制工作正常）
- `skills/`：8 分类完整副本（如 `tianshu/tianshu-system/` 含 `skill-package.json` + `SKILL.md`）
- `iconpacks/`：**仅 1 个用户自建包 `custom-material-symbols`**；内置 2 包无副本（运行时直读出厂目录）
- `prompts/`：**不存在**（读时回退出厂 `default.md`）
- `providers/`：**不存在**（catalog 直读出厂目录）
- `skin/`：7 个皮肤（从角色 visual 迁移，dataDir 原生）
- `themes/`：自定义主题（dataDir 原生）
- `mcpservers/`、`.cache/system-prompt/`：MCP 与系统提示词缓存（dataDir 原生）
- `providers.json`（根下）：用户服务商账号配置（旧版位置，待迁移 `config/providers.json`）
- `sessions.db`(+wal/shm)：会话数据库（dataDir 原生）
- ~~`config/`~~：尚不存在（偏好首次落盘时才会创建）；`content-state.json` 亦尚不存在（lazy，由 `content/state.ts` 首次操作时创建）

**差距结论**：characters/skills 的 seed 与单层化基础设施已跑通；真正缺的是 **iconpacks / prompts / providers 三类的 seed + 单层化**。

---

## 2. 目标架构

```
安装包 resources/content/builtin   ──首装/补种(复制一次)──▶  <dataDir>/*
        （仅 seed 源，运行期零依赖）                        characters/  skills/
                                                            iconpacks/
                                                            prompts/builtin-default.md
                                                            providers/
                                                            content-state.json (contentVersion)
```

四条原则：
1. **启动最早期**一次性全量 seed 到 `dataDir`（幂等 COW）。
2. 所有 store/catalog **读路径单层化**，只扫 `dataDir`。
3. `source` 判定从「文件物理位置」改为「元数据标签」（复用现成标签体系）。
4. `content/builtin` 缺失时服务照常启动，只是没有出厂底稿可补种。

---

## 3. 设计决策（D1–D6）

| # | 决策点 | 推荐值 | 理由 |
|---|---|---|---|
| D1 | 安装包是否仍带 `content/builtin` | **带**（作为纯 seed 源） | 首装总得出厂内容有个来源；运行链路对它零依赖即达成目标 |
| D2 | seed 布局 | **平铺进现有用户层目录** + `source` 标签区分 | 建 `<dataDir>/builtin/` 镜像等于把双层换个地方，换汤不换药 |
| D3 | 升级语义 | **存在即跳过**：新增项自动出现、用户已改项不受影响、出厂更新不强制覆盖已存在项 | 与现状 COW 语义一致，零意外 |
| D4 | iconpack 内置判定 | **迁到 `pack.json` 的 `source` 标签**，静态清单保留兼容回退 | 现在是代码硬编码，新增内置包要改代码 |
| D5 | prompts seed 形态 | `<dataDir>/prompts/builtin-default.md` 副本；PUT 空 = 删用户覆盖回退副本 | 「恢复默认」语义不变 |
| D6 | providers seed 目标 | `<dataDir>/providers/`（保持多子目录结构） | 与 `config/providers.json`（用户账号配置）天然分离 |

---

## 4. 分阶段改动

**阶段 1 — 统一 seed 入口**
- `content/materialize-builtin.ts`：新增 `materializeIconPacks` / `materializePrompts` / `materializeProviderCatalog`，复用 copy-on-write 的整树复制；seed 完成后通过已有 `content/state.ts` 记录状态（如 `contentVersion` + `seededAt`）。
- `app.ts:171` 现有调用保持不变（一次遍历覆盖全部类型）。

**阶段 2 — 五个消费点单层化**
- `character/store.ts`：`characterDir()` 删除 builtin 回退分支（seed 保证用户层始终有副本）；`save()` 的 COW 触发逻辑简化（不再判断 `builtinExists`）。
- `db/characterStore.ts`、`character/visual-store.ts`、`skin/migrate.ts`：扫描/合并改为单层扫描 + `source` 标签判定。
- `agent/skill-catalog.ts`：只扫 `<dataDir>/skills`；`builtinContentVersion()` 改从 `content-state.json` 读。
- `iconpacks/store.ts`：删除 `:89` 双层 `roots` 扫描、`:63 rootFor()` 统一为 `iconPacksRoot()`；只读判定走 `pack.json` 的 `source` 标签。
- `routes/prompts.ts`：回退源改为 `<dataDir>/prompts/builtin-default.md`。
- `provider-catalog/loader.ts`：`getCatalogRoot()` 默认值改为 `<dataDir>/providers`，`TIANSHU_PROVIDER_CATALOG_DIR` 覆盖保留。

**阶段 3 — paths.ts 清理**
- `content/paths.ts` 注释改为「仅 seed 源」；`data-paths.ts` 删除 `builtinMirrorRoot*` 死代码。

**阶段 4 — desktop/打包确认**
- `server-manager.ts` 不用改（`TIANSHU_BUILTIN_CONTENT_DIR` 继续作 seed 源）。
- 补防御：resources 缺失时不崩溃（仅跳过 seed）。

**阶段 5 — 测试改造与回归**
- 各 store 单测 fixture 化（临时 `dataDir` + seed 源）。
- 新增回归：删除 `content/builtin` 后服务正常启动。
- 校验 `content-state.json` 版本记录。

**阶段 6 — 恢复默认内容兜底（reimport 扩展）**
- **红线：只动内置/默认内容，绝不触碰用户自建内容。** 判定依据为「该 id/名称在 `content/builtin` 存在出厂同名项」（出厂源仍在，作恢复源）；路由只对匹配到出厂源的内置项调用 restore，用户自建项（dataDir 有、出厂源无同名）不进入恢复名单、不执行任何删除。现有 `/reimport-builtin` 已用 `kept` 数组保留这类项，本方案**延续该语义**，不改为全量遍历删除。
- 新增 `restoreBuiltinIconPack(id)` / `restoreBuiltinPrompt()` / `restoreBuiltinProvider(name)`：统一语义为「`rmSync` dataDir 内的**内置项（仅该 id）**目录 → `copyTree` 一份干净的 `content/builtin` 副本回 dataDir」（覆盖式物化，而非存在即跳过）。函数以「内置项 id」为唯一入参、定点操作，绝不接收或波及用户自建 id。
- 改造既有 `restoreBuiltinCharacter` / `restoreBuiltinSkill`：从「只删 dataDir 副本」改为「删 + 从出厂源重新覆盖复制」（呼应阶段 2 移除的回退分支，避免删后读不到）。
- `routes/config.ts` 的 `POST /reimport-builtin`：遍历范围扩展到五类内容；「是否有出厂对应」继续以 `content/builtin` 同名项为准（出厂源仍在）。
- 客户端 `SettingsPage.tsx` 已接入口与 i18n（`已恢复 {n} 项内置内容`），扩展 restored 统计字段覆盖新增类型。
- 这正是「dataDir 被搞坏时，把 builtin 再复制到 dataDir」的兜底：seed 负责首次初始化，reimport 负责事后修复，两者共用 `copy-on-write` 的 `copyTree`。

**验证补充（阶段 5）**
- `POST /reimport-builtin` 端到端：dataDir 内置项被篡改/删除后调用，恢复为出厂内容；用户自建内容（`source: user`）不受影响。
- 扩展类型（iconpacks/prompts/providers）各自 restore 后内容完整可用。

---

## 5. 风险与注意点

- 现有测试里 `source:'builtin'` 的断言基于「物理位置」，判定机制变化后需逐个核对（尤其 character/skills 的 smoke/API 断言）。
- providers catalog 的 mtime 缓存失效逻辑换根后需确认仍生效。
- `providers/` 含 `LICENSE` / `README.md` 等非目录文件，loader 已有 `issues` 容错，整树复制即可与出厂行为一致。
- 老用户升级后首次启动会补种 iconpacks/prompts/providers——磁盘新增目录，行为不变（存在即跳过）。
- `devdata/providers.json`（根下旧版）与新增 `<dataDir>/providers/`（出厂预设目录）是两个不同事物，不要混淆。

---

## 6. 验证标准

- 全部相关单测通过：`tsc --noEmit` + `vitest run`（server + client）。
- 端到端：清空 `dataDir` → 启动 → 五类内容均在 `dataDir` 出现 → 修改一项 → 重启进程 → 用户修改保留、其余出厂项仍在。
- 回归：删除 `content/builtin` → 服务正常启动且已有 `dataDir` 内容可读。
- 打包（`build:desktop`）产出的 `resources/content/builtin` 仍作为 seed 源被引用。

---

## 7. 待确认事项（开工前）

- D1 安装包仍带 `content/builtin`：是否认可？
- D2 平铺进用户层 + `source` 标签：是否认可？
- D6 providers seed 到 `<dataDir>/providers/`：是否认可（而非 `<dataDir>/builtin/providers/`）？

确认后即可按阶段 1→5 逐步实施，每阶段独立验证、可随时暂停。
