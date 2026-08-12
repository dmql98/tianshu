---
name: tianshu-tool-constraints
description: "为 TianShu 角色设计最小工具白名单和路径、命令、文件大小、只读等约束，并安全写入角色配置。"
---

# 工具约束

先读取角色当前工具配置，再做最小修改。添加或删除普通工具使用 `tools_add`、`tools_remove`；修改结构化约束时使用 `tools_json` 并显式设置 `tools_mode=replace`，不直接编辑角色文件。

常用约束：

- 文件工具：`allowed_paths`、`denied_paths`、`max_file_size`
- Bash：`allowed_commands`、`denied_patterns`
- 数据/MCP：`readonly`、`max_rows`

原则：

1. 只授予角色任务真正需要的工具。
2. 允许范围尽量具体，拒绝范围用于补充防护。
3. 不用宽泛工作区授权代替精确工具约束。
4. 更新后重新读取角色配置，并用安全的只读操作验证约束。
5. 不要因为添加一个工具而覆盖其他工具的既有约束。
