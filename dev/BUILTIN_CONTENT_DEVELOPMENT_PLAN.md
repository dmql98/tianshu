# TianShu 内置角色与技能双层内容系统开发计划

## 1. 目标

TianShu 随应用提供一批开箱即用的角色和技能，同时允许用户在个人数据目录中新增、修改、覆盖或隐藏这些内容。

内容分为两层：

1. **内置内容层**：位于项目根目录，随应用版本发布，只读。
2. **用户内容层**：位于 `getDataDir()` 返回的数据目录，可写，用于个人配置、补充内容和内置内容的个人副本。

不要在新代码中写死 `C:\.Tianshu`。开发模式和 Electron 打包版必须使用同一套数据目录解析规则，并默认指向同一个 Electron `userData/data`。用户还可以自行选择数据目录。`C:\.Tianshu` 只能作为旧版本数据的迁移来源，不能作为开发模式、独立 server 或任何新安装的默认写入目录。本文用 `<user-data>` 表示 `getDataDir()`。

## 2. 推荐目录结构

仓库根目录新增统一发行内容根：

```text
content/
└── builtin/
    ├── manifest.json
    ├── README.md
    ├── LICENSES.md
    ├── characters/
    │   ├── general-assistant/
    │   │   ├── character.json
    │   │   ├── soul.md
    │   │   ├── user.md
    │   │   ├── prompt.md          # 可选
    │   │   └── visual/            # 可选
    │   └── coding-assistant/
    │       └── ...
    ├── skills/
    │   ├── productivity/
    │   │   └── builtin-writing/
    │   │       ├── skill-package.json
    │   │       ├── SKILL.md
    │   │       ├── children/
    │   │       ├── references/
    │   │       ├── scripts/
    │   │       ├── templates/
    │   │       └── assets/
    │   └── development/
    │       └── ...
    └── providers/
        ├── openai/
        │   ├── provider.json
        │   └── icon.svg
        └── ...
```

将 Provider 也纳入这个统一根目录，避免角色、技能、Provider 各自形成一套“内置资源路径”。如果 Provider catalog 已先按其他路径实现，可以作为过渡，最终迁移至 `content/builtin/providers/`。

用户层继续沿用现有协议：

```text
<user-data>/
├── characters/
│   ├── my-character/
│   └── general-assistant/        # 内置角色的个人副本
├── skills/
│   ├── personal/my-skill/
│   └── productivity/builtin-writing/  # 内置技能的个人副本
├── content-state.json
├── providers.json
├── sessions.db
└── ...
```

内置内容不是首次启动时复制到 `.Tianshu` 的种子数据。它应保持为随版本更新的只读层；用户目录只保存个人内容、覆盖项和状态。

## 3. 当前代码现状

### 3.1 数据目录

`web/server/src/config.ts` 中 `getDataDir()` 当前仍保留 `C:\.Tianshu` fallback，需要在本次改造中收敛。目标解析顺序应为：

1. `TIANSHU_DATA_DIR` / `DATA_DIR`。
2. 持久化的用户选择。
3. 开发壳或 Electron 打包版共同提供的 `TIANSHU_DEFAULT_DATA_DIR=<Electron userData>/data`。
4. 如果旧 `C:\.Tianshu` 中存在真实数据，仅执行显式或一次性的迁移/采用提示；不得把它当作静默默认目录。

新功能必须复用 `getDataDir()`，不能增加另一套个人数据目录判断。开发模式启动 TianShu 时也应先由 Electron 获得 `app.getPath('userData')`，再把相同的默认数据路径传给 server，而不是让 dev server 自行选择 fallback。

### 3.1.1 开发版与打包版对齐要求

开发模式不是一套独立存储环境。目标行为：

```text
开发模式 Electron shell
  -> app.getPath('userData')
  -> TIANSHU_CONFIG_DIR=<userData>
  -> TIANSHU_DEFAULT_DATA_DIR=<userData>/data
  -> 启动 dev server

打包版 Electron shell
  -> app.getPath('userData')
  -> TIANSHU_CONFIG_DIR=<userData>
  -> TIANSHU_DEFAULT_DATA_DIR=<userData>/data
  -> 启动 bundled server
```

