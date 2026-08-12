# Builtin Content 阶段交接报告

> 阶段：TianShu 第二阶段（BUILTIN_CONTENT_DEVELOPMENT_PLAN.md）
> 基线：Run Policy 阶段（RUN_LIMIT_POLICY_PLAN.md）已实施完成（提交 1bd5486 + c0587f7）
> 日期：2026-08-12

## 1. 实际修改文件

### 新增（服务端公共路径与内容层）
| 文件 | 说明 |
|---|---|
| `web/server/src/data-paths.ts` | 公共用户数据根：`dataRoot()` / `charactersRoot()` / `skillsRoot()` / `themesRoot()` / `contentStateFile()`；内部唯一调用 `getDataDir()` |
| `web/server/src/content/paths.ts` | 只读发行层路径：`builtinContentRoot()`（TIANSHU_BUILTIN_CONTENT_DIR → 仓库根 content/builtin）、`builtinCharactersRoot()` / `builtinSkillsRoot()` / `builtinProvidersRoot()` / `builtinPromptsRoot()`、`ContentSource` / `ContentOrigin` 类型 |
| `web/server/src/content/catalog.ts` | 双层合并：`mergeById()`（同 ID 用户完整覆盖内置、隐藏剔除、来源字段、排序稳定） |
| `web/server/src/content/state.ts` | `<dataDir>/content-state.json`：隐藏状态（characters/skills）、lastSeenBuiltinVersion；原子写 |
| `web/server/src/content/copy-on-write.ts` | `materializeCharacter()` / `materializeSkillPackage()`（白名单复制→临时目录→校验→原子 rename→`.tianshu-source.json`）、`restoreBuiltinCharacter()` |
| `content/builtin/` | 只读发行层：`manifest.json`(contentVersion 1.0.0) + README + LICENSES + `characters/`(7) + `skills/`(12) + `providers/`(17) |
| `scripts/get-userdata.cjs` | 开发模式 Electron userData 探针（dev 与打包版共享同一 config/data 根） |
| `scripts/verify-builtin-e2e.mjs` | 端到端验证脚本 |
| `web/server/test/data-paths.test.ts` | 路径专项测试（4 项） |
| `web/server/test/builtin-catalog.test.ts` | 双层合并专项测试（6 项） |
| `web/server/test/copy-on-write.test.ts` | 物化专项测试（5 项） |

### 修改（服务端）
| 文件 | 说明 |
|---|---|
| `web/server/src/config.ts` | 收敛 `C:\.Tianshu` fallback：无任何显式配置时抛错（绝不静默写入旧目录）；保留原子保存 runPolicy+dataDir 与 legacy 采用逻辑 |
| `web/server/src/db/characterStore.ts` | 双层扫描（builtin+userdata）、`listMergedCharacters` / `resolveCharacterRecord`、update 写入口自动 materialize、来源字段 |
| `web/server/src/character/store.ts` | 内容读取按获胜来源（`characterDir`）、save 前物化 |
| `web/server/src/character/visual-store.ts` | 视觉读取按层、写入口（save/addAsset/clearAssets）物化 |
| `web/server/src/character/revision-store.ts` | makeSnapshot 剥离派生来源字段（快照只含真实配置含 runPolicy） |
| `web/server/src/agent/skill-catalog.ts` | `scanSkillPackages()` + `listSkillPackages()` 双层合并、`ensureSkillPackageWritable()`、`restoreBuiltinSkill()`、跨 category 重复 ID 告警 |
| `web/server/src/routes/characters.ts` | 来源字段透出、`/content-state`、`POST /:id/hide|unhide|restore-builtin`、内置 DELETE→隐藏、写路径返回 merged 视图 |
| `web/server/src/routes/skills.ts` | 来源字段透出、`/content-state`、`POST /packages/:cat/:id/materialize|hide|unhide|restore-builtin` |
| `web/server/src/provider-catalog/loader.ts` | `getCatalogRoot()` 默认读 `content/builtin/providers`（保留 `TIANSHU_PROVIDER_CATALOG_DIR` 测试覆盖） |
| `web/server/package.json` | build 移除 `copy-provider-catalog.js`（catalog 资产随 content/builtin 发行） |
| `web/server/src/provider-catalog/*` | 17 个预设目录迁移至 `content/builtin/providers/`（保留 loader.ts/schema.ts） |

