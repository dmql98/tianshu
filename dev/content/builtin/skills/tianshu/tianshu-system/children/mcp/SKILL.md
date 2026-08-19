---
name: tianshu-mcp-management
description: "查看、创建、更新、测试或删除 TianShu MCP 服务，并将服务绑定到角色：读写 dataDir 下的 mcpservers/<name>/config.json。"
---

# MCP 管理

MCP 服务配置是**纯文件**：`<dataDir>/mcpservers/<name>/config.json`（每个服务一个目录）。没有数据库、没有专用工具——直接读写该文件即可。

> 路径：`<dataDir>` 是**本技能激活时注入的真实绝对路径**（激活返回里会给出，例如 `C:\...\devdata`）。把下文所有 `<dataDir>` 替换成该路径再操作；若找不到，用 `bash` 执行 `echo $TIANSHU_DATA_DIR` 或 `cd` 到激活返回中的数据目录确认。
> 启动时系统会把 content 出厂内容物化到 `<dataDir>`；MCP 配置的实际读写**始终用** `<dataDir>/mcpservers/*/config.json`（用户层）。

## 数据结构

`<dataDir>/mcpservers/<name>/config.json` 形如：

```json
{
  "id": "<uuid>",
  "name": "filesystem",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem"],
  "env": { "KEY": "VALUE" },
  "cwd": ".",
  "timeout": 60
}
```

## 操作

1. **列出**：`read <dataDir>/mcpservers/` 下各目录，或 `glob` 找出全部 `config.json`，确认是否已有同名服务。
2. **创建**：新建 `<dataDir>/mcpservers/<name>/config.json`，填 `name`/`command`/`args`/`env`/`cwd`/`timeout`；`name` 用稳定名称（`command` 是启动命令，如 `npx`/`node`/`python`）。
3. **修改**：`edit` 该 `config.json`，更新后**需重连才生效**——新开会话会被重新连接。
4. **删除**：删除目录 `<dataDir>/mcpservers/<name>/`；删除前先确认没有角色仍绑定 `mcp:<name>`。
5. **绑定到角色**：在目标角色的 `character.json` 的 `tools` 数组中加入 `{ "name": "mcp:<name>" }`。
6. **验证**：新开会话，确认工具以 `mcp__<server>__<tool>` 出现。

## 注意

- 更新前先 `read`；删除前先确认没有角色仍绑定该服务。
- `env` 里可能有密钥/Token，读取/输出时不要回显完整值。
