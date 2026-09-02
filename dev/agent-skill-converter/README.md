# Agent Skill Converter

将 Agent Skills 标准格式（Codex/Claude Code/OpenClaw/Hermes）转换为天枢技能包格式，或反向转换。

## 格式对比

| 维度 | Agent Skills 标准 | 天枢技能包格式 |
|------|------------------|---------------|
| 清单文件 | 无 | `skill-package.json`（必需） |
| 核心文件 | `SKILL.md` + YAML frontmatter | `SKILL.md` + YAML frontmatter |
| 子目录 | `references/`、`scripts/`、`assets/` | `children/` + `references/`、`scripts/`、`assets/` |
| 子技能 | 无（单层） | `children/<child>/SKILL.md` |

## 兼容策略

### 天枢支持 Agent Skills 标准
1. `skill-package.json` 变为**可选增强清单**
2. 当没有 `skill-package.json` 时，从 `SKILL.md` frontmatter 解析元数据
3. Agent Skills 标准技能可直接放入 `skills/<category>/` 目录使用

### Frontmatter 扩展字段
```yaml
---
name: my-skill
description: "一句话描述"
# 天枢扩展（可选）
category: web
version: 1.0.0
children:
  - id: sub-skill
    name: 子技能名
    preload: false
---
```

## 使用方法

### Agent Skills → 天枢格式
```bash
python convert.py agent-to-tianshu <skill-dir> <output-dir>
```

### 天枢格式 → Agent Skills
```bash
python convert.py tianshu-to-agent <skill-dir> <output-dir>
```

### 批量转换
```bash
python convert.py batch-agent-to-tianshu <source-dir> <output-dir>
```
