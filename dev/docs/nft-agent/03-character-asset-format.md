# 天枢角色资产格式设计（四层资产 schema v1）

> 设计目标：把天枢现有「角色（character）+ 皮肤（skin）」扩展为可打包、可分发、可验证、可选择性上链的**角色资产**，同时保证与现有 `dataDir` 结构 100% 兼容（旧角色不迁移也能运行）。
> 本文含：目录约定、manifest schema、四层 schema、JSON 示例、与现有结构的映射、导入导出流程、上链凭证。

---

## 一、资产包定义

### 1.1 命名与载体

| 项 | 值 |
|---|---|
| 资产包扩展名 | `.tskin`（皮肤包）/ `.tchar`（完整角色包），本质为 zip |
| 资产类型 `type` | `skin`（仅视觉层）/ `character`（四层可选组合） |
| 存放位置 | 导入后解包至 `dataDir/assets/<assetId>/`，与 `characters/`、`skin/` 平级 |

### 1.2 资产包目录（统一约定）

```
dataDir/assets/<assetId>/
├── manifest.json          # 资产清单（必填，v1）
├── visual/                # 视觉层：皮肤
│   ├── portrait.png       # 立绘（推荐 1200×1600，3:4，PNG/WebP ≤5MB）
│   ├── avatar.png         # 头像（推荐 512×512，≤2MB）
│   ├── idle.mp4           # 动画 ×6：idle/thinking/working/speaking/success/error
│   ├── thinking.mp4
│   ├── working.mp4
│   ├── speaking.mp4
│   ├── success.mp4
│   ├── error.mp4
│   └── visual.json        # 渲染参数（复用现有 visual.json 格式：defaultMotion/motions/crop/avatarCrop）
├── persona/               # 人格层（可选）
│   ├── persona.json       # 结构化性格参数
│   └── soul.md            # 人格定义（复用现有 soul.md 格式）
├── capability/            # 能力层（可选）
│   ├── capability.json    # 技能包/工具/MCP/运行策略
│   └── skills/            # 随包内嵌技能（可选，SKILL.md 格式）
├── memory/                # 记忆层（可选）
│   ├── memory.json        # 记忆种子与参数
│   ├── background.md      # 背景故事
│   └── knowledge/         # 知识库文件（md/txt/json）
└── certificate.json       # 上链凭证（可选，仅元数据哈希，见 §5）
```

> 兼容性说明：现有 `skin/<skinId>/` 目录（skin.json + 立绘/头像/6 动画）即「未打包的 visual 层」，可一键导出为 `.tskin`；现有 `characters/<id>/visual/` 同样可映射（见 §4 映射表）。

---

## 二、manifest.json（资产清单 v1）

```json
{
  "schemaVersion": 1,
  "assetId": "tskin_golden-assistant-2026",
  "type": "skin",
  "name": "鎏金秘书",
  "description": "小红 · 鎏金限定皮肤：商务鎏金配色，含 6 个专属动画",
  "author": {
    "id": "tianshu-official",
    "name": "天枢官方",
    "contact": ""
  },
  "version": "1.0.0",
  "rarity": "epic",
  "license": {
    "type": "personal-use",
    "allowedUses": ["use", "display", "share-within-account"],
    "forbiddenUses": ["resale", "secondary-trading", "commercial-derivative"],
    "notice": "本资产为个人使用许可，禁止转售与二级交易"
  },
  "createdAt": 1787000000000,
  "updatedAt": 1787000000000,
  "layers": {
    "visual":  { "present": true,  "files": ["visual/portrait.png", "visual/avatar.png", "visual/idle.mp4", "visual/thinking.mp4", "visual/working.mp4", "visual/speaking.mp4", "visual/success.mp4", "visual/error.mp4", "visual/visual.json"], "sha256": "…" },
    "persona":  { "present": false },
    "capability": { "present": false },
    "memory":   { "present": false }
  },
  "compatibility": { "tianshu": ">=0.9.0" },
  "certificate": null
}
```

字段说明：
- `assetId`：全局唯一，生成规则 `tskin_<slug>_<yyyy>` 或 `tchar_<slug>_<yyyy>`。
- `type=skin` 时只启用 visual 层；`type=character` 时可携带任意层组合（至少一层）。
- `rarity`：`common / rare / epic / legendary`，仅用于商店展示与定价分层，**不构成任何价值承诺**。
- `license`：明确使用许可范围，与合规要求绑定（见合规报告 §4）。
- `layers.*.sha256`：层内容哈希，用于完整性校验与可选上链。

