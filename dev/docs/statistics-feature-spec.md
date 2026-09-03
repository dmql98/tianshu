# 天枢 Token 用量统计与费用计算 — 需求规格

## 一、功能概述

为天枢增加全局 Token 用量统计与费用计算能力：
- 统计所有 LLM 调用的 token 用量（输入/输出/缓存命中/缓存未命中）
- 支持按服务商、模型、角色、时间范围筛选
- 计算实际费用（含时段价格：同一模型白天/夜间价格不同）
- 标记免费模型，计算节省金额
- 前端展示汇总卡片、趋势图、分布图、明细表格

---

## 二、数据来源

**不新建 token 统计表**，复用已有的 `llm_calls` 表（每次 LLM 调用一行记录）：

| 字段 | 用途 |
|------|------|
| `llm_calls.session_id` | 关联 sessions 表获取角色/服务商 |
| `llm_calls.request_model` | 模型名，匹配价格规则 |
| `llm_calls.usage_input` | 输入 token 数 |
| `llm_calls.usage_output` | 输出 token 数 |
| `llm_calls.usage_cache_hit` | 缓存命中 token 数 |
| `llm_calls.usage_cache_miss` | 缓存未命中 token 数 |
| `llm_calls.created_at` | 调用时间（epoch ms），取小时匹配时段价格 |
| `sessions.character_id` | 角色 ID |
| `sessions.provider_id` | 服务商 ID |

---

## 三、价格配置

### 3.1 存储位置

价格配置嵌入现有 `providers.json`（通过 `providerStore` 读写），不新建数据库表。

### 3.2 数据结构

#### Provider 级别默认价目表

```typescript
// providerStore.ts → ProviderRecord 新增字段
default_pricing?: {
  currency: 'USD' | 'CNY'
  hourly_prices: HourlyPrice[]  // 24 小时，每小时一条
}
```

#### Model 级别价目表

```typescript
// providerStore.ts → ModelInfo 新增字段
pricing?: {
  is_free?: boolean              // 免费标记
  currency?: 'USD' | 'CNY'       // 缺省回退 provider 级
  hourly_prices?: HourlyPrice[]   // 缺省回退 provider 级
  ref_hourly_prices?: HourlyPrice[]  // 免费模型的等效参考价（算节省用）
}
```

#### HourlyPrice 结构

```typescript
interface HourlyPrice {
  hour: number       // 0-23
  input: number      // 分/1M tokens（如 $2.50/1M → 250）
  output: number     // 分/1M tokens
  cache_hit: number  // 分/1M tokens
  cache_miss: number // 分/1M tokens
}
```

### 3.3 价格匹配优先级

对于每次 LLM 调用，按以下顺序匹配价格：

```
1. provider + model 级 pricing.hourly_prices 存在 → 用它
2. provider 级 default_pricing.hourly_prices 存在 → 用它
3. 都没有 → 免费（费用=0，节省按 provider 兜底价估算）
```

### 3.4 费用计算公式

```
对于每次 LLM 调用：
  hour = new Date(created_at).getHours()  // 0-23

  如果 is_free=true:
    实际费用 = 0
    节省 = Σ (token_count[t] × ref_hourly_prices[hour][t] / 1_000_000)
  否则:
    实际费用 = Σ (token_count[t] × hourly_prices[hour][t] / 1_000_000)
    节省 = 0

  其中 t ∈ {input, output, cache_hit, cache_miss}
```

---

## 四、后端 API

### 4.1 统计 API（`/api/statistics`）

所有端点支持查询参数：
- `from` — 起始时间（epoch ms）
- `to` — 结束时间（epoch ms）
- `model` — 模型名筛选
- `character_id` — 角色 ID 筛选
- `provider_id` — 服务商 ID 筛选

#### GET /api/statistics/overview

全局汇总。

```json
{
  "total_input_tokens": 1234567,
  "total_output_tokens": 567890,
  "total_cache_hit_tokens": 234567,
  "total_cache_miss_tokens": 123456,
  "total_tokens": 1802457,
  "cache_hit_rate": 65.5,
  "total_cost": 1250,
  "total_cost_display": "$12.50",
  "total_savings": 3200,
  "total_savings_display": "$32.00",
  "total_calls": 1542,
  "free_calls": 800,
  "paid_calls": 742
}
```