### 修改（前端与桌面）
| 文件 | 说明 |
|---|---|
| `web/client/src/types/index.ts` | Character 增加 `source/readOnly/overridesBuiltin/builtinVersion` |
| `web/client/src/api/skills.ts` | SkillPackageMeta 增加来源字段 |
| `web/client/src/pages/CharactersPage.tsx` | 角色卡片来源标签（内置/我的/已自定义） |
| `web/client/src/views/SkillView.tsx` | 技能卡片来源标签 |
| `desktop/src/server-manager.ts` | 打包模式注入 `TIANSHU_BUILTIN_CONTENT_DIR=<resources>/content/builtin`（非 Electron 环境回退） |
| `scripts/dev-desktop.mjs` | 经 Electron 探针解析 userData，向 dev server 注入 `TIANSHU_CONFIG_DIR` / `TIANSHU_DEFAULT_DATA_DIR` / `TIANSHU_BUILTIN_CONTENT_DIR` |
| `scripts/prepare-desktop-runtime.mjs` | staging 阶段复制 `content/builtin → staging/content/builtin`（随 extraResources 进安装包） |
| `scripts/smoke-packaged.mjs` | 打包 smoke 验证 builtin manifest + API 返回内置角色/技能 |

### 未触碰
- `.Tianshu` 用户数据目录（用户未提交改动原样保留）
- 已安装客户端目录 / app.asar / 稳定版用户数据

## 2. 实际目录与数据协议

```text
仓库根/
├── content/builtin/                    # 只读发行层（随版本发布）
│   ├── manifest.json                   # { schemaVersion:1, contentVersion:"1.0.0", characters:true, skills:true, providers:true, prompts:true }
│   ├── README.md / LICENSES.md
│   ├── characters/<id>/                # character.json + soul.md + user.md（无 memory/revision/visual 资产）
│   ├── skills/<category>/<id>/         # 完整 skill package（含 LICENSE 等）
│   ├── providers/<id>/                 # provider.json + icon.svg（无凭据）
│   └── prompts/default.md              # 默认系统提示词（只读兜底，用户 PUT 覆盖到 <dataDir>/prompts）
└── web/server/src/
    ├── data-paths.ts                   # 唯一公共用户路径模块
    └── content/{paths,catalog,state,copy-on-write}.ts

<dataDir>/                               # getDataDir() 唯一可写根
├── characters/<id>/                    # 用户角色 / 内置角色个人副本（含 .tianshu-source.json）
├── skills/<category>/<id>/             # 用户技能 / 内置技能个人副本
├── themes/                             # 主题阶段使用（本阶段仅提供 themesRoot()）
└── content-state.json                  # { schemaVersion:1, lastSeenBuiltinVersion, hidden:{characters,skills} }
```

**双层加载语义**：扫描 builtin → userdata，按稳定 ID 合并；同 ID 用户项**完整覆盖**内置项（禁止逐字段隐式合并）；`source: builtin|user`、`readOnly`、`overridesBuiltin`、`builtinVersion` 作为 API 派生字段返回（不写入 character.json）。

**Copy-on-write**：任何角色写入口（meta/content/visual/revision/archive）与技能写入口，服务端自行物化用户副本（临时目录+校验+原子 rename），不依赖客户端先调用复制接口；角色只复制定义文件（character.json/soul.md/user.md/prompt.md/visual/），不复制 memory/revision/归档。

**运行时只读**：builtin 层无任何写 API；编辑内置项自动生成 `<dataDir>` 副本；`DELETE` 内置项记录隐藏（content-state.json），不触碰安装目录。

## 3. 数据库与配置迁移

- **无数据库 schema 变更**（本阶段无新表；DB 迁移框架仍为 schema.ts 的 ALTER/CREATE IF NOT EXISTS）。
- **config.json 契约保持不变**：`dataDir` + `runPolicy` 同文件原子保存（`writeConfig` 合并现有字段），已由 run-policy-api 测试（PUT preserves dataDir and unknown config fields）与 e2e 验证。
- **旧字段**：内置角色原 `maxSteps:999` 由 Run Policy 阶段迁移函数在加载时转换为 `runPolicy.softTurns=systemAbs, graceTurns=0`；coder 角色移除用户环境特有的 `mcp:codegraph` 绑定并删除旧 `maxSteps` 字段（其余角色保留原字段，运行时迁移）。
- **内容迁移**：现有 7 角色 + 12 技能直接复制为内置内容（用户目录原样保留）；Provider 预设 17 个从 `web/server/src/provider-catalog/` 迁至 `content/builtin/providers/`（loader 兼容 `TIANSHU_PROVIDER_CATALOG_DIR` 覆盖）。
- **数据目录收敛**：`getDataDir()` 不再回退 `C:\.Tianshu`（无显式配置即抛错）；`C:\.Tianshu` 仅作为 legacy 采用来源（legacyHasData 时一次性采用并持久化）。

## 4. Run Policy 回归结果

服务端 vitest：**11 文件 / 80 测试全部通过**，其中 Run Policy 专项保持不变：
- `test/run-policy.test.ts` 18 项（normalize / maxSteps 迁移 / resolve / mergeStricter / progress）
- `test/run-policy-api.test.ts` 5 项（GET/PUT/reset、dataDir 保留、损坏回退）
- `test/run-store-policy.test.ts` 10 项（快照持久化、pinned revision、auto continuation、一致性）
- `test/recovery.test.ts` 3 项（恢复）

