---
name: tianshu-system
description: 天枢系统管理统一入口；按需激活角色、会话、模型服务、MCP、技能包、工具约束或失败自愈子技能。
---

# 天枢系统管理

优先调用系统提供的管理工具，不直接编辑底层配置文件：

- 角色创建和更新：`tianshu-system/character` → `character_manager`
- 会话、工作区和策略问题：`tianshu-system/session`
- 模型服务配置：`tianshu-system/provider` → `provider_manager`
- MCP 服务配置和连通测试：`tianshu-system/mcp` → `mcp_manager`
- 技能包创建和维护：`tianshu-system/skill-authoring` → `skill_manager`
- 工具白名单和约束：`tianshu-system/tool-constraint` → `character_manager`
- 连续工具失败：`tianshu-system/doom-loop-escape`

管理工具负责读写和校验，子技能只提供决策流程与完成标准。一次只激活当前任务对应的子技能。