两者必须共享：

- 同一个 `config.json` 位置。
- 同一个默认 `data` 目录。
- 同一个用户自选数据目录结果。
- 同一套旧数据迁移状态。

如果开发者需要隔离测试数据，应显式设置 `TIANSHU_DATA_DIR` 或使用测试专用 Electron userData，而不是依赖 `C:\.Tianshu`。自动化测试必须使用临时目录。

### 3.2 角色

当前角色只读取：

```text
<user-data>/characters/<id>/
```

主要相关模块：

- `web/server/src/db/characterStore.ts`
- `web/server/src/character/store.ts`
- `web/server/src/character/visual-store.ts`
- `web/server/src/character/revision-store.ts`
- `web/server/src/routes/characters.ts`

角色不仅有定义文件，还会产生 memory、visual、revision、归档等可变状态，所以内置角色不能简单加入第二个只读扫描根后就结束；所有写路径都必须处理用户副本物化。

### 3.3 技能

当前 `web/server/src/agent/skill-catalog.ts` 的 `skillsRoot()` 只返回：

```text
<user-data>/skills
```

技能已有成熟的 package 格式、安全相对路径检查和子技能结构。内置技能应复用现有格式，不另造一种 schema。

主要相关模块：

- `web/server/src/agent/skill-catalog.ts`
- `web/server/src/agent/skill-loader.ts`
- `web/server/src/agent/skill-package-writer.ts`
- `web/server/src/routes/skills.ts`
- `web/server/src/evolution/generators/skillGenerator.ts`

## 4. 双层加载语义

分别扫描：

```text
1. content/builtin/<type>
2. <user-data>/<type>
```

按稳定 ID 合并：

- 只有内置项：`source: "builtin"`、`readOnly: true`。
- 只有用户项：`source: "user"`、`readOnly: false`。
- 两层同 ID：用户项完整覆盖内置项，`source: "user"`、`overridesBuiltin: true`。
- ID 被用户隐藏：普通列表不返回；管理接口可通过 `all=true` 查看。

不要做逐字段隐式合并。同 ID 的用户目录应作为完整覆盖项，避免内置版本升级后产生无法预测的混合配置。

用户覆盖目录损坏时，不应悄悄退回内置项，否则用户会误以为自己的修改仍然生效。应报告“用户副本损坏”，并提供恢复内置版本的操作。

## 5. Copy-on-write

内置目录永远不能直接修改。

用户首次编辑内置角色或技能时：

1. 将该内置项完整复制到用户层相同 ID 的目录。
2. 先复制到用户根下的临时目录。
3. 校验复制结果。
4. 原子 rename 为正式目录。
5. 后续读写命中用户副本。

可在用户副本内保存 `.tianshu-source.json`：

```json
{
  "schemaVersion": 1,
  "kind": "builtin-fork",
  "builtinId": "general-assistant",
  "builtinVersion": "1.0.0",
  "forkedAt": 1786500000000
}
```

角色第一次发生任何持久写入前都必须物化，包括：

- 编辑角色元数据或 soul/user/prompt。
- 写入 memory。
- 保存 visual 和资源。
- 创建 revision。
- 归档或修改隐藏状态。
- evolution 产生角色级变更。

不能依赖客户端先调用一个“复制”接口。每个服务端写入口自身必须确保 materialize，避免工具、API 或后台任务绕过只读保护。

## 6. 删除、隐藏与恢复

用户自建项可以继续使用现有删除/归档语义。

内置项不能从安装目录删除。用户选择删除内置项时，应记录为隐藏：

```json
{
  "schemaVersion": 1,
  "lastSeenBuiltinVersion": "1.0.0",
  "hidden": {
    "characters": ["general-assistant"],
    "skills": ["builtin-writing"]
  }
}
```

对于已有用户副本的内置项，UI 区分：

- **删除我的副本**：归档/移除用户副本，重新显示当前内置版本。
- **恢复内置版本**：归档个人副本并移除隐藏状态。
- **隐藏**：写入隐藏状态，不再在普通列表显示。

恢复内置版本会影响用户修改，应二次确认，并优先归档个人副本而非永久删除。

