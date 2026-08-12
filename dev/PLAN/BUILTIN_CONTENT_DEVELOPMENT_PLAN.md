# TianShu 内置内容与用户数据分层开发计划

## 1. 目标

TianShu 随应用提供一批开箱即用的角色、技能和 Provider 预设，同时允许用户在个人数据目录中新增、修改、覆盖或隐藏可编辑内容。

内容分为两层：

1. **内置内容层（builtin）**：位于仓库 `content/builtin`，打包后位于 Electron resources，随应用版本发布，运行时只读，只能包含可公开分发、可复现的默认内容。
2. **用户数据层（userdata）**：位于 `getDataDir()` 返回的数据根目录，可写，包含用户创建或修改的内容、内置内容的个人副本、状态、密钥、数据库和运行产物。

不要在新代码中写死 `C:\.Tianshu`。开发模式和 Electron 打包版必须使用同一套数据目录解析规则，并默认指向同一个 Electron `userData/data`。用户还可以自行选择数据目录。`C:\.Tianshu` 只能作为旧版本数据的迁移来源，不能作为开发模式、独立 server 或任何新安装的默认写入目录。本文统一用 `<dataDir>` 表示 `getDataDir()` 的返回值；该术语与 `TIANSHU_THEME_SWITCHING_PLAN.md` 完全一致。

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
    │   │   ├── user.md            # 可选；只能是无个人信息的默认模板
    │   │   ├── prompt.md          # 可选
    │   │   └── visual/            # 可选；只含静态默认素材和 visual.json
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
<dataDir>/
├── characters/
│   ├── my-character/
│   └── general-assistant/        # 内置角色的个人副本
├── skills/
│   ├── personal/my-skill/
│   └── productivity/builtin-writing/  # 内置技能的个人副本
├── themes/                        # 用户自定义主题；由主题模块管理
├── content-state.json
├── providers.json
├── sessions.db
└── ...
```

内置内容不是首次启动时复制到 `.Tianshu` 的种子数据。它应保持为随版本更新的只读层；用户目录只保存个人内容、覆盖项和状态。

### 2.1 文件归属总表

以下规则是实现时的白名单。不能仅凭文件扩展名决定归属；必须同时考虑文件用途。

| 内容 | builtin：`content/builtin` | userdata：`<dataDir>` | 规则 |
|---|---|---|---|
| 根协议 | `manifest.json`、`README.md`、`LICENSES.md` | 无对应副本 | 随版本发布，只读 |
| 角色定义 | `character.json`、`soul.md`、可选 `prompt.md`、无个人信息的可选 `user.md` | 用户自建角色或内置角色完整个人副本 | 同 ID 用户目录完整覆盖内置目录 |
| 角色运行偏好 | `character.json.runPolicy` 可提供角色默认偏好 | 用户角色或个人副本中的 `runPolicy` | 只含角色层偏好；最终值受系统策略限制并进入 revision |
| 角色视觉 | 默认 `visual/visual.json`、头像、立绘等静态素材 | 用户上传或编辑后的视觉配置和素材 | 内置素材必须有许可证；编辑前物化 |
| 角色运行状态 | 禁止 | `memory.md`、revisions、presence/演化状态、归档和其他可变状态 | 运行状态永远不能进入发行层 |
| 技能定义 | `skill-package.json`、`SKILL.md`、`children/`、`references/` | 用户自建技能或内置技能完整个人副本 | 复用相同 package schema |
| 技能资源 | 运行必需的 `scripts/`、`templates/`、`assets/`；可选验证用 `tests/` | 用户脚本、模板、素材及个人修改 | 脚本本身可内置，执行输出不能写回内置目录 |
| Provider 预设 | `provider.json`、公开图标和公开说明 | `providers.json` 中的用户 Provider、选择状态和凭据引用 | builtin 绝不能包含 API key、token 或账号数据 |
| 主题 | 不归本机制管理；两个内置主题由前端代码/静态资源提供 | `themes/<id>/` 保存自定义主题 | 以主题计划为准，不参与 copy-on-write |
| 会话和数据库 | 禁止 | `sessions.db` 及相关数据库 | 只属于用户数据 |
| 密钥和个人配置 | 禁止 | Provider 凭据、用户偏好和授权状态 | 不得进入仓库或安装资源 |
| 运行产物 | 禁止 | `media/`、`tool-output/`、`debug/`、`.cache/`、日志、临时文件 | 不能被 builtin catalog 扫描 |
| 层状态 | 禁止 | `content-state.json`、`.tianshu-source.json` | 记录隐藏和个人副本来源 |

判断原则：

- 能由应用版本确定、对所有用户相同、允许公开分发的默认定义和静态素材，才可以进入 builtin。
- 与某个用户、设备、账号、会话或运行过程有关的任何数据，必须进入 userdata。
- 会在运行时变化的文件，即使有“默认值”，也不能把活动文件放入 builtin；需要默认内容时由代码初始化，或在 materialize 时创建 userdata 文件。
- builtin 不等于备份目录，也不等于首次启动种子目录。启动时禁止把整个 `content/builtin` 批量复制到 `<dataDir>`。
- userdata 不允许反向写回 builtin。升级、编辑、工具调用和后台任务都必须遵守这一方向。

### 2.2 Builtin 根目录白名单

`content/builtin` 第一版只允许以下顶层项：

```text
content/builtin/
├── manifest.json
├── README.md
├── LICENSES.md
├── characters/
├── skills/
└── providers/
```

未知顶层目录在开发/构建校验中报错，运行时忽略并记录诊断。以下内容明确禁止出现在 builtin：

- `themes/`、`sessions.db`、`providers.json`、`content-state.json`。
- `memory.md`、revision 历史、归档、用户上传文件。
- API key、token、cookie、账号标识、机器路径或个人信息。
- debug、cache、log、tool output、媒体生成结果和临时文件。
- 下载后才能运行的远程资源；发行内容必须随安装包完整提供。

### 2.3 Userdata 根目录归属

`<dataDir>` 是全部可写业务数据的共同根，不只是 builtin 的覆盖层：

```text
<dataDir>/
├── characters/          # 用户角色和内置角色个人副本
├── skills/              # 用户技能和内置技能个人副本
├── themes/              # 用户自定义主题
├── media/               # 会话/角色等运行媒体
├── tool-output/         # 工具输出
├── debug/               # 调试记录
├── .cache/              # 可重建缓存
├── content-state.json   # builtin 隐藏状态
├── providers.json       # 用户 Provider 配置；敏感值按既有安全方案处理
├── sessions.db
└── ...                  # 其他服务端明确登记的用户状态
```

目录属性分为：

- **用户事实数据**：`characters`、`skills`、`themes`、`providers.json`、`sessions.db`。备份和迁移必须保留。
- **用户层控制数据**：`content-state.json`、个人副本中的 `.tianshu-source.json`。备份和迁移必须保留。
- **可重建或可清理数据**：`.cache`、debug、tool output、logs 和临时目录。清理策略必须独立，不能与事实数据混删。

### 2.4 与主题计划共享的数据目录契约

本计划与 `TIANSHU_THEME_SWITCHING_PLAN.md` 共用以下唯一约定：

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
└── content/builtin/               # 随应用发布、运行时只读
```

