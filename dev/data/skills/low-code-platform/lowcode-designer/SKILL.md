---
name: lowcode-designer
description: >
  低代码平台的项目设计与进度管理。
  在空项目、新项目或项目有未完成任务时使用。
  引导需求分析→生成蓝图→展示确认→创建执行计划→按阶段推进。
  也用于检查项目状态并恢复执行。
version: 1.1.0
tags: [低代码, 项目管理, 设计]
author: Yi-Lin
license: MIT
platforms: [windows, linux, macos]
metadata:
  yilin:
    tags: [low-code, design, planning, project-management]
    related_skills: [lowcode-device, lowcode-variable, lowcode-flow]
    prerequisites: [lowcode-overview]
    conflicts_with: []
---

# 项目设计与执行管理

## 何时使用

- 用户说"新建项目"、"搭一个系统"、"做一个测试项目"
- 项目目录下没有 `_plan.md` → 需要设计
- 有 `_plan.md` 但还有未完成的任务 → 需要继续推进

## 第一步：检查项目状态

使用 `node agent/scripts/lowcode-tools.js list-projects` 列出所有项目。

### 无项目

问用户项目名称和用途，然后初始化：

```bash
node agent/scripts/lowcode-tools.js create-project "项目名称" "项目描述"
```

这会自动创建项目目录、project.json、flows_index.json、config.json。返回项目 ID。

然后进入设计模式。

### 已有项目

列出项目让用户选择。检查选中项目下是否有 `_plan.md`：
- 有 → 执行模式
- 没有 → 进入设计模式

## 第二步：设计模式

### 引导需求

问用户：
1. 项目要做什么（设备监控、产线测试、数据采集、远程控制…）？
2. 涉及哪些硬件设备（PLC、传感器、串口设备、摄像头…）？
3. 需要哪些自动化逻辑（轮询、条件判断、报警触发…）？
4. 是否需要监控页面？

### 生成蓝图

用 write 创建 `backend/data/projects/{projectId}/blueprints/bp_{ts}.md`：

```markdown
# {项目名称} - 设计蓝图

## 1. 设计决策

{需求分析、技术选型理由}

## 2. 系统架构图

{ASCII 图展示设备→流程→页面关系}

## 3. 实体总览

{所有需要创建的实体清单}

## 4. 设备清单

{每台设备的协议、连接参数、寄存器变量}

## 5. 变量定义表

{全局变量名称、类型、默认值、用途}

## 6. 流程定义

{每个流程的节点序列和关键逻辑}

## 7. 页面布局

{页面结构、组件排布、数据绑定}

## 8. 数据流总表

{数据从设备到流程到变量的完整流向}

## 9. 风险与注意事项

{注意事项清单}
```

蓝图12章：
1. **设计决策** — 需求分析、技术选型理由
2. **系统架构图** — ASCII 图展示设备→流程→页面关系
3. **实体总览** — 所有需要创建的实体清单
4. **设备清单** — 每台设备的协议、连接参数、寄存器变量
5. **变量定义表** — 全局变量名称、类型、默认值、用途
6. **流程定义** — 每个流程的节点序列和关键逻辑
7. **页面布局** — 页面结构、组件排布、数据绑定
8. **数据流总表** — 数据从设备到流程到变量的完整流向
9. **风险与注意事项**
10. **变量引用溯源** — 自动分析，追踪每个变量被哪些流程/页面引用
11. **流程逻辑摘要** — 自动分析，将节点配置翻译为自然语言描述
12. **配置校验** — 自动检查，标记缺失引用、未定义变量、冗余实体

### 三阶段蓝图增强

生成蓝图后，运行动态分析追加三章：

```bash
node agent/scripts/blueprint-analyzer.js <projectId> >> backend/data/projects/{projectId}/blueprints/bp_{ts}.md
```

