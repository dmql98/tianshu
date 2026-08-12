---
name: tianshu-mcp-management
description: "使用 mcp_manager 安全地查看、创建、更新、测试或删除 TianShu MCP 服务，并将服务绑定到角色。"
---

# MCP 管理

不要直接写 `mcpservers/*/config.json`。配置读写、默认值和校验全部交给 `mcp_manager`。

## 工作流

1. 调用 `mcp_manager` 的 `list` 检查是否已有同名服务。
2. 创建时传入稳定名称、启动命令、参数、环境变量、工作目录和超时。
3. 调用 `test` 验证进程能启动并列出工具。
4. 测试成功后，用 `character_manager update` 的 `tools_add` 把 `mcp:<name>` 增量加到目标角色。
5. 新开会话验证工具以 `mcp__<server>__<tool>` 出现。

更新前先 `read`。删除前先确认没有角色仍绑定该服务。错误排查以 `test` 返回为准，不绕过管理工具修改底层文件。