#### GET /api/statistics/by-model

按模型聚合。

```json
{
  "items": [
    {
      "model": "gpt-4o",
      "provider_id": "openai",
      "total_input_tokens": 500000,
      "total_output_tokens": 200000,
      "total_cache_hit_tokens": 100000,
      "total_cache_miss_tokens": 50000,
      "total_tokens": 800000,
      "total_cost": 3200,
      "total_cost_display": "$32.00",
      "total_savings": 0,
      "call_count": 500,
      "is_free": false
    }
  ]
}
```

#### GET /api/statistics/by-character

按角色聚合。

```json
{
  "items": [
    {
      "character_id": "码仔",
      "total_input_tokens": 800000,
      "total_output_tokens": 300000,
      "total_tokens": 1100000,
      "total_cost": 4500,
      "total_cost_display": "$45.00",
      "call_count": 800
    }
  ]
}
```

#### GET /api/statistics/by-provider

按服务商聚合。

```json
{
  "items": [
    {
      "provider_id": "openai",
      "total_input_tokens": 600000,
      "total_output_tokens": 250000,
      "total_tokens": 850000,
      "total_cost": 3500,
      "total_cost_display": "$35.00",
      "total_savings": 0,
      "call_count": 600
    }
  ]
}
```

#### GET /api/statistics/by-day

按天聚合（趋势数据，用于折线图）。

```json
{
  "items": [
    {
      "date": "2025-01-15",
      "total_input_tokens": 10000,
      "total_output_tokens": 5000,
      "total_tokens": 15000,
      "total_cost": 45,
      "total_savings": 120,
      "call_count": 30
    }
  ]
}
```

#### GET /api/statistics/detail

明细列表，每次 LLM 调用一行，支持分页。

查询参数额外支持：`offset`（默认 0）、`limit`（默认 50，最大 500）

```json
{
  "total": 1542,
  "items": [
    {
      "id": 12345,
      "session_id": "sess_xxx",
      "session_title": "优化前端性能",
      "character_id": "码仔",
      "provider_id": "openai",
      "model": "gpt-4o",
      "usage_input": 5000,
      "usage_output": 2000,
      "usage_cache_hit": 1000,
      "usage_cache_miss": 500,
      "cost": 12,
      "cost_display": "$0.12",
      "savings": 0,
      "currency": "USD",
      "is_free": false,
      "created_at": 1705312800000
    }
  ]
}
```

### 4.2 价格 API（`/api/pricing`）

#### GET /api/pricing

读取所有服务商的价格配置（含 provider 级和 model 级）。

```json
{
  "providers": [
    {
      "provider_id": "openai",
      "provider_name": "OpenAI",
      "currency": "USD",
      "default_pricing": { "hourly_prices": [...] },
      "models": [
        {
          "model_id": "gpt-4o",
          "model_name": "GPT-4o",
          "is_free": false,
          "pricing": { "hourly_prices": [...] },
          "ref_hourly_prices": null
        }
      ]
    }
  ]
}
```

#### PUT /api/pricing

保存价格配置（全量替换）。body 结构同 GET 响应。

---

## 五、前端需求（待 UI 设计）

### 5.1 统计页面 `/statistics`

- 导航栏新增入口
- 筛选栏：时间范围（快捷+自定义）、模型、角色、服务商
- 汇总卡片：输入Token / 输出Token / 总Token / 缓存命中率 / 调用次数 / 实际费用 / 节省金额
- 趋势图：按天 token 用量折线 + 费用柱状
- 分布图：按模型/角色分布饼图
- 明细表格：每次 LLM 调用详情，可排序

### 5.2 价格配置

嵌入现有服务商卡片中，用户可编辑：
- 免费标记勾选
- 按小时价格表格（可批量设置）
- 等效参考价（免费模型用）

---

## 六、实施步骤

1. 扩展 `ProviderRecord` / `ModelInfo` 类型（新增 pricing 字段）
2. 实现价格匹配 + 费用计算核心模块
3. 实现统计聚合 API（6 个端点）
4. 实现价格 CRUD API（2 个端点）
5. 注册路由到 `app.ts`
6. 前端类型定义 + API 封装
7. 前端统计页面
8. 前端价格配置集成
9. 构建验证

---

## 七、初始数据

等用户提供价目表后，预置到 `providers.json` 中。
