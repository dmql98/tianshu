---
name: lowcode-overview
description: >
  低代码平台的总体介绍。说明平台的核心概念、实体模型和工作流程。
  其他 skill 的基础上下文。首次接触平台时使用。
version: 1.1.0
tags: [低代码, IoT, 平台介绍]
author: Yi-Lin
license: MIT
platforms: [windows, linux, macos]
metadata:
  yilin:
    tags: [low-code, overview, introduction]
    related_skills: [lowcode-designer]
    prerequisites: []
    conflicts_with: []
---

# 低代码平台概述

## 这是什么

IoT 低代码开发平台，通过可视化编排取代手写代码。用户通过拖拽节点构建自动化流程、配置硬件设备、定义数据变量、生成监控页面。

## 核心工作流

```
┌──────────┐    ┌──────────┐    ┌────────────┐    ┌──────────┐
│ 需求分析  │ → │ 生成蓝图  │ → │ 逐项创建实体 │ → │ 项目完成  │
│ (问用户)  │    │ (设计文档) │    │ (按需逐步做) │    │ (可运行)  │
└──────────┘    └──────────┘    └────────────┘    └──────────┘
```

1. **需求分析** — 问用户项目做什么、有哪些硬件、要什么逻辑
2. **生成蓝图** — 产出一份结构化设计文档，记录所有决策
3. **逐项创建** — 按蓝图逐步创建实体，每步用户确认
4. **项目完成** — 全部实体就绪即可运行

## 实体模型（4类）

| 实体 | 作用 | 举例 |
|---|---|---|
| **设备** | 连接真实硬件，定义通讯协议和寄存器 | PLC、串口传感器、摄像头、HTTP API |
| **变量** | 全局数据点，设备和页面之间的共享状态 | 温度值、开关状态、累计计数 |
| **流程** | 自动化逻辑，编排节点实现数据采集/判断/控制 | 轮询、条件分支、子流程调用 |
| **页面** | 前端可视化界面，绑定变量展示数据 | 监控面板、参数配置页 |

## 数据流

```
设备寄存器 → 流程(读/写) → 全局变量 → 前端页面(绑定显示)
    ↑                                      ↓
    └──────── 流程(写控制指令) ←───────────┘
```

- **设备**通过 flow 中的读写节点（modbus_tcp_read/write 等）交互
- **流程**通过 value_bind 节点修改**全局变量**
- **页面**通过 bindVar 绑定**全局变量**显示数据
- **页面**上的按钮通过 actionType=flow 触发**流程**

## 可用 Skill

| skill | 用途 |
|---|---|
| lowcode-designer | 项目设计+执行管理 |
| lowcode-device | 创建设备 |
| lowcode-variable | 创建变量 |
| lowcode-flow | 创建流程 |
| lowcode-frontend | 创建页面 |
| lowcode-analyze | 项目诊断 |

各 skill 的关联关系和前置条件见 `skill_manager list` 或各 skill 的 `metadata.yilin`。

## 项目配置

- 低代码平台项目根路径：`<lowcode-root>`（需设置 `lowcode_root` 变量，示例：`C:\Users\dmql\Documents\low-code-platform`）
- 所有命令均从项目根路径执行
- 数据目录：`backend/data/projects/`
- 蓝图路径：`backend/data/projects/{projectId}/blueprints/bp_*.md`
- 计划路径：`backend/data/projects/{projectId}/_plan.md`