## 7. 根 manifest

新增 `content/builtin/manifest.json`：

```json
{
  "schemaVersion": 1,
  "contentVersion": "1.0.0",
  "characters": true,
  "skills": true,
  "providers": true
}
```

根 manifest 只描述内容协议和发行版本，不维护具体内容 ID 列表。具体项目必须继续通过目录自动扫描，否则新增内容仍需修改中心清单。

## 8. 统一路径模块

建议新增：

```text
web/server/src/content/paths.ts
web/server/src/content/catalog.ts
web/server/src/content/state.ts
web/server/src/content/copy-on-write.ts
```

建议接口：

```ts
export function builtinContentRoot(): string
export function userContentRoot(): string
export function builtinCharactersRoot(): string
export function userCharactersRoot(): string
export function builtinSkillsRoot(): string
export function userSkillsRoot(): string

export type ContentSource = 'builtin' | 'user'

export interface ContentOrigin {
  source: ContentSource
  readOnly: boolean
  overridesBuiltin: boolean
  root: string
}
```

内置内容路径可以因源码运行和安装包资源位置不同而不同，但用户数据路径不能因此分叉。内置路径解析顺序：

1. `TIANSHU_BUILTIN_CONTENT_DIR`，供测试、容器和高级用户显式覆盖。
2. 开发模式读取仓库根目录 `content/builtin`。
3. 打包模式使用 Electron resources 中的 `content/builtin`。

生产环境不要依赖当前工作目录推测路径。Electron 启动 server 时应显式设置：

```text
TIANSHU_BUILTIN_CONTENT_DIR=<process.resourcesPath>/content/builtin
```

开发 Electron shell 则显式传入仓库的 `content/builtin`，同时传入与打包版一致的 `TIANSHU_CONFIG_DIR` 和 `TIANSHU_DEFAULT_DATA_DIR`。差异只允许存在于只读内置内容的位置，不能存在于用户数据的默认位置和解析语义。

所有 store/catalog 通过统一模块取路径，避免继续散落 `resolve(getDataDir(), ...)`。

## 9. 角色改造

### 9.1 格式

继续使用现有格式：

```text
characters/<id>/
├── character.json
├── soul.md
├── user.md
├── prompt.md       # 可选
├── memory.md       # 内置模板通常不要携带真实记忆
└── visual/         # 可选
```

API 响应增加派生字段，不要求写入 `character.json`：

```ts
interface CharacterOriginFields {
  source: 'builtin' | 'user'
  readOnly: boolean
  overridesBuiltin?: boolean
  builtinVersion?: string
}
```

### 9.2 Store 设计

将现有单根读取拆分为：

```ts
scanCharacters(root, source)
mergeCharacters(builtin, user, contentState)
resolveCharacter(id)
materializeCharacter(id)
```

所有内容文件的读取必须根据最终获胜来源解析，不能继续无条件拼接 `<user-data>/characters/<id>`。

角色工具绑定、技能绑定和会话只保存稳定 ID，不保存内置目录绝对路径。

### 9.3 内置角色绑定技能

内置角色可以通过 `skillBindings` 引用内置或用户技能。解析始终经过合并后的 skill catalog。

构建校验必须确认每个内置角色引用的 skill package 都存在。如果用户覆盖了同 ID 技能，角色自动使用用户版本。

## 10. 技能改造

### 10.1 格式

复用现有 skill package：

```text
skills/<category>/<package-id>/
├── skill-package.json
├── SKILL.md
├── children/
├── references/
├── scripts/
├── templates/
├── tests/
└── assets/
```

### 10.2 Catalog

将 `skill-catalog.ts` 拆为：

```ts
scanSkillPackages(root, source)
mergeSkillPackages(builtin, user, contentState)
listSkillPackages()
```

`SkillPackageRecord` 增加：

```ts
source: 'builtin' | 'user'
readOnly: boolean
overridesBuiltin: boolean
```

`pkg.dir` 始终指向最终获胜来源的真实目录。`resolvePackageFile()` 继续以单个 `pkg.dir` 为安全边界，不能跨内置根和用户根组合路径。

### 10.3 写入

