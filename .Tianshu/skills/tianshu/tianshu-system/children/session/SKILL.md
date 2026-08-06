---
name: session-management
description: "理解 TianShu 会话机制：session 生命周期、workspace 解析、会话状态管理"
---

# Session Management Guide

## Session 是什么

每次用户发送消息创建一个 session。Session 包含对话上下文、workspace、策略状态、已批准的工具等状态。

## 数据存储

Session 存储在 TianShu 数据目录（默认 `C:\.Tianshu`）下的 `sessions.db` 的 `sessions` 表中：

```
id          TEXT PRIMARY KEY
character_id TEXT
title       TEXT
model       TEXT
provider_id TEXT
workspace   TEXT
parent_id   TEXT (子 session 用)
active_group TEXT
input_tokens  INTEGER
output_tokens INTEGER
```

## Workspace（工作目录）

Workspace 是所有文件操作的根目录。会在以下情况用到：

- **初始化**：创建 session 时指定 workspace（来自 API 请求）
- **默认值**：如未指定，使用 `process.cwd()` 的父目录的 `default-workspace/`
- **子 session**：子 agent 继承父 session 的 workspace
- **MCP**：MCP 服务器通过 `ListRoots` 获取 workspace 路径

System prompt 中会明确写出 workspace 路径：
```
## Workspace
Your working directory is: /path/to/workspace
All file operations (read/write/edit/glob/bash) use this directory as root.
```

## 会话状态（SessionState）

每个 session 在内存中维护 `SessionState`：

```typescript
interface SessionState {
  current_strategy: 'Plan' | 'Ask' | 'Bypass'
  strategy_modified_by: 'user' | 'system'
  approved_tools: Set<string>
  allowed_paths: string[]
}
```

### 策略（Strategy）

- **Plan**：Agent 在操作前先给出计划，用户确认后才执行危险操作
- **Ask**：Agent 需要每步征求用户同意
- **Bypass**：Agent 自动执行所有操作（不等待确认）

策略由用户或系统修改，记录修改来源。

### 工具批准（approved_tools）

当 agent 调用一个危险工具时，系统会请求用户批准。用户选"始终允许"后该工具加入 `approved_tools`，后续调用不再弹确认。用户选"仅一次"则不加入列表。

### 路径批准（allowed_paths）

当 agent 的工具被 `assertPathSafe` 拦截（路径超出 workspace 或 allowedRoots），系统会请求用户批准。用户选"始终允许"后该路径加入 `allowed_paths`，后续操作不再拦截。

## 会话生命周期

1. 用户发送消息 → 创建/关联 session
2. 加载角色 → 读取 character.json，确定 tools/skills 白名单
3. 连接 MCP → 按 `mcp:*` 白名单连接服务器，展开工具列表
4. 构建 system prompt → 注入角色、工具、技能
5. 运行循环 → LLM 多轮调工具直到 `task_complete`
6. 清理 → 断开 MCP 连接，保存 token 计数

## 子 Session（Sub-agent）

通过 `delegate_task` 工具创建子 session，继承父 session 的 workspace：

- 子 session 使用目标角色的 tools/skills 白名单
- 子 session 完成后结果返回父 session
- MCP 连接在 parent session 中管理，传递给子 session
