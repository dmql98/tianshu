---
name: lowcode-flow
description: >
  低代码平台的流程创建。用于添加、修改或调试自动化流程。
  节点配置参数在 schema 中，此 skill 只描述 schema 没有的规则。
version: 1.1.0
tags: [低代码, 流程, 自动化]
author: Yi-Lin
license: MIT
platforms: [windows, linux, macos]
metadata:
  yilin:
    tags: [low-code, flow, automation, workflow]
    related_skills: [lowcode-frontend, lowcode-analyze]
    prerequisites: [lowcode-variable, lowcode-device]
    conflicts_with: []
---

# 流程创建

## 何时使用

- 用户说"创建流程"、"做自动测试"、"写个判断逻辑"
- designer skill 的执行阶段分配到 flow 相关的 task

## 输出方式

```bash
Get-Content tmp_flow.json | node agent/scripts/lowcode-tools.js create-flow <projectId> -
```

## 流程结构

```json
{
  "id": "short-kebab-case-id",
  "name": "中文名称",
  "description": "中文描述",
  "loop": false,
  "enabled": true,
  "nodes": [
    { "seq": 1, "nodeId": "start", "name": "开始",
      "config": {}, "connection": { "normal": 2 }, "connectionCount": 1,
      "outputs": {}, "x": 180.0, "y": 120.0 }
  ]
}
```

### 核心规则

1. `seq` 从 1 开始递增，每个节点占一个序号
2. 第一个节点必须是 `nodeId: "start"`
3. 至少 2 个节点（start + 至少一个操作节点）
4. `connection` 映射子节点的 **seq**（不是索引），`connectionCount` 必须与 connection 中的键数一致
5. 线性节点 `connection: { "normal": nextSeq }`
6. condition 节点 `connection: { "true": seq, "false": seq }`
7. 末端节点 `connection: {}`, `connectionCount: 0`
8. 设备节点的 `deviceId` 引用项目中已创建的设备 ID
9. call_flow/trigger_flow 的 `targetFlowId` 引用项目中已有的流程 ID

## 节点功能一览

按需选型，选中后去 schema 查具体参数。

| 类别 | nodeId | 用途 | 连接方式 |
|---|---|---|---|
| 通用 | start | 流程起点，每个流程第一个节点 | `normal` |
| 通用 | condition | 条件分支，根据表达式走 true/false 两条路 | `true`, `false` |
| 通用 | delay | 等待指定时间后继续 | `normal` |
| 通用 | compute | 算术运算，支持精度控制 | `normal` |
| 通用 | value_bind | 修改全局变量 `${global:var}=val` | `normal`（无输出） |
| 通用 | http_request | 发送 HTTP 请求，支持重试/超时/自定义 header | `normal` |
| 通用 | json_query | 用 JSONPath 从 JSON 中提取值 | `normal` |
| 通用 | string_substring | 截取字符串的指定部分 | `normal` |
| 通用 | string_clean | 替换/删除字符串中的指定字符 | `normal` |
| 通用 | mock_value | 生成模拟数据（随机数/固定值），用于测试 | `normal` |
| 通用 | image_read | 图像识别（OCR/模板匹配/条码） | `normal` |
| 设备 | modbus_tcp_read | 通过 Modbus TCP 读设备寄存器 | `normal` |
| 设备 | modbus_tcp_write | 通过 Modbus TCP 写设备寄存器 | `normal` |
| 设备 | ttl_read | 从 TTL 串口读数据 | `normal` |
| 设备 | ttl_write | 向 TTL 串口写指令 | `normal` |
| 设备 | tcp_read | 从 TCP 设备读数据 | `normal` |
| 设备 | tcp_write | 向 TCP 设备写数据 | `normal` |
| 流程 | call_flow | 同步调用子流程，等待完成后继续 | `normal` |
| 流程 | trigger_flow | 异步触发另一个流程，不等待 | `normal` |

## 节点参数查询

每种节点的 config 参数定义在 schema 中。根据 nodeId 按需读取：

```
agent/inputs/schema/nodes/{category}/{type}.json
```

重点关注：`required`（必填字段）、`properties.config.properties`、`properties.outputs`

## 布局规则

画布坐标系统：起点 (0,0) 左上，单位 px。

- **线性链**：从 180,120 开始，每个节点 Y 递增 120px
- **条件分支**：true 分支向上/左（Y 减 105），false 分支向下/右（Y 增 105）
- **回环**：delay 节点置于分支末端，X 偏移 -90，连接回之前某个 seq
- **子流程 call_flow**：置于条件分支末端，X 偏移 +165

## 表达式语法

| 引用目标 | 格式 | 示例 |
|---|---|---|
| 节点输出 | `${flowId:nodeSeq:varName}` | `${main_flow:5:out1}` |
| 全局变量 | `${global:变量ID}` | `${global:status}` |
| value_bind 赋值 | `${global:变量ID}=值`（等号两侧无空格） | `${global:result}=pass` |
| 字符串方法 | `.split(",")`, `.toDouble()`, `.isEmpty()`, `.length` | |
| 数学函数 | `Math.abs()` | |
| 逻辑运算符 | `==`, `!=`, `>`, `<`, `>=`, `<=`, `and`, `or`, `nand`, `nor` | |

## 常见流程模式

### 轮询等待
```
start → modbus_tcp_read → condition(==?) → [true] → 后续
                                         → [false] → delay → 回到读取
```

### 读→判→记
```
start → modbus_tcp_read → condition(阈值) → [true] → value_bind(赋值A)
                                          → [false] → value_bind(赋值B)
```

### 子流程拆分
```
父流程: start → call_flow(子任务A) → call_flow(子任务B) → ...
子流程ID命名: parentId__purpose__branch
```

## 输入检查

创建前用 `get-project <projectId>` 检查设备/变量/流程是否存在，确保引用有效。

## 修改现有流程

`create-flow` 执行 upsert，ID 相同则覆盖。先 `get-project` 获取当前数据，改 nodes 后重新写入。