- `skill-package-writer.ts` 创建的新技能只写 `<user-data>/skills`。
- 编辑内置技能前 copy-on-write。
- evolution/生成器产生的技能只写用户层。
- 内置技能脚本的输出不能写回安装目录，应写工具输出目录或临时目录。

当前技能查找主要按 package ID，但目录还包含 category。第一版应禁止不同 category 出现相同 package ID，或者将所有引用升级为 `category/package-id`。建议先检测并拒绝跨 category 重复 ID，避免扩大迁移范围。

## 11. API 与 UI

角色和技能列表/详情响应增加：

```json
{
  "source": "builtin",
  "readOnly": true,
  "overridesBuiltin": false
}
```

编辑触发用户副本后返回：

```json
{
  "source": "user",
  "readOnly": false,
  "overridesBuiltin": true
}
```

UI 标签建议：

- `内置`
- `我的`
- `已自定义`

内置项操作：

- 使用
- 创建个人副本/编辑
- 隐藏

已自定义项操作：

- 编辑
- 恢复内置版本
- 隐藏

普通用户不需要理解磁盘 overlay；UI 文案以“内置、我的副本、恢复默认”为主。

## 12. 版本升级规则

- 新增内置项：升级后自动出现。
- 未被用户覆盖的内置项：自动使用新版。
- 已有个人副本：继续优先，不被安装包覆盖。
- 已隐藏项：升级后继续隐藏。
- 内置项从发行版移除：用户副本继续作为普通用户内容存在。
- 内置 ID 重命名：必须提供显式 migration 映射，不能直接换目录名。

第一版不做用户副本与新版内置内容的自动三方合并。可以在 UI 提示“内置版本已更新”，由用户选择保留个人副本或恢复新版。

## 13. 构建与 Electron 打包

构建/打包时复制：

```text
content/builtin/**
```

到：

```text
<process.resourcesPath>/content/builtin/**
```

需要修改/检查：

- `scripts/prepare-desktop-runtime.mjs`
- Electron Builder resources/files 配置
- `desktop/src/server-manager.ts`
- `desktop/src/main.ts`
- `scripts/dev-desktop.mjs`
- `scripts/smoke-packaged.mjs`

当前 `scripts/dev-desktop.mjs` 先于 Electron 独立启动 server，因此 dev server 无法天然取得 Electron `userData`。实施时应调整开发启动编排，二选一：

1. 推荐：由开发 Electron 主进程像打包版一样启动/管理 server，只把客户端 URL 指向 Vite。
2. 过渡：dev orchestrator 从 Electron 获得或按 Electron 的实际规则解析 userData 后，再显式传给 server。

不能继续让 dev server 在缺少环境变量时落到 `C:\.Tianshu`。

smoke test 至少验证：

- 根 manifest 存在且版本支持。
- 能扫描到至少一个内置角色和技能。
- API 在打包路径下能返回内置内容。
- 内置目录设为只读时读取和聊天正常。
- 写操作只落临时用户数据目录。
- 写操作前后内置文件 hash 不变。

## 14. 安全要求

- 所有 manifest 做 schema 校验。
- 所有相对路径阻止绝对路径和 `..` 逃逸。
- 解析后的真实路径必须位于对应 source root 内。
- Windows 下防止 symlink/junction 逃出根目录。
- copy-on-write 使用临时目录与原子 rename。
- “内置技能”不能绕过现有工具权限和审批。
- 内置内容不能包含用户密钥、个人信息、真实记忆或本机绝对路径。
- 第三方角色、技能、图片、脚本和模板必须记录许可证与来源。

## 15. 测试计划

### 15.1 路径

- 开发模式定位仓库 `content/builtin`，但用户数据与 Electron 打包版使用同一目录。
- `TIANSHU_BUILTIN_CONTENT_DIR` 覆盖生效。
- 自定义 `TIANSHU_DATA_DIR` 仍作为用户层。
- Electron 默认 `userData/data` 正常。
- dev Electron 与 packaged Electron 得到相同的 `TIANSHU_CONFIG_DIR` 和默认 dataDir。
- dev server 未显式指定数据目录时也绝不写入 `C:\.Tianshu`。
- 旧 `C:\.Tianshu` 只作为迁移来源；迁移或采用行为可见、可测试且不会反复执行。
- 自动化测试只写临时目录。

