---
name: lowcode-frontend
description: >
  低代码平台的前端页面创建。
  用于添加监控面板、参数配置页、数据显示界面。
  组件 props 定义在 schema 中，此 skill 只描述绑定和布局规则。
version: 1.1.0
tags: [低代码, 前端, 页面, UI]
author: Yi-Lin
license: MIT
platforms: [windows, linux, macos]
metadata:
  yilin:
    tags: [low-code, frontend, page, ui, dashboard]
    related_skills: [lowcode-analyze]
    prerequisites: [lowcode-flow, lowcode-variable]
    conflicts_with: []
---

# 前端页面创建

## 何时使用

- 用户说"加个页面"、"做个监控"、"配个界面"
- designer skill 执行阶段分配到 frontend 相关的 task

## 输出方式

```bash
Get-Content tmp_page.json | node agent/scripts/lowcode-tools.js create-frontend <projectId> -
```

## 页面结构

```json
{
  "id": "page_id",
  "name": "中文名称",
  "description": "用途说明",
  "width": 1920,
  "height": 1080,
  "backgroundColor": "#f5f7fb",
  "components": [
    {
      "id": "comp_1",
      "type": "label",
      "x": 24, "y": 24,
      "width": 200, "height": 72,
      "zIndex": 1,
      "props": { "text": "状态" },
      "style": {},
      "visible": true,
      "condition": "",
      "bindType": "variable",
      "bindVar": "run_state",
      "actionType": "none",
      "actions": { "actionType": "none", "flowId": "", "varName": "", "varValue": "" }
    }
  ]
}
```

## 组件功能一览

按需选型，选中后去 schema 查具体 props。

| 类别 | type | 用途 | canBind |
|---|---|---|---|
| basic | label | 静态文字显示，支持固定文本或表达式 | 否 |
| basic | button | 可点击按钮，通常绑定流程触发 | 否 |
| basic | divider | 分割线（水平/垂直） | 否 |
| basic | icon | 图标显示 | 否 |
| basic | image | 图片显示 | 否 |
| basic | link | 超链接 | 否 |
| basic | color-block | 色块，用于状态指示 | 否 |
| input | input | 单行文本输入框 | 是 |
| input | number-input | 数字输入框，支持 min/max/step | 是 |
| input | switch | 开关切换 | 是 |
| input | slider | 滑块拖拽选择数值 | 是 |
| input | select | 下拉单选/多选 | 是 |
| input | radio-group | 单选组 | 是 |
| input | checkbox-group | 多选组 | 是 |
| input | date-picker | 日期/时间选择 | 是 |
| input | time-picker | 时间选择 | 是 |
| input | color-picker | 颜色选择 | 是 |
| input | rate | 评分选择 | 是 |
| input | rich-text | 富文本编辑 | 是 |
| input | upload | 文件上传 | 否 |
| display | indicator | 状态指示灯（success/warning/danger） | 是 |
| display | stat-card | 统计卡片，显示数值+趋势 | 是 |
| display | data-table | 数据表格（带排序/筛选） | 否 |
| display | table | 简单表格 | 否 |
| display | special-table | 特殊格式表格 | 否 |
| display | avatar | 头像 | 否 |
| display | list | 列表展示 | 否 |
| display | tag-group | 标签组 | 否 |
| display | tree | 树形数据展示 | 否 |
| display | calendar | 日历 | 否 |
| display | empty | 空状态占位 | 否 |
| display | loading | 加载中动画 | 否 |
| display | marquee | 跑马灯滚动文字 | 否 |
| chart | chart | 图表（折线/柱状/饼图），支持多系列 | 否 |
| chart | table | 表格（带斑马纹/边框/序号） | 否 |
| media | text | 文本展示块 | 否 |
| industrial | indicator | 工业指示灯（同 display/indicator） | 是 |

## 组件参数查询

每种组件的 props 定义在 schema 中。根据 type 按需读取：

```
agent/inputs/schema/frontends/{type}.json
```

重点关注：`category`、`canBind`、`props.properties`、`rules`、`defaultSize`

## 数据绑定

### 绑定到变量（bindType=variable）

```json
{ "bindType": "variable", "bindVar": "run_state" }
```
`bindVar` 引用项目中的变量名。仅 `canBind: true` 的组件支持。

### 绑定到流程（actionType=flow）

```json
{ "actionType": "flow", "actions": { "actionType": "flow", "flowId": "main_flow", "varName": "", "varValue": "" } }
```
按钮点击触发流程，`flowId` 引用项目中的流程 ID。

### 条件显示

```json
{ "visible": true, "condition": "${global:status} == running" }
```

## 布局规则

画布 1920x1080，坐标原点左上角。

- **标题/状态区**：y=24
- **左侧面板**：x=24，组件 Y 间距 72px
- **标签+输入对**：x=24（标签）+ x=344（输入框）
- **按钮**：功能区域，常用尺寸 160x48

## 修改现有页面

`create-frontend` 执行 upsert，ID 相同则覆盖。
