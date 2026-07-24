---
name: lowcode-variable
description: >
  低代码平台的全局变量管理。
  用于定义运行状态、测量数据、配置参数等全局数据点。
  变量作为设备→流程→页面的共享状态层。
version: 1.1.0
tags: [低代码, 变量, 数据]
author: Yi-Lin
license: MIT
platforms: [windows, linux, macos]
metadata:
  yilin:
    tags: [low-code, variable, data, state]
    related_skills: [lowcode-flow, lowcode-frontend]
    prerequisites: [lowcode-designer]
    conflicts_with: []
---

# 变量创建

## 何时使用

- 用户说"加个变量"、"记录结果"、"定义参数"
- designer skill 执行阶段分配到 variable 相关的 task
- 创建 flow 时引用了不存在的全局变量（${global:xxx}）

## 输出方式

```bash
Get-Content tmp_var.json | node agent/scripts/lowcode-tools.js create-variable <projectId> -
```

## 变量结构

```json
{
  "name": "status",
  "dataType": "string",
  "defaultValue": "idle",
  "currentValue": "idle",
  "description": "系统运行状态",
  "enabled": true,
  "editable": true
}
```

## 数据类型

| 规范类型 | 别名（自动映射） | 示例默认值 |
|---|---|---|
| string | str, text, vstring | `""`, `"idle"`, `"init"` |
| float | number, num, float32, float64, double, decimal | `0.0` |
| integer | int, int16, int32, int64, long | `0` |
| boolean | bool | `false` |
| json | object, dict | `{}` |

## 命名规范

- 变量名使用英文 **snake_case**
- 与设备寄存器同名的变量应一致（如设备有 `sensor_a`，变量也用 `sensor_a`）
- 用途后缀约定：
  - `_val` — 测量值（sensor_val, raw_value）
  - `_str` — 字符串标识（device_id, serial_no）
  - `_state` / `_status` — 状态（run_state, conn_status）
  - `_count` — 计数（total_count, error_count）
  - `_rate` — 比率（success_rate）

## 常见变量模式

| 用途 | name | dataType | defaultValue |
|---|---|---|---|---|
| 运行状态 | run_state | string | idle |
| 测量数据 | sensor_val | float | 0.0 |
| 累计计数 | total_count | integer | 0 |
| 错误计数 | error_count | integer | 0 |
| 成功比率 | success_rate | float | 0.0 |
| 设备标识 | device_id | string | "" |
| 序列号 | serial_no | string | "" |
| 配置参数 | config_val | float | 0.0 |
| 状态标记 | status_flag | string | init |

## 数据流中的角色

```
设备寄存器 → Flow（读/写） → 全局变量 → 前端页面（bindVar）
```

- 变量是设备数据和前端显示的**中间层**
- Flow 通过 value_bind 节点修改变量：`${global:test_result}=OK`
- 前端通过 bindVar 引用变量进行显示/编辑
- 不是所有设备寄存器都需要对应变量（某些被 flow 直接消费）
- 不是所有变量都来自设备（业务参数变量是独立的）

## 输入检查

创建前用 `get-project` 检查已有变量名，避免重复。