必须区分：

- `TIANSHU_CONFIG_DIR`：Electron 壳层配置目录，`config.json` 位于这里，保存 `dataDir` 选择和 Run Policy 等系统级配置；不能在其下直接创建 `characters`、`skills` 或 `themes`。
- `TIANSHU_DEFAULT_DATA_DIR`：未自选数据目录时的默认值，通常为 `<Electron userData>/data`。
- `TIANSHU_DATA_DIR` / `DATA_DIR`：测试、容器或高级用户的显式数据根覆盖。
- `getDataDir()`：服务端解析后的唯一用户数据根。所有可写业务资源必须从这里派生。
- `TIANSHU_BUILTIN_CONTENT_DIR`：只读发行内容根，与可写 `dataDir` 无关。

目录所有权：

- 本计划负责 `content/builtin/characters`、`content/builtin/skills`、`<dataDir>/characters`、`<dataDir>/skills` 和 `content-state.json`。
- 主题计划负责两个代码内置主题及 `<dataDir>/themes`。自定义主题不参与角色/技能的双层覆盖或 copy-on-write。
- Provider catalog 的只读发行层可以位于 `content/builtin/providers`，但用户 Provider 的具体存储协议仍以 Provider 专项计划为准。

任何计划都不得再次定义另一套 dataDir 解析顺序或新增平行用户数据根；若路径契约调整，必须同步更新这两份计划。

