---
name: tianshu-provider-management
description: "使用 provider_manager 配置、检查和维护 TianShu 的 OpenAI 兼容模型服务及模型列表。"
---

# 模型服务管理

不要直接编辑 `providers.json`。使用 `provider_manager` 完成所有配置变更。

## 工作流

1. `list` 查看现有 Provider 和模型。
2. `read` 检查目标 Provider，避免重复 ID。
3. `create` 或 `update` 设置显示名称、`base_url`、API Key 和模型 ID。
4. 配置完成后，用 `character_manager update` 的 `provider` 和 `model` 字段为角色指定服务与模型。
5. 新建测试会话，验证模型请求和用量统计。

不要在输出中回显完整 API Key。删除 Provider 前检查角色和现有会话是否引用它。
