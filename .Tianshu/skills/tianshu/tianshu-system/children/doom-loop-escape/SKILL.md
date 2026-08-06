---
name: doom-loop-escape
description: "结构化自愈协议：识别工具失败的 Doom Loop，诊断根因，切换策略逃逸"
---

# Doom Loop Escape — 工具失败自愈协议

## 目标

当 agent 连续两次以上使用同一类工具均失败时，不要重复尝试同类方案。**立即启动本协议**，在 2 轮内切换策略逃逸，而非重复撞墙。

## 核心原则

> **"用同样的工具做同样的事，期待不同结果，是疯狂。"**

失败 1 次 → 重试（换参数/换目标）
失败 2 次 → **换工具类别**（不是换参数！）
失败 3 次 → **诊断根因 + 换策略**

## 步骤

### Step 1：识别 Doom Loop

检查最近 3 条工具调用。如果满足以下任一条件，进入 Step 2：

| 条件 | 示例 |
|------|------|
| 同一工具连续失败 ≥ 2 次 | `websearch` 失败 × 2 |
| 同一类工具连续失败 ≥ 2 次 | `websearch failed` → `webfetch failed`（都是网络类） |
| 系统弹出了 Doom Loop 警报 | System Alert 明确提示 |

### Step 2：根因诊断（30 秒）

执行以下操作之一来定位问题层级：

```powershell
# 检查网络连通性
ping -n 1 8.8.8.8 2>$null; if ($?) { ping -n 1 223.5.5.5 2>$null }

# 检查 DNS
nslookup github.com 2>$null; if ($?) { Write-Output "DNS 可能异常" }

# 检查工具是否可用
where curl, wget 2>$null
```

如果 `bash` 不可用（当前角色无 bash 权限），则通过以下逻辑推断：

- **所有外部网络调用均失败** → 大概率是网络隔离 / 沙箱限制
- **部分成功部分失败** → 可能是目标站点封禁或限流
- **工具根本不存在** → 角色工具白名单问题

### Step 3：按根因选择逃逸策略

#### 场景 A：网络不可达 / 沙箱无外网

```
停止依赖外部数据源的任务。
转向：
  - 读取本地已有的数据文件（read / glob）
  - 利用 workspace 内的缓存
  - 告知用户"当前环境无网络，建议离线操作"
```

#### 场景 B：特定站点被封

```
换一类数据源（不要只是换域名）：
  - 如果是抓网页失败 → 改找 RSS / API / 聚合站
  - 如果是搜索引擎失败 → 改直接访问已知站点
  - 如果是国际站失败 → 改国内镜像或替代源
```

#### 场景 C：工具不可用 / 权限不足

```
列出所有可用工具（看看角色有哪些可用能力）：
  - 有 bash → 用 curl / wget / python 替代
  - 有 read → 读本地配置文件/缓存
  - 有其他 MCP 工具 → 看看是否能间接完成
```

#### 场景 D：孤立故障（偶发失败）

```
退避重试：
  - 等待 2 秒后重试
  - 换更简单的请求（减少 payload）
  - 拆成更小的子任务
```

### Step 4：执行逃逸

选择一个与之前**完全不同类别**的工具或方法：

```
X 错误模式：websearch 失败 → 换另一个 websearch 查询  ✗
X 错误模式：webfetch siteA 失败 → webfetch siteB     ✗
✓ 正确模式：websearch 失败 → bash curl API 接口       ✓
✓ 正确模式：webfetch 失败 → 读本地缓存数据             ✓
✓ 正确模式：所有网络失败 → 告知用户并调整任务范围       ✓
```

### Step 5：记录与上报

逃逸成功后，记录：

```yaml
doom_loop_log:
  failed_tools: [websearch, webfetch]
  root_cause: network_unreachable
  escape_strategy: switched_to_local_fallback
  result: partial_success
```

如果所有策略均失败，**明确告知用户**当前环境限制，并提供替代建议，**不要硬编造结果**。

## 示例

### 示例 1：新闻聚合任务（对应实际 session）

```
用户：整理今日新闻
Agent 执行 websearch → fetch failed
Agent 重试 websearch（不同 query）→ fetch failed
→ 检测到 Doom Loop（同一工具类连续失败 2 次）
→ Step 2：bash ping → ping 失败，确认无外网
→ Step 3：选择策略 A（网络不可达）
→ 执行：告知用户"当前环境无网络，无法获取实时新闻"
   并建议："我可以读取本地缓存的新闻模板或帮你准备离线内容"
```

### 示例 2：代码仓库操作

```
用户：更新依赖
Agent 执行 npm install → 连接超时
Agent 重试 npm install → 连接超时
→ 检测到 Doom Loop
→ Step 2：探测 registry 连通性
→ Step 3：选择策略 C（换工具）
→ 执行：切换 yarn / pnpm 或设置国内镜像源
```

## 约束

- 最多允许同一工具类连续失败 **2 次**，第 3 次必须触发本协议
- 禁止在失败后仅修改参数/查询词就重试（除非第一次是参数错误）
- 逃逸后必须记录日志，便于后续改进
- 如果所有策略都失败，必须诚实告知用户，不得捏造数据