保留契约验证：config.json 同存 dataDir+runPolicy（e2e 确认）；内置角色 runPolicy 进入用户副本 → revision 快照 → 新 Run 策略快照（copy-on-write 测试）；已启动 Run 不受副本后续修改影响（pinned revision 测试）；未恢复 maxSteps=999 无限语义。

## 5. Builtin 专项测试结果

| 测试文件 | 数量 | 覆盖 |
|---|---|---|
| `test/data-paths.test.ts` | 4 | 同一 dataRoot 派生、TIANSHU_BUILTIN_CONTENT_DIR 覆盖、仓库 manifest 有效 |
| `test/builtin-catalog.test.ts` | 6 | 双层扫描、同 ID 完整覆盖、隐藏生效、runPolicy 仅角色层字段、effectivePreview 受系统边界约束 |
| `test/copy-on-write.test.ts` | 5 | 编辑内置角色物化完整副本（不复制运行状态）、runPolicy 进副本/revision/新 Run、已启动 Run 快照固定、失败不残留半成品、技能物化 |
| `scripts/verify-builtin-e2e.mjs` | 8 项检查 | 7 角色/12 技能/17 Provider、config 保存重载、编辑物化、.tianshu-source.json、builtin 源 hash 不变 |

## 6. 构建结果

| 目标 | 命令 | 结果 |
|---|---|---|
| Server | `npm run build --prefix web/server` | ✅ tsc + tool.json 复制 |
| Client | `npm run build --prefix web/client` | ✅ tsc + vite（1.27s） |
| Desktop | `npm run build --prefix desktop` | ✅ tsc |
| Server 测试 | `npm test --prefix web/server` | ✅ 80/80 |
| Client 测试 | `npm test --prefix web/client` | ✅ 29/29 |
| Desktop 测试 | `npm test --prefix desktop` | ✅ 16/16 |
| 打包 smoke | `prepare-desktop-runtime.mjs` 内嵌 smoke-packaged | 已扩展 builtin 校验（未在本机跑完整安装包构建，见风险） |

## 7. 未完成项与风险

1. **graphify update . 未执行**：当前环境无 graphify CLI（npm registry 的 `graphify@1.0.0` 为无关同名包、无 bin；本地无可执行文件）。`graphify-out/` 最新数据 built from commit `c1e6a0bf`（已过时）。需在具备 graphify CLI 的环境执行 `graphify update .`。
2. **完整 Electron 安装包构建未在本机执行**：`prepare-desktop-runtime.mjs` 需下载 portable Node（网络+时间成本）；其 smoke 已扩展 builtin 校验逻辑但未实际跑通安装包。建议 CI 或本地网络就绪后执行 `npm run dist:win` 验证 `resources/content/builtin` 与 `TIANSHU_BUILTIN_CONTENT_DIR` 注入。
3. **前端隐藏/恢复 UI**：服务端 hide/unhide/restore-builtin API 已就绪，但 UI 操作入口（右键菜单/按钮）未实现（阶段 4 推荐项）；当前前端只显示来源标签。
4. **内容合规**：内置角色 `ram`（Re:Zero 题材）为粉丝创作文本设定，`patent-disclosure-skill` 带 MIT LICENSE（Copyright handsomestWei，已保留）；其余技能无自带 LICENSE 文件，LICENSES.md 已记录来源，但 uzi/drawio-skill 等若源自第三方开源项目，建议后续核对并补充原始 LICENSE。
5. **技能编辑写路径**：当前提供 `materialize` API 供编辑前物化；技能内容本身的写（SKILL.md 编辑）仍走用户层目录（materialize 后），无独立技能写 API 的 UI 改动。
6. **跨 category 重复 package ID**：仅告警不拒绝（第一版决策，见计划 §10.3）。

## 8. 进入 Theme 阶段前必须满足的条件

1. `web/server/src/data-paths.ts` 已就绪（✅），`themesRoot()` 可直接复用；Theme 阶段**不得**新建同义模块。
2. `<TIANSHU_CONFIG_DIR>/config.json` 的 `dataDir` + `runPolicy` 原子保存契约已验证（✅）；Theme 阶段保存主题偏好不得整对象覆盖 config。
3. Run Policy 全套回归基线已记录：服务端 80/80（含 run-policy 36 项专项）+ 客户端 29/29 + 桌面端 16/16（✅ 本阶段结束时全部通过）。
4. Builtin 双层加载 + copy-on-write 测试基线已记录（15 项专项 + e2e 8 项检查，✅）。
5. SettingsPage“运行与安全”区域保留（✅ 未改动）；Theme UI 必须作为独立组件挂载。
6. chatStore ActiveRunState / 自动续跑事件归并 / 整链停止 / 重连恢复保留（✅ 未改动）。
7. RightPanel 运行策略摘要保留（✅ 未改动）。
8. **待办**：执行 `graphify update .`（环境就绪后）；完成 `npm run dist:win` 安装包验证；建议补跑完整打包 smoke。
