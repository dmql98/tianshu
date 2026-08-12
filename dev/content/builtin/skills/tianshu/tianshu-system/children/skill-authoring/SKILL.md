---
name: tianshu-skill-package-authoring
description: "设计和维护 TianShu 标准技能包，包括根技能路由、按需子技能、Manifest 和渐进加载边界。"
---

# 技能包编写

新技能必须使用标准包格式，不再创建裸 `SKILL.md` 目录。

## 设计

1. 先确定包的单一领域边界。
2. 根 `SKILL.md` 只写能力路由和选择规则，保持简短。
3. 只有职责可独立触发、内容足够专门时才拆成子技能。
4. 详细资料放 `references/`，确定性操作放 `scripts/`，输出素材放 `assets/`。
5. 子技能默认按需加载，不要为了“可能有用”而预加载。

## 创建与验证

- 用 `skill_manager create_package` 创建根技能包；不再支持旧的 `create` 动作。
- Manifest 中使用稳定包 ID 和子技能 ID，引用格式为 `<package>/<child>`。
- 修改前先 `describe_package`，避免覆盖现有子技能。
- 完成后检查包能被目录 API 发现、角色能绑定包、子技能能单独激活。

更新角色绑定时只增量添加包 ID，不把子技能列表写入角色配置。