公共路径基础只实现一次：无论先开发内置内容还是主题功能，最先进入实现的计划负责建立 `web/server/src/data-paths.ts` 及其测试；后进入的计划只能复用和补充测试，不能创建同义模块。`getDataDir()` 的解析、迁移和缓存行为仍归 `web/server/src/config.ts` 负责，`data-paths.ts` 只提供经过命名的子路径，不重复读取环境变量或 `config.json`。

### 2.5 与 Run Policy 阶段的交接约束

本计划在 `RUN_LIMIT_POLICY_PLAN.md` 完成后实施，必须把已经落地的运行策略能力视为现有契约，不能按本文件撰写时的旧 `maxSteps` 结构重做。

交接时以当前代码和 Run Policy 阶段测试为事实来源；本文件“当前代码现状”中与已完成 Run Policy 实现不一致的旧描述只作历史背景，不得据此回滚新 schema、API、数据库字段或前端状态模型。

必须保留：

- `<TIANSHU_CONFIG_DIR>/config.json` 中的 `runPolicy` 系统安全策略；数据目录读写和迁移不得丢弃、覆盖或重置它。
- `CharacterRecord.runPolicy`、旧 `maxSteps` 兼容读取及其规范化规则。
- character revision 中的角色运行策略和 manifest hash 行为。
- Run 创建时使用 pinned character revision 解析策略的语义。
- 系统“运行与安全”设置、角色运行策略 UI、RightPanel 有效策略摘要。
- 动态收敛、自动续跑和前端 ActiveRunState 的既有实现及测试。

Builtin 角色的 `character.json` 可以声明 `runPolicy` 作为角色默认执行偏好，但只能声明角色层字段，不能包含 `SystemRunPolicy` 或突破系统安全边界。编辑内置角色的运行偏好必须先 materialize 到 `<dataDir>/characters/<id>/`，再修改用户副本。

Builtin 实施不得重新引入“`maxSteps=999` 表示无限”的旧语义。若首批内置角色仍需兼容旧字段，构建校验和运行时加载必须复用 Run Policy 阶段已实现的迁移函数。

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
<dataDir>/characters/<id>/
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
<dataDir>/skills
```

技能已有成熟的 package 格式、安全相对路径检查和子技能结构。内置技能应复用现有格式，不另造一种 schema。

主要相关模块：

- `web/server/src/agent/skill-catalog.ts`
- `web/server/src/agent/skill-loader.ts`
- `web/server/src/agent/skill-package-writer.ts`
- `web/server/src/routes/skills.ts`
- `web/server/src/evolution/generators/skillGenerator.ts`

## 4. 双层加载语义

本章的双层合并和 copy-on-write 只适用于 `characters` 与 `skills`。Provider 使用 Provider catalog 的“只读预设 + 用户配置”协议；主题使用主题计划的“代码内置主题 + 用户自定义主题”协议，不能套用本章规则。

角色和技能分别扫描：

```text
1. content/builtin/<type>
2. <dataDir>/<type>
```

按稳定 ID 合并：

- 只有内置项：`source: "builtin"`、`readOnly: true`。
- 只有用户项：`source: "user"`、`readOnly: false`。
- 两层同 ID：用户项完整覆盖内置项，`source: "user"`、`overridesBuiltin: true`。
- ID 被用户隐藏：普通列表不返回；管理接口可通过 `all=true` 查看。

不要做逐字段隐式合并。同 ID 的用户目录应作为完整覆盖项，避免内置版本升级后产生无法预测的混合配置。

用户覆盖目录损坏时，不应悄悄退回内置项，否则用户会误以为自己的修改仍然生效。应报告“用户副本损坏”，并提供恢复内置版本的操作。

### 4.1 读取、写入和升级决策表

| 场景 | 读取来源 | 写入目标 | 结果 |
|---|---|---|---|
| 只有 builtin 项 | builtin | 无 | 只读使用，升级时自动随新版更新 |
| 只有 userdata 项 | userdata | userdata | 普通用户内容 |
| builtin 与 userdata 同 ID | userdata | userdata | userdata 完整覆盖，禁止逐字段混合 |
| 首次编辑 builtin | 先读 builtin | 临时目录后原子写入 userdata 同 ID | 形成个人副本，以后读取 userdata |
| builtin 项被隐藏 | 不进入普通列表 | `content-state.json` | 文件仍留在安装资源中 |
| 删除个人副本 | 恢复读取 builtin | 归档或删除 userdata 副本 | builtin 重新可见，除非仍被隐藏 |
| builtin 升级且无个人副本 | 新版 builtin | 无 | 自动使用新版 |
| builtin 升级且有个人副本 | userdata | userdata | 保持个人副本，可提示 builtin 已更新 |
| builtin 从发行版移除但有个人副本 | userdata | userdata | 转为普通用户内容 |
| userdata 副本损坏 | 报错 | 修复、归档或显式恢复 | 不静默显示 builtin 冒充用户版本 |

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

物化复制白名单：

- 角色只复制定义文件和静态视觉素材：`character.json`、`soul.md`、可选 `user.md`、可选 `prompt.md`、可选 `visual/`。
- 不从 builtin 复制 `memory.md`、revision、归档或运行状态；这些文件在 userdata 首次需要时按当前协议创建。
- 技能复制完整合法 package，因为 `scripts`、`templates`、`references` 和 `assets` 都可能是技能定义的一部分。
- `.tianshu-source.json` 只在 userdata 副本中生成，builtin 包中不得预置。
- Provider 和主题不调用 `materializeCharacter`/`materializeSkillPackage`，不生成这种来源文件。

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

构建时根据 manifest 校验顶层白名单：声明为 `true` 的 catalog 目录必须存在并通过各自 schema；未声明的未知 catalog 不能静默打包。manifest 不得包含用户数据位置、密钥、机器绝对路径或活动用户选择。

## 8. 统一路径模块

建议新增：

```text
web/server/src/data-paths.ts
web/server/src/content/paths.ts
web/server/src/content/catalog.ts
web/server/src/content/state.ts
web/server/src/content/copy-on-write.ts
```

`data-paths.ts` 是所有可写用户数据目录的公共模块：

```ts
export function dataRoot(): string
export function charactersRoot(): string
export function skillsRoot(): string
export function themesRoot(): string
export function contentStateFile(): string
```

它内部唯一允许调用 `getDataDir()`。角色、技能、主题及后续模块不得各自散落 `resolve(getDataDir(), ...)`。

`content/paths.ts` 只处理只读内置内容及双层内容的路径组合：

```ts
export function builtinContentRoot(): string
export function builtinCharactersRoot(): string
export function builtinSkillsRoot(): string

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

