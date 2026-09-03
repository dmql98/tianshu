# Token 用量统计与费用计算 — 实施计划

## 一、已完成

### 1.1 类型扩展

- **`web/server/src/providers/types.ts`** — `ModelDefinition` 新增 `pricing?: ModelPricing` 字段
- **`web/server/src/db/providerStore.ts`** — 新增 `HourlyPrice`、`ModelPricing` 类型；`ModelInfo` 新增 `pricing?` 字段

### 1.2 OpenCode 价目表

- **`web/server/src/providers/opencode-go.ts`** — 3 个模型全部加上 `pricing`
  - `deepseek-v4-flash`: USD，按小时区分 Peak/Off-Peak（Peak 01-04, 06-10 UTC）
  - `qwen3.7-plus`: USD，24小时统一价
  - `minimax-m2.5`: `is_free: true`，`ref_hourly_prices` 为估算参考价
- **`web/server/src/providers/opencode-free.ts`** — 5 个免费模型全部 `is_free: true`

---

## 二、待实施

### 2.1 价格数据流转

**问题**：插件文件的 pricing 数据如何到达 providers.json（运行时读取源）？

**方案**：

1. **新建时合并**（`POST /api/providers`）：从 plugin.models 读取 pricing，合并到新创建的 provider record
2. **刷新模型时保留+合并**（`GET /api/providers/:id/models`）：保留现有模型的用户手动修改，补充 plugin 中的 pricing
3. **直接写入 providers.json**：用户现有 providers.json 中的 opencode 记录需要手动补 pricing（或通过迁移脚本）

**需要改动的文件**：
- `web/server/src/routes/providers.ts` — POST 创建时合并 plugin pricing
- `web/server/src/content/materialize-builtin.ts` / `copy-on-write.ts` — 启动时物化 builtin providers.json 带 pricing

### 2.2 价格匹配与费用计算模块

**新建文件**：`web/server/src/pricing/calculator.ts`

```
功能：
- loadPricingRules(): 从 providerStore 读取所有 provider+model 的 pricing
- matchPricing(providerId, modelId, createdAt): 按优先级匹配价格规则
  1. provider + model 精确匹配
  2. provider + model 通配
  3. "*" 通用 provider + model
  4. "*" 通用 provider + model 通配
  5. 无匹配 → 免费
- calculateCost(matchedPricing, usage, createdAt): 计算单次调用费用
  - 取 created_at 的小时 (0-23)
  - 如果 is_free: 实际费用=0，节省=ref_hourly_prices 计算
  - 否则: 实际费用=hourly_prices 计算
```

### 2.3 统计聚合 API

**新建文件**：`web/server/src/routes/statistics.ts`

| 端点 | SQL 核心逻辑 |
|------|-------------|
| `GET /overview` | `SELECT SUM(usage_input), SUM(usage_output), ...` + 内存匹配价格 |
| `GET /by-model` | `GROUP BY request_model` + 内存匹配价格 |
| `GET /by-character` | `JOIN sessions` → `GROUP BY character_id` + 内存匹配价格 |
| `GET /by-provider` | `JOIN sessions` → `GROUP BY provider_id` + 内存匹配价格 |
| `GET /by-day` | `GROUP BY date(created_at/1000, 'unixepoch', 'localtime')` |
| `GET /detail` | `SELECT * FROM llm_calls JOIN sessions` + 分页 |

所有端点支持 `from/to/model/character_id/provider_id` 筛选参数。

**费用计算策略**：先从 llm_calls 聚合原始 token 数据，再在应用层（内存）匹配价格规则计算费用。原因：
- 价格规则在 providers.json（非 SQL 可直接查询）
- 规则数量有限（每个 provider 最多几十个模型），内存匹配性能足够
- 避免复杂 SQL JSON 解析

### 2.4 价格配置 API

**新建文件**：`web/server/src/routes/pricing.ts`

- `GET /api/pricing` — 读取所有 provider 的 pricing 配置（含 model 级）
- `PUT /api/pricing` — 保存价格配置（更新 providerStore 中对应记录的 pricing 字段）

### 2.5 路由注册

**修改文件**：`web/server/src/app.ts`
- `app.route('/api/statistics', statisticsRouter)`
- `app.route('/api/pricing', pricingRouter)`

### 2.6 前端（后续设计）

- `web/client/src/api/statistics.ts` — API 封装
- `web/client/src/api/pricing.ts` — API 封装
- `web/client/src/pages/StatisticsPage.tsx` — 统计主页面
- `web/client/src/App.tsx` — 新增路由 `/statistics`
- 价格配置集成到服务商卡片中

---

## 三、文件改动清单

| 文件 | 类型 | 改动 |
|------|------|------|
| `providers/types.ts` | ✅ 已改 | ModelDefinition 加 pricing |
| `providers/opencode-go.ts` | ✅ 已改 | 3 个模型加 pricing |
| `providers/opencode-free.ts` | ✅ 已改 | 5 个免费模型加 pricing |
| `db/providerStore.ts` | ✅ 已改 | 新增 HourlyPrice/ModelPricing 类型 |
| `pricing/calculator.ts` | 🆕 待建 | 价格匹配+费用计算核心 |
| `routes/statistics.ts` | 🆕 待建 | 统计聚合 API（6端点） |
| `routes/pricing.ts` | 🆕 待建 | 价格配置 CRUD API（2端点） |
| `routes/providers.ts` | ✏️ 待改 | 创建时合并 plugin pricing |
| `app.ts` | ✏️ 待改 | 注册新路由 |
| `content/builtin/config/providers.json` | ✏️ 待改 | seed 文件加 pricing |
| `client/api/statistics.ts` | 🆕 待建 | 前端 API 封装 |
| `client/api/pricing.ts` | 🆕 待建 | 前端 API 封装 |
| `client/pages/StatisticsPage.tsx` | 🆕 待建 | 统计页面 |
| `client/App.tsx` | ✏️ 待改 | 新增路由 |

---

## 四、验证方式

1. **TypeScript 编译**：`npx tsc --noEmit` 无报错
2. **单元测试**：`pricing/calculator.ts` 的费用计算逻辑
3. **API 测试**：curl 各端点验证返回 JSON 结构
4. **构建**：`npm run build` 无报错
