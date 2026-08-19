---
name: tianshu-provider-management
description: "配置和检查 TianShu 的 OpenAI 兼容模型服务及模型列表：读写 dataDir 下的 providers.json。"
---

# 模型服务管理

Provider 配置是**纯文件**：`<dataDir>/providers.json`（一个 JSON 数组）。没有数据库、没有专用工具——直接读改写这个文件即可。

> 路径：`<dataDir>` 是**本技能激活时注入的真实绝对路径**（激活返回里会给出，例如 `C:\...\devdata`）。把下文所有 `<dataDir>` 替换成该路径再操作；若找不到，用 `bash` 执行 `echo $TIANSHU_DATA_DIR` 或 `cd` 到激活返回中的数据目录确认。
> 出厂底稿：`<dataDir>/builtin/` 下有 content 的只读镜像（含 `providers` 预设），可作参考；但 Provider 的实际读写**始终用** `<dataDir>/providers.json`（用户层），不要改镜像。

## 数据结构

数组元素形如：

```json
{
  "id": "openai",
  "name": "OpenAI",
  "base_url": "https://api.openai.com/v1",
  "api_key": "sk-...",
  "models": [{ "id": "gpt-4o", "name": "gpt-4o" }],
  "api_style": "auto"
}
```

可选：`api_style`（`auto`/`chat_completions`/`responses`）、`preset_id`、`is_builtin`、`envKey`、`has_api_key`。

## 操作

1. **列出**：`read <dataDir>/providers.json`，先看已有 `id`，避免重复。
2. **新建/修改**：用 `edit`/`write` 改该数组，新增或更新元素；`id` 保持唯一。
3. **删除**：从数组移除该元素；删除前确认没有角色/会话仍引用它。
4. **模型列表**：改某个 Provider 的 `models` 数组（`{id, name}`）。
5. **验证**：`read` 确认写回正确；新建测试会话验证模型请求与用量。

## 注意

- **绝不回显完整 `api_key`**：读取/输出只显示掩码（如 `sk-****abcd`）。原文保留在文件里，但不要打印进模型可见的输出/会话。
- 改完若未生效，确认 `base_url`/`api_style` 正确；必要时重启会话/服务加载配置。
