---
name: "tianshu-system"
description: "天枢系统管理统一入口；按需激活角色、会话、模型服务、MCP、技能包、工具约束或失败自愈子技能。"
---

# 天枢系统管理

优先调用系统提供的管理工具，不直接编辑底层配置文件：

- 角色创建和更新：`tianshu-system/character` → `character_manager`
- 会话、工作区和策略问题：`tianshu-system/session`
- 模型服务配置：`tianshu-system/provider` → `provider_manager`
- MCP 服务配置和连通测试：`tianshu-system/mcp` → `mcp_manager`
- 技能包创建和维护：`tianshu-system/skill-authoring`（直接落盘到 `skills/<category>/<id>/`，`skill_manager` 不暴露 create_package）
- 工具白名单和约束：`tianshu-system/tool-constraint` → `character_manager`
- 连续工具失败：`tianshu-system/doom-loop-escape`

管理工具负责读写和校验，子技能只提供决策流程与完成标准。一次只激活当前任务对应的子技能。


## 子技能

### tianshu-character-management

设计 TianShu 角色人格，并创建/增量更新角色及其工具、角色技能包绑定：读写 dataDir 下的 characters/<id>/。

> 详见 `character/SKILL.md`

### doom-loop-escape

结构化自愈协议：识别工具失败的 Doom Loop，诊断根因，切换策略逃逸

> 详见 `doom-loop-escape/SKILL.md`

### tianshu-mcp-management

查看、创建、更新、测试或删除 TianShu MCP 服务，并将服务绑定到角色：读写 dataDir 下的 mcpservers/<name>/config.json。

> 详见 `mcp/SKILL.md`

### tianshu-provider-management

配置和检查 TianShu 的 OpenAI 兼容模型服务及模型列表：读写 dataDir 下的 providers.json。

> 详见 `provider/SKILL.md`

### session-management

理解 TianShu 会话机制：session 生命周期、workspace 解析、会话状态管理

> 详见 `session/SKILL.md`

### tianshu-skill-package-authoring

设计和维护 TianShu 标准技能包：根技能路由、按需子技能、Manifest 与文件系统落盘即注册。内置完整模板，无需另查参考。

> 详见 `skill-authoring/SKILL.md`

### tianshu-tool-constraints

为 TianShu 角色设计最小工具白名单和路径、命令、文件大小、只读等约束，并安全写入角色配置。

> 详见 `tool-constraint/SKILL.md`

