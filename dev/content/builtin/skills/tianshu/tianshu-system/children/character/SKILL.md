---
name: tianshu-character-management
description: "设计 TianShu 角色人格，并创建/增量更新角色及其工具、角色技能包绑定：读写 dataDir 下的 characters/<id>/。"
---

# 角色管理

角色是**纯文件**：`<dataDir>/characters/<id>/` 目录，主元数据在 `character.json`，可选人格/用户/记忆在 `soul.md`/`user.md`/`memory.md`/`prompt.md`。没有数据库、没有专用工具——直接读改写这些文件即可。

> 路径：`<dataDir>` 是**本技能激活时注入的真实绝对路径**（激活返回里会给出，例如 `C:\...\devdata`）。把下文所有 `<dataDir>` 替换成该路径再操作；若找不到，用 `bash` 执行 `echo $TIANSHU_DATA_DIR` 或 `cd` 到激活返回中的数据目录确认。
> content 层是只读出厂底稿：系统首次写某个内置角色时会**自动物化一个用户副本**到 `<dataDir>/characters/<id>/`，你之后都改这个副本；想回退到出厂版用 REST（`/api/characters/.../restore-builtin`）或删除该副本目录。永远只读写 `<dataDir>/characters/<id>/`，不要接触 content 层。

## 数据结构

`character.json` 关键字段：

```json
{
  "id": "3",
  "name": "智能助手",
  "role": "both",
  "description": "…",
  "provider": "deepseek",
  "model": "deepseek-chat",
  "tools": [{ "name": "read" }, { "name": "bash" }, { "name": "mcp:filesystem" }],
  "skillBindings": [{ "packageId": "tianshu-system", "enabled": true }],
  "default_strategy": "Ask Risky",
  "memory": { "enabled": true },
  "runPolicy": { "soft_turns": 50 }
}
```

可选字段：`avatar`、`color`、`maxSteps`（旧字段）、`groups`、`enabled`、`hidden`。

## 操作

1. **列出**：`glob`/`read` `dataDir` 下的 `characters/*/character.json`，确认已有角色的 `id`（自增数字，需唯一且与目录名一致）。
2. **创建**：新建 `<dataDir>/characters/<id>/character.json`，`id` 取当前最大整数 +1。
3. **更新**：`edit` `character.json`，修改 `soul`/`provider`/`model`/`tools`/`skillBindings` 等字段；**增量改绑定**优先只增删 `tools` 数组项或 `skillBindings` 项，不要整体覆盖你没动过的字段。
4. **工具/技能绑定**：
   - 工具：往 `tools` 数组加/删 `{ "name": "<tool>" }`（含 `mcp:<server>`）。
   - 技能包：改 `skillBindings` 数组（`{ "packageId", "enabled" }`）。
5. **删除**：删除 `<dataDir>/characters/<id>/` 目录；删除前确认没有会话/子代理仍引用该角色。
6. **验证**：`read` 确认写回正确，并在新会话中测试角色行为。

## 注意

- 修改前先 `read`，修改后再次 `read`，确认未涉及的字段都保留了。
- 人格/用户信息/记忆不要互相重复；临时任务信息不要写进长期人格（`soul.md`）。
- 不要用完整技能数组覆盖旧绑定，除非用户明确要求整体替换。
