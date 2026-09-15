---
name: tianshu-skill-package-authoring
description: "设计和维护 TianShu 标准技能包：根技能路由、按需子技能、Manifest 与文件系统落盘即注册。内置完整模板，无需另查参考。"
---

# 技能包编写

新技能人员应优先复用标准包格式，不再创建裸 `SKILL.md` 目录。

## 设计

1. 先确定包的单一领域边界。
2. 根 `SKILL.md` 只写能力路由和选择规则，保持简短。
3. 只有职责可独立触发、内容足够专门时才拆成子技能。
4. 详细资料放 `references/`，确定性操作放 `scripts/`，输出素材放 `assets/`。
5. 子技能默认按需加载，不要为了"可能有用"而预加载。
6. **系列技能优先做总包**：同一来源（如同一 GitHub 仓库）、同一领域、或共享同一运行时前置的多个技能，应合并为 **1 个总包 + `children` 子技能**（例：OpenCLI 的 7 个技能合并为 `opencli` 包，引用格式 `opencli/opencli-browser`），**不要拆成多个独立包**。只有领域边界清晰、无共享前置的单个能力才作为独立包。导入外部仓库的系列技能时同样先合并为总包再落盘。

## 创建与验证（落盘即注册）

技能发现是**文件系统驱动**：目录 API 扫描 `skills/<category>/<id>/skill-package.json` 来识别一个包。因此"创建技能"= 在磁盘落盘一份标准包，**无需 REST 工作台、无需任何注册动作**。`skill_manager` 当前对模型不暴露 `create_package`/`update`/`delete`（已下沉到工作台），直接按下面落盘即可，落盘即被发现。

1. 选稳定的包 ID（slug）与分类目录 `<category>`（如 `patent`/`web`/`tianshu`，复用已有分类或新建目录均可），在 `skills/<category>/<id>/` 下建包。
2. 修改已有包前先 `skill_manager describe_package` 查看现状，避免覆盖现有子技能。
3. 自检：`skill_manager list_packages` 能看到该包即注册成功；再确认角色能绑定、子技能能单独激活。
4. 更新角色绑定时只增量添加包 ID，不把子技能列表写入角色配置。

## Agent Skills 开放标准兼容

天枢兼容 **Agent Skills 开放标准**（被 Codex、Claude Code、OpenClaw、Hermes、ChatGPT 等广泛采用）。

### 兼容策略

| 格式 | 发现机制 | 说明 |
|------|----------|------|
| **天枢标准格式** | `skill-package.json` | 完整元数据（category、version、children），优先使用 |
| **Agent Skills 格式** | `SKILL.md` frontmatter | 仅 name/description，`skill-package.json` 可选增强 |

- 当目录有 `skill-package.json` 时：按天枢标准格式处理（当前默认行为）。
- 当目录**仅有** `SKILL.md`（无 `skill-package.json`）时：从 frontmatter 解析 name/description，自动注册为天枢技能包。
- 天枢扩展字段（`category`、`version`、`children`）可通过 frontmatter 传递（见下方"Frontmatter 扩展字段"）。

### Frontmatter 扩展字段（天枢专用，可选）

在标准 Agent Skills frontmatter 中，天枢额外支持以下字段：

```yaml
---
name: my-skill
description: "一句话描述"
category: web           # 天枢分类目录（可选）
version: 1.0.0          # 语义化版本（可选）
children:               # 子技能列表（可选）
  - id: sub-skill
    name: 子技能名
    description: 子技能描述
    preload: false
---
```

### 导入外部技能

使用 `agent-skill-converter` 工具转换：

```bash
# 单个技能转换
python convert.py agent-to-tianshu <外部技能目录> <输出目录> --category web

# 批量转换
python convert.py batch-agent-to-tianshu <源目录> <输出目录> --category community
```

将输出复制到 `skills/<category>/` 下即可被天枢发现。

**系列技能合并要求**：若外部仓库的 `skills/` 下是一批同源技能（如 OpenCLI 的 opencli-browser / opencli-usage / smart-search 等），**必须合并为 1 个总包**：建 `skills/<category>/<id>/skill-package.json` + 根 `SKILL.md`，把各技能作为 `children/<child>/` 子技能移入，而不是各自独立成包。合并后角色只绑定 1 个包 ID，按需激活子技能（引用 `<package>/<child>`）。

### 格式检测命令

```bash
python convert.py analyze <技能目录>
```

输出 JSON，包含 `format`（`agent-skills` | `tianshu` | `unknown`）和详细信息。

## 模板（复制即用，无需另查参考）

### 目录结构（天枢标准格式）
```
skills/<category>/<id>/
├── skill-package.json      # 根 Manifest（必需）
├── SKILL.md                # 根技能正文（必需，由 root 字段指向）
├── references/             # 详细资料（可选）
├── scripts/                # 确定性操作脚本（可选）
├── assets/                 # 输出素材（可选）
└── children/               # 子技能（可选）
    └── <child>/
        └── SKILL.md        # 子技能正文（frontmatter + 正文）
```

### 目录结构（Agent Skills 标准格式）
```
<skill-id>/
├── SKILL.md                # 技能正文（必需，含 YAML frontmatter）
├── references/             # 详细资料（可选）
├── scripts/                # 确定性操作脚本（可选）
└── assets/                 # 输出素材（可选）
```

### 根 skill-package.json
```json
{
  "source": "user",
  "schemaVersion": 1,
  "id": "<id-slug>",
  "name": "<可读名称>",
  "version": "1.0.0",
  "category": "<category>",
  "description": "<一句话能力描述>",
  "root": "SKILL.md",
  "children": [
    {
      "id": "<child-slug>",
      "name": "<子技能可读名>",
      "path": "children/<child-slug>",
      "description": "<子技能一句话描述>",
      "preload": false
    }
  ]
}
```
字段说明：
- `source`：来源标记，`user`（用户创建）、`builtin`（出厂）或 `agent-skills`（从外部导入）。
- `schemaVersion`：清单格式版本，当前固定 `1`。
- `id`：包 ID，稳定 slug（如 `docx-merge`），同时是目录名。
- `name`：展示名。
- `version`：语义化版本。
- `category`：分类目录名（即 `skills/` 下的子目录）。
- `description`：一句话能力描述，会出现在 `list_packages`。
- `root`：根正文文件名，默认 `SKILL.md`。
- `children`：子技能数组；无则 `[]`。每项含 `id`/`name`/`path`/`description`/`preload`（`preload` 是否随父包预加载）。

### 根 SKILL.md
```markdown
---
name: <id-slug>
description: "<一句话能力描述，与 Manifest 对应>"
---

# <展示名>

<能力路由与选择规则：什么场景用本包、何时激活哪个子技能。保持简短。>
```

### 子技能 SKILL.md（children/<child>/SKILL.md）
```markdown
---
name: <child-slug>
description: "<子技能一句话描述>"
---

# <子技能名>

<子技能的完整指引：何时用、输入、步骤、验证、边界。>
```
子技能 ID 引用格式 `<package>/<child>`（如 `tianshu-system/skill-authoring`）。
