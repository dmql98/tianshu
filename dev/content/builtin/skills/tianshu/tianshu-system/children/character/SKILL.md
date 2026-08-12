---
name: tianshu-character-management
description: "设计 TianShu 角色人格，并使用 character_manager 安全创建或增量更新角色、工具和技能包绑定。"
---

# 角色管理

角色由人格内容、用户信息、记忆和元数据组成。人格应简洁写明身份、目标、语气、边界和完成标准。

## 创建

1. 明确角色名称、职责以及 `main`、`sub` 或 `both` 角色类型。
2. 编写 `soul`，只放长期稳定的人格与行为约束。
3. 选择最小工具白名单和技能包集合。
4. 调用 `character_manager create`，不要直接创建角色文件。
5. 用 `read` 验证结果，并在新会话中测试。

## 更新

- 更新技能包优先使用 `skill_packages_add`、`skill_packages_remove`。
- 不要提交完整技能数组覆盖旧绑定，除非用户明确要求整体替换。
- 修改前先 `read`，更新后再次 `read` 检查未涉及字段是否保留。
- 工具约束使用 `tools_json`，避免逗号字符串丢失约束结构。

人格、用户信息和记忆不要互相重复；临时任务信息不应写进长期人格。