所有 store/catalog 通过 `data-paths.ts` 和 `content/paths.ts` 取路径，避免继续散落 `resolve(getDataDir(), ...)`。主题 store 只依赖 `themesRoot()`，不依赖角色/技能的 catalog、state 或 copy-on-write。

## 9. 角色改造

### 9.1 格式

Builtin 角色允许的格式：

```text
content/builtin/characters/<id>/
├── character.json
├── soul.md
├── user.md         # 可选；只能是通用模板
├── prompt.md       # 可选
└── visual/         # 可选；静态默认视觉配置和素材
```

Userdata 角色允许在相同定义格式上增加可变状态：

```text
<dataDir>/characters/<id>/
├── character.json
├── soul.md
├── user.md
├── prompt.md
├── memory.md
├── visual/
├── revisions/      # 以实际现有协议为准
├── .tianshu-source.json  # 仅个人副本需要
└── ...             # 已登记的角色可变状态
```

Builtin 角色目录发现 `memory.md`、revision、归档标记或其他运行状态时，构建校验必须失败，而不是简单忽略。

`character.json` 的 `runPolicy` 必须按 `RUN_LIMIT_POLICY_PLAN.md` 当前 schema 读取、校验和物化；本计划不得复制定义第二套 `maxSteps/runPolicy` 类型。角色双层合并后发布 revision 时，最终获胜来源的 `runPolicy` 必须进入 snapshot 和 manifest hash。

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

所有内容文件的读取必须根据最终获胜来源解析，不能继续无条件拼接 `<dataDir>/characters/<id>`。

角色工具绑定、技能绑定和会话只保存稳定 ID，不保存内置目录绝对路径。

### 9.3 内置角色绑定技能

内置角色可以通过 `skillBindings` 引用内置或用户技能。解析始终经过合并后的 skill catalog。

构建校验必须确认每个内置角色引用的 skill package 都存在。如果用户覆盖了同 ID 技能，角色自动使用用户版本。

## 10. 技能改造

### 10.1 格式

Builtin 和 userdata 复用同一种 skill package schema；差异在于前者只读、后者可写：

```text
content/builtin/skills/<category>/<package-id>/
或
<dataDir>/skills/<category>/<package-id>/

├── skill-package.json
├── SKILL.md
├── children/
├── references/
├── scripts/
├── templates/
├── tests/
└── assets/
```