---

## 三、各层 schema 与 JSON 示例

### 3.1 visual 层（复用现有格式）

`visual/visual.json` 与现有 `characters/<id>/visual/visual.json` 完全一致：

```json
{
  "schemaVersion": 1,
  "defaultMotion": "idle",
  "motions": {
    "idle":     { "assetId": "casset_idle",     "loop": true,  "crop": { "x": 53.3, "y": 11.0, "scale": 1 } },
    "thinking": { "assetId": "casset_thinking", "loop": true,  "crop": { "x": 55.9, "y": 17.7, "scale": 1 } },
    "working":  { "assetId": "casset_working",  "loop": true,  "crop": { "x": 51.5, "y": 19.5, "scale": 1 } },
    "speaking": { "assetId": "casset_speaking", "loop": true,  "crop": { "x": 54.1, "y": 16.4, "scale": 1 } },
    "success":  { "assetId": "casset_success",  "loop": false, "crop": { "x": 52.8, "y": 19.2, "scale": 1 } },
    "error":    { "assetId": "casset_error",    "loop": false, "crop": { "x": 55.4, "y": 25.6, "scale": 1 } }
  },
  "originalAssetId": "casset_original",
  "avatarCrop": { "x": 51.2, "y": 7.4, "scale": 2.1 }
}
```

> 资产包内 `assetId` 采用包内相对名（`casset_<motion>`），导入时由系统替换为实际落盘 UUID 并生成 `assets.json` 索引——与现有 `characters/<id>/visual/assets.json` 机制一致。

### 3.2 persona 层（人格）

`persona/persona.json`：

```json
{
  "personaVersion": 1,
  "name": "小红 · 鎏金",
  "traits": {
    "warmth": 0.7,
    "reliability": 0.95,
    "directness": 0.8,
    "humor": 0.2,
    "riskAwareness": 0.9
  },
  "speechStyle": {
    "tone": "professional-warm",
    "formality": 0.8,
    "emojiUsage": 0.1,
    "selfReference": "小红"
  },
  "soul": "soul.md",
  "overrides": {
    "memory": { "enabled": true, "selfEvolution": false, "charLimit": 2200 }
  }
}
```

- `traits`：性格参数（0~1），供商店展示「人格画像」与推荐匹配；实际行为由 `soul.md` 驱动，参数为辅助。
- `soul.md`：与现有 `characters/<id>/soul.md` 格式一致（Markdown，含核心人格/工作方式/沟通方式等）。
- `overrides`：可覆盖角色 `character.json` 中对应字段，未列出的保持宿主角色现值。

### 3.3 capability 层（能力）

`capability/capability.json`：

```json
{
  "capabilityVersion": 1,
  "skills": [
    { "packageId": "tianshu-system", "enabled": true, "preloadSkills": [] },
    { "packageId": "agent-reach",    "enabled": true, "preloadSkills": [] }
  ],
  "tools": [
    { "name": "bash" }, { "name": "read" }, { "name": "write" },
    { "name": "edit" }, { "name": "glob" }, { "name": "grep" },
    { "name": "webfetch" }, { "name": "websearch" }, { "name": "get_time" },
    { "name": "skill_manager" }, { "name": "task_complete" }
  ],
  "mcps": [
    { "name": "codebase-memory-mcp", "required": false },
    { "name": "codegraph", "required": false }
  ],
  "runPolicy": { "version": 1, "softTurns": 999, "graceTurns": 0 }
}
```

- 字段结构与现有 `character.json` 的 `skills / skillBindings / tools / runPolicy` 一一对应。
- `mcps.required=false`：缺 MCP 时降级运行，不阻断安装。
- 安全边界：capability 层**只增不删**——导入时与宿主角色现有工具取并集，不从角色上移除工具。

### 3.4 memory 层（记忆/背景）

`memory/memory.json`：

```json
{
  "memoryVersion": 1,
  "background": "background.md",
  "knowledge": ["knowledge/*.md"],
  "seed": {
    "entries": [
      { "type": "fact",     "content": "你是天枢官方发布的鎏金限定秘书角色" },
      { "type": "preference", "content": "偏好简洁直接的汇报" }
    ]
  },
  "charLimit": 2200,
  "selfEvolution": false
}
```

