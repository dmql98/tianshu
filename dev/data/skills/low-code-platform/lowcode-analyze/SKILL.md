---
name: lowcode-analyze
description: >
  低代码平台的项目分析和诊断。
  用于检查项目完整性、查找引用断裂、发现配置不一致、
  优化流程结构、生成改进建议。
version: 1.1.0
tags: [低代码, 诊断, 分析]
author: Yi-Lin
license: MIT
platforms: [windows, linux, macos]
metadata:
  yilin:
    tags: [low-code, analysis, diagnostics, audit]
    related_skills: [lowcode-designer]
    prerequisites: [lowcode-overview]
    conflicts_with: []
---

# 项目分析

## 何时使用

- 用户说"检查项目"、"有什么问题"、"帮我看看这个项目"
- designer skill 执行阶段出现错误（如实体创建失败）
- 流程测试失败，怀疑配置有误

## 如何获取数据

```bash
# 获取完整项目状态
node agent/scripts/lowcode-tools.js get-project <projectId>
```

输出包含：项目配置、设备列表、流程列表、前端页面列表、变量列表。

## 分析检查清单

### 1. 引用完整性

检查每个实体的交叉引用是否有效：

- **流程节点中的 deviceId** → 必须存在于设备列表
- **value_bind 的 ${global:xxx}** → 必须存在于变量列表
- **call_flow/trigger_flow 的 targetFlowId** → 必须存在于流程列表
- **前端 bindVar** → 必须存在于变量列表
- **前端 actions.flowId** → 必须存在于流程列表

### 2. 流程结构

- 每个流程的 nodes 是否以 start 开头（seq=1, nodeId=start）
- seq 是否连续递增（1,2,3…）
- connection 引用的是否都是有效的 seq
- condition 节点是否有 true/false 两个分支
- 末端节点 connection 是否为空
- delay 节点是否有 duration + unit

### 3. 常见问题模式

| 问题 | 检查方式 | 严重程度 |
|---|---|---|
| 变量定义了但没被任何 flow 引用 | 搜索所有 flow JSON 中的 `${global:varName}` | 低 |
| 流程创建了但没有被任何页面按钮触发 | 检查 frontend actions.flowId | 低 |
| 设备变量被 flow 引用但设备中未定义 | flow 的 config.variableName vs 设备 variables[].name | 高 |
| 流程引用了不存在的变量名 | ${flowId:seq:name} 的 name 在对应节点 outputs 中不存在 | 高 |
| 条件表达式语法错误 | 检查 `${...}` 格式和运算符拼写 | 高 |

### 4. 命名一致性

- 设备名 → 中文，变量名 → 英文 snake_case
- 同项目的变量名风格是否统一
- 流程 ID 是否简短可读

## 输出格式

以文本形式报告分析结果，列出：
1. 项目概览（实体数量）
2. 发现的问题（按严重程度排序）
3. 改进建议（可选）