`tests/` 可以随 builtin 发布用于构建验证，但生产运行时不得向其中写快照、覆盖率或临时结果。技能脚本产生的文件必须写到调用方明确授权的 workspace、`<dataDir>/tool-output` 或临时目录，不能以 `pkg.dir` 作为默认输出目录。

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

- `skill-package-writer.ts` 创建的新技能只写 `<dataDir>/skills`。
- 编辑内置技能前 copy-on-write。
- evolution/生成器产生的技能只写用户层。
- 内置技能脚本的输出不能写回安装目录，应写工具输出目录或临时目录。

当前技能查找主要按 package ID，但目录还包含 category。第一版应禁止不同 category 出现相同 package ID，或者将所有引用升级为 `category/package-id`。建议先检测并拒绝跨 category 重复 ID，避免扩大迁移范围。

## 11. Provider 预设边界

Provider 只有“预设定义”和“用户配置”两种来源，不采用角色/技能的目录级完整覆盖与 copy-on-write。

Builtin Provider：

```text
content/builtin/providers/<provider-id>/
├── provider.json       # 公开的 provider 类型、端点模板、模型发现能力等
├── icon.svg|png        # 可选；已校验的静态图标
└── README.md           # 可选；公开配置说明
```

只允许包含：

- 稳定 ID、显示名称、公开 API 基础地址或地址模板。
- Provider 类型、公开能力、默认非敏感参数和模型发现方式。
- 官方文档链接、公开图标、许可证和来源说明。

禁止包含：

- API key、access token、refresh token、cookie、账号 ID 或组织私有信息。
- 用户当前选择、启用状态、模型偏好、代理凭据或请求历史。
- 只对开发者本机有效的 localhost 地址、绝对路径和环境变量实际值。

Userdata Provider 保存在既有 `<dataDir>/providers.json` 或专项计划确定的安全存储中，保存用户新增 Provider、对 builtin 预设的实例化配置、启用状态和凭据引用。Builtin Provider 更新只能更新公开预设，不能覆盖用户配置。删除或隐藏预设的状态如有需要，应由 Provider 专项协议保存，不能复用 `content-state.json` 后擅自改变其 schema。

## 12. API 与 UI

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

## 13. 版本升级规则

- 新增内置项：升级后自动出现。
- 未被用户覆盖的内置项：自动使用新版。
- 已有个人副本：继续优先，不被安装包覆盖。
- 已隐藏项：升级后继续隐藏。
- 内置项从发行版移除：用户副本继续作为普通用户内容存在。
- 内置 ID 重命名：必须提供显式 migration 映射，不能直接换目录名。

第一版不做用户副本与新版内置内容的自动三方合并。可以在 UI 提示“内置版本已更新”，由用户选择保留个人副本或恢复新版。

## 14. 构建与 Electron 打包

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
- builtin 顶层和各 catalog 文件均符合白名单，没有用户状态、凭据或运行产物。
- 能扫描到至少一个内置角色和技能。
- API 在打包路径下能返回内置内容。
- 内置目录设为只读时读取和聊天正常。
- 写操作只落临时用户数据目录。
- 写操作前后内置文件 hash 不变。

## 15. 安全要求

- 所有 manifest 做 schema 校验。
- 所有相对路径阻止绝对路径和 `..` 逃逸。
- 解析后的真实路径必须位于对应 source root 内。
- Windows 下防止 symlink/junction 逃出根目录。
- copy-on-write 使用临时目录与原子 rename。
- “内置技能”不能绕过现有工具权限和审批。
- 内置内容不能包含用户密钥、个人信息、真实记忆或本机绝对路径。
- 第三方角色、技能、图片、脚本和模板必须记录许可证与来源。
- 构建时对 builtin 执行敏感字段和高风险文件名扫描；命中后失败并要求人工确认来源，不能只在运行时忽略。
- 打包后 builtin 根应按只读资源处理；即使开发目录可写，服务端也不得提供修改 builtin 的 API。
- userdata API 必须以各自注册根为边界，不能因同 ID 覆盖而跨层拼接文件。

## 16. 测试计划

### 16.1 路径