- `seed.entries` 为「初始记忆种子」，导入时写入角色记忆，不覆盖用户已有记忆。
- `background.md`：背景故事，供人格一致性参考。
- `knowledge/`：知识库文件，可导入为角色可检索资产。

---

## 四、与现有结构的映射（兼容性验证）

| 现有结构 | 映射到资产层 | 说明 |
|---|---|---|
| `characters/<id>/character.json`（id/name/description/color） | manifest 元数据 | 导出时生成资产基础信息 |
| `characters/<id>/character.json`（skills/skillBindings/tools/runPolicy/memory/skinId） | capability + persona.overrides | 逐字段对应 |
| `characters/<id>/soul.md` | persona/soul.md | 原样复制 |
| `characters/<id>/user.md` | 不打包 | 用户私有信息，不入资产包 |
| `characters/<id>/memory.md` | 不打包（仅 seed 可选） | 用户成长记忆属用户，不属于创作者资产 |
| `characters/<id>/visual/{visual.json, assets.json, assets/}` | visual/ | 按 motion 语义重命名导出 |
| `skin/<skinId>/{skin.json, portrait, avatar, 6动画}` | visual/ | 文件名即语义，直接映射 |

> 关键决策：**user.md 与 memory.md 不进资产包**。资产只承载「创作者定义的内容」，用户私有数据（对话记录、成长记忆、用户画像）永远留在本地，避免隐私与资产边界问题。

---

## 五、上链凭证 certificate.json（可选，合规版）

> 仅在阶段二（轻量上链）启用；默认资产包不含此文件。

```json
{
  "certificateVersion": 1,
  "chain": "antchain",
  "tokenId": "0x…",
  "manifestHash": "sha256:…",
  "issuedAt": 1787000000000,
  "issuer": "天枢（备案主体）",
  "rights": ["use", "display"],
  "legalNotice": "本凭证仅作为数字商品购买记录与收藏证明，不构成任何投资品、不承诺升值、不支持转售与二级交易；依据《关于防范NFT相关金融风险的倡议》及《数字藏品应用参考》执行。"
}
```

合规要点（与监管报告一致）：
- 上链内容仅 `manifestHash` 与购买记录，**不包含** soul.md/记忆/用户数据。
- 使用国内合规联盟链，主体完成区块链信息服务备案。
- `rights` 仅含 use/display，**不含 transfer/trade**。

---

## 六、导入 / 导出 / 激活流程

### 6.1 导入（.tskin / .tchar → 资产库）
1. 校验 zip 结构与 manifest.json（schemaVersion、必需文件、哈希）。
2. 解包至 `dataDir/assets/<assetId>/`，visual 层 assetId 替换为落盘 UUID 并生成 `assets.json`。
3. 校验 license 与宿主版本兼容性；检查 MCP/技能依赖，缺失则标记降级。
4. 资产进入「我的资产库」，可预览、可绑定。

### 6.2 激活（绑定到角色）
- 视觉层：写 `character.json.skinId = <assetId>`（复用现有皮肤绑定机制）。
- 人格/能力/记忆层：`character.json` 新增 `assetBindings: { persona, capability, memory }` 数组，启用时按「只增不删」原则合并；停用时回退宿主现值。

### 6.3 导出（角色 → 资产包）
1. 选择四层组合与元数据（名称/描述/稀有度/license）。
2. 生成 manifest（含各层 sha256）→ 打包 zip → 可选签名。
3. 可选：生成 certificate（上链凭证）后导出。

---

## 七、后续待办（实现层面）

- [ ] `data-paths.ts` 新增 `assetsRoot()`；manifest 校验与导入工具（服务端）
- [ ] 前端「资产库」页 + 商店卡片（复用现有角色卡片组件）
- [ ] 角色详情页新增「资产绑定」区块（皮肤 Tab 扩展）
- [ ] 导出签名与验签（可选，用现有密钥体系）
- [ ] 上链模块（阶段二）：联盟链对接 + 备案主体

*本设计为 v1 草案，字段可按实现反馈调整；核心约束：与现有结构兼容、只增不删、用户数据不入包、上链仅元数据。*