阶段说明：
- **阶段1 — 变量溯源**：扫描所有 flow 节点中的 `${global:xxx}` 引用和 frontend 组件的 `bindVar`，生成变量→使用方反向映射表，覆盖章节 10
- **阶段2 — 逻辑可读性**：按 nodeId 翻译每个 flow 节点，将 `${flowId:seq:output}` 展开为节点名称，条件表达式译为人话，覆盖章节 11
- **阶段3 — 配置校验**：交叉检查 deviceId、targetFlowId、全局变量引用是否有效，标记已定义未使用的冗余变量，覆盖章节 12

### 展示完整蓝图

用 read 读取完整蓝图文件（含追加的 10-12 章），完整展示给用户。

⛔ **设计阶段硬停止** — 以下规则必须遵守：
- 绝对不要继续创建 `_plan.md`
- 绝对不要开始创建任何实体
- 绝对不要在展示后直接追加"接下来做什么"之类的问题
- 只需要展示蓝图，然后等待用户主动回复

用户确认格式必须是：**用户说"确认"或"可以"或"继续"** 之后，才能进入执行阶段。

## 第三步：创建执行计划

⚠️ **只有用户确认蓝图后，才能执行这一步。**

用 write 创建 `backend/data/projects/{projectId}/_plan.md`，只写第一个 task：

```markdown
# 项目执行计划

项目ID: {projectId}
状态: 进行中
蓝图: bp_{timestamp}

## 任务

- [x] 需求分析与蓝图设计 `→ bp_{timestamp}`
```

后续 task 在执行过程中**逐渐追加**。每完成一个 task，问用户"接下来做什么"，根据回答追加新的 task 并执行。

告知用户：说明目前只规划了需求设计这一步，后续根据开发进展逐步添加任务。
引导用户："需要现在开始第一步吗？接下来你想做什么？"

## 第四步：执行模式

### 读取计划

用 read 读取 `_plan.md`，找到第一个 `- [ ]` 的 task。

### 告知进度

"已完成前序任务。下一个是：{task}。要继续吗？"

### 执行任务

根据 task 描述判断实体类型，加载对应 skill：
- 设备相关 → lowcode-device
- 流程相关 → lowcode-flow
- 页面相关 → lowcode-frontend
- 变量相关 → lowcode-variable

实体创建后，用 edit 更新 `_plan.md`：
- 该 task 的 `[ ]` 改为 `[x]`，追加 `→ entityId`

### 继续或停止

执行完后问用户接下来做什么。根据回答抓取意图，追加新的 task 到 `_plan.md` 末尾，然后执行。

例如：
- 用户说"加个PLC设备" → 追加 `- [ ] 创建PLC设备` → 执行(lowcode-device)
- 用户说"做个读取流程" → 追加 `- [ ] 创建数据采集流程` → 执行(lowcode-flow)  
- 用户说"先不管了" → 停止
- 用户说"帮我看看还有什么需要做的" → 读蓝图中的实体总览，对比已创建的实体，列出缺失项让用户选择

## 使用建议

- 计划不是死板的，用户随时可以要求调整顺序、跳过或新增 task
- 用户说跳过某个 task → 加 `(已跳过)` 标记
- 任何时候重新打开项目，读 `_plan.md` 就能恢复进度
- 项目不需要 config.json 里的配置列表也能正常生成——空数组表示全部允许

## 通用工具

所有实体操作通过 `agent/scripts/lowcode-tools.js` 完成：

```bash
# 查询项目状态
node agent/scripts/lowcode-tools.js get-project <projectId>

# 创建实体（通过管道传 JSON）
# 1. 构建 JSON 写入临时文件（避免 PowerShell 转义问题）
# 2. 用管道传给工具：
Get-Content path\to\data.json | node agent/scripts/lowcode-tools.js create-flow <projectId> -

# 删除实体
node agent/scripts/lowcode-tools.js delete-entity <projectId> <type> <id>
```

工具自动处理：ID 生成、时间戳、索引更新、数据校验、缺省补齐。
