---
name: lowcode-device
description: >
  低代码平台的设备创建与管理。涵盖7种设备协议。
  各协议的连接参数见 schema，此 skill 只描述 schema 以外的规则。
version: 1.1.0
tags: [低代码, 设备, 硬件, 协议]
author: Yi-Lin
license: MIT
platforms: [windows, linux, macos]
metadata:
  yilin:
    tags: [low-code, device, hardware, protocol]
    related_skills: [lowcode-variable, lowcode-flow]
    prerequisites: [lowcode-designer]
    conflicts_with: []
---

# 设备创建

## 何时使用

- 用户说"加个设备"、"连PLC"、"配置串口"
- designer skill 执行阶段分配到 device 相关的 task
- 创建 flow 时引用了不存在的 deviceId

## 输出方式

```bash
Get-Content tmp_device.json | node agent/scripts/lowcode-tools.js create-device <projectId> -
```

## 设备结构（通用）

所有协议继承自 `device_base.json`：

```json
{
  "name": "中文名称",
  "protocol": "modbus_tcp",
  "description": "用途说明",
  "enabled": true,
  "connection": {},
  "variables": []
}
```

必填字段：`id`（自动生成）、`name`、`protocol`

## 协议查询

每种协议的 connection 参数和 variable 格式定义在 schema 中，创建前**按需读取**：

```
agent/inputs/schema/devices/
├── device_base.json           (通用字段定义)
├── modbus_tcp.json
├── modbus_rtu.json
├── modbus_tcp_server.json
├── tcp.json
├── http.json
├── mqtt.json
└── ttl.json
```

读取方法：`Read agent/inputs/schema/devices/{protocol}.json`
重点关注：`required`（必填连接字段）、`properties.connection.properties`、`properties.variables`

## 变量配置

设备级别的变量定义，flow 中通过 `variableName` 引用。

| 字段 | 说明 | 示例 |
|---|---|---|
| name | 变量名（英文 camelCase 或 SCREAMING_SNAKE_CASE） | `sensor_val` |
| address | 寄存器地址 | 十进制 `40001` 或十六进制 `0x10` |
| dataType | 数据类型 | `INT16`, `uint16`, `FLOAT32`, `STRING`, `coil` |
| registerCount | 寄存器数 | 1(标量), 2(FLOAT32), 10+(STRING) |
| description | 中文描述 | |

### 数据类型约定

| dataType | registerCount | 说明 |
|---|---|---|
| INT16 / uint16 | 1 | 标志位、状态、命令 |
| FLOAT / FLOAT32 | 2 | 测量值 |
| STRING | 10-50 | 编码、序列号 |
| coil | 1 | 继电器/线圈（仅 modbus_tcp） |

### 地址约定

- 保持寄存器：`40001` 或裸数字 `100`
- 线圈：`00001` 或裸数字 `1`
- 串口：十六进制 `0x01`

## 命名规范

- 设备名：中文（如"PLC控制器"、"串口设备"）
- 变量名：英文 camelCase 或 SCREAMING_SNAKE_CASE

## 输入检查

创建前用 `get-project` 检查已有设备名，避免重复。如果用户未指定协议，根据描述推断：
- "PLC"、"MODBUS"、"以太网" → modbus_tcp
- "串口"、"RS232"、"RS485" → 判断 modbus_rtu 还是 ttl
- "API"、"HTTP" → http