- `TIANSHU_CONFIG_DIR` 只保存 `config.json`，不会直接承载业务资源目录。
- `charactersRoot()`、`skillsRoot()` 和 `themesRoot()` 都从同一个 `dataRoot()` 派生。
- 开发模式定位仓库 `content/builtin`，但用户数据与 Electron 打包版使用同一目录。
- `TIANSHU_BUILTIN_CONTENT_DIR` 覆盖生效。
- 自定义 `TIANSHU_DATA_DIR` 仍作为用户层。
- Electron 默认 `userData/data` 正常。
- dev Electron 与 packaged Electron 得到相同的 `TIANSHU_CONFIG_DIR` 和默认 dataDir。
- dev server 未显式指定数据目录时也绝不写入 `C:\.Tianshu`。
- 旧 `C:\.Tianshu` 只作为迁移来源；迁移或采用行为可见、可测试且不会反复执行。
- 自动化测试只写临时目录。
- builtin 根白名单和 userdata 根分类与第 2 节一致。
- themes 不会被 builtin content catalog 扫描，content-state 不会隐藏或覆盖主题。

### 16.2 合并

- 只有内置项时返回 builtin。
- 只有用户项时返回 user。
- 同 ID 时用户完整覆盖内置。
- 隐藏状态生效。
- 用户副本损坏时报告错误而非静默 fallback。
- 重复 ID 被检测。
- 排序稳定。

### 16.3 Copy-on-write

- 第一次编辑内置角色创建完整用户副本。
- memory、visual、revision 首次写入会物化角色。
- 第一次编辑内置技能创建完整用户副本。
- 复制失败不留下可被扫描为有效内容的半成品。
- 并发首次写不会损坏副本。
- 所有写操作后内置源文件不变。
- 角色物化不复制 memory/revision 等运行状态，技能物化复制完整合法 package。
- Provider 和主题不会误触发角色/技能物化逻辑。

### 16.4 升级

- 更新未覆盖内置项后使用新版。
- 用户副本升级后保持不变。
- 新内置项自动出现。
- 隐藏项继续隐藏。
- 归档个人副本后恢复新版内置项。

### 16.5 回归

- 现有角色创建、编辑、归档、导入导出正常。
- 现有技能创建、详情、子技能、附件读取正常。
- 角色可绑定内置和用户技能。
- API 返回来源字段。
- UI 正确显示内置/我的/已自定义。
- Provider builtin 只提供公开预设，用户实例、启用状态和凭据只写 userdata。
- Run Policy 系统配置、角色策略 API、revision 快照和前端运行策略 UI 全部保持通过。
- 编辑 builtin 角色的 runPolicy 会先物化用户副本，且已启动 Run 的策略快照不改变。

## 17. 推荐实施顺序

### 阶段 1：统一路径和发行资源

- 建立 `content/builtin` 与根 manifest。
- 若公共 `data-paths.ts` 尚不存在，先实现它及共享路径测试；若主题计划已实现则直接复用。
- 再实现内置内容路径模块和内容状态 store。
- 接入开发及打包路径。
- 增加构建资源校验。
- 先运行 Run Policy 全套回归，记录交接基线；本阶段修改 `config.ts` 时必须保留原子保存 runPolicy 的行为。

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

## 18. 首批内容建议

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

## 19. 验收标准

1. 仓库根目录存在统一的 `content/builtin`。
2. 应用同时发现内置角色、内置技能和用户补充内容。
3. 用户根由公共 `dataRoot()`/`getDataDir()` 决定，开发版与打包版默认对齐到同一个 Electron `userData/data`；characters、skills、themes 均从该根派生。
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
14. Builtin 和 userdata 的文件白名单、禁止项及目录所有权均有自动化校验。
15. Builtin 中不存在 memory、会话、密钥、用户上传、缓存、日志或运行产物。
16. Userdata 中的事实数据与可清理数据有明确分类，清理流程不会删除角色、技能、主题、Provider 或会话事实数据。
17. Run Policy 阶段的 SystemRunPolicy、CharacterRunPolicy、revision、Run snapshot、自动续跑和前端状态测试保持通过。
18. Builtin 角色 runPolicy 遵循 copy-on-write，且不能突破系统安全边界。

## 20. 非目标

第一版不做：

- 用户副本与新版内置内容的自动三方合并。
- 在线内容市场或远程自动下载。
- 在安装目录保存用户记忆或配置。
- 让内置技能绕过工具权限和审批。
- 一次性加入大量低质量预设内容。

核心原则：**内置层负责可靠默认值，用户层负责所有个性化与可变状态；读取时合并，写入时只写用户层。**