### 15.2 合并

- 只有内置项时返回 builtin。
- 只有用户项时返回 user。
- 同 ID 时用户完整覆盖内置。
- 隐藏状态生效。
- 用户副本损坏时报告错误而非静默 fallback。
- 重复 ID 被检测。
- 排序稳定。

### 15.3 Copy-on-write

- 第一次编辑内置角色创建完整用户副本。
- memory、visual、revision 首次写入会物化角色。
- 第一次编辑内置技能创建完整用户副本。
- 复制失败不留下可被扫描为有效内容的半成品。
- 并发首次写不会损坏副本。
- 所有写操作后内置源文件不变。

### 15.4 升级

- 更新未覆盖内置项后使用新版。
- 用户副本升级后保持不变。
- 新内置项自动出现。
- 隐藏项继续隐藏。
- 归档个人副本后恢复新版内置项。

### 15.5 回归

- 现有角色创建、编辑、归档、导入导出正常。
- 现有技能创建、详情、子技能、附件读取正常。
- 角色可绑定内置和用户技能。
- API 返回来源字段。
- UI 正确显示内置/我的/已自定义。

## 16. 推荐实施顺序

### 阶段 1：统一路径和发行资源

- 建立 `content/builtin` 与根 manifest。
- 实现统一路径模块和内容状态 store。
- 接入开发及打包路径。
- 增加构建资源校验。

### 阶段 2：技能双层加载

- 将 skill catalog 拆为 scan + merge。
- 增加来源字段与冲突检测。
- 保证新技能只写用户层。
- 完成技能 catalog 测试。

技能可变状态较少，建议先实现，用于验证双层模型。

### 阶段 3：角色双层加载

- 将角色 meta/content 改为双层解析。
- 实现角色 materialize。
- 覆盖 memory、visual、revision、archive 等所有写入口。
- 完成并发和失败恢复测试。

### 阶段 4：隐藏、恢复和 UI

- 实现 `content-state.json`。
- 增加隐藏/恢复 API。
- 增加来源标签与操作菜单。
- 使用归档保护个人副本。

### 阶段 5：首批内容与发布验证

- 加入少量高质量角色和技能。
- 校验角色的技能引用。
- 补充许可证和来源。
- 验证 production build 与 Electron 安装包。
- 执行 `graphify update .`。

## 17. 首批内容建议

角色：

- 通用助理
- 编程助理
- 写作助理
- 研究/资料整理助理

技能：

- 写作与改写
- 资料总结
- 任务拆解
- 基础代码审查流程
- Git 基础工作流

第一版数量不宜过多。内置角色不应默认绑定高风险技能或不必要的工具权限。

## 18. 验收标准

1. 仓库根目录存在统一的 `content/builtin`。
2. 应用同时发现内置角色、内置技能和用户补充内容。
3. 用户根由 `getDataDir()` 决定，开发版与打包版默认对齐到同一个 Electron `userData/data`。
4. 用户同 ID 内容稳定覆盖内置内容。
5. 内置目录在运行时保持只读。
6. 首次编辑或持久写入内置项时自动创建用户副本。
7. 应用升级不覆盖个人内容。
8. 新增内置角色或技能只需新增符合协议的目录。
9. 隐藏、恢复默认和删除个人副本语义明确。
10. 角色和技能引用不依赖绝对路径。
11. Electron 安装包包含内置内容，所有可变状态只写用户目录。
12. 现有角色、技能、导入导出和旧数据迁移测试通过，任何模式均不再以 `C:\.Tianshu` 为默认写入目录。
13. 全量 build/test 通过并执行 `graphify update .`。

## 19. 非目标

第一版不做：

- 用户副本与新版内置内容的自动三方合并。
- 在线内容市场或远程自动下载。
- 在安装目录保存用户记忆或配置。
- 让内置技能绕过工具权限和审批。
- 一次性加入大量低质量预设内容。

核心原则：**内置层负责可靠默认值，用户层负责所有个性化与可变状态；读取时合并，写入时只写用户层。**
