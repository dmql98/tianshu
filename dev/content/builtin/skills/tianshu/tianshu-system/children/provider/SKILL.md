---
name: tianshu-provider-management
description: "配置和管理天枢的模型服务商：provider.json 元数据 + pricing.json 定价表。"
---

# 模型服务管理

Provider 配置是**目录结构**（不是单个 JSON 文件）：`<dataDir>/providers/<id>/` 下存放 `provider.json`、`icon.svg`，可选 `pricing.json`。

> **路径**：`<dataDir>` 是激活时注入的绝对路径（如 `C:\...\devdata`）。下文 `<dataDir>` 均指此路径。
> 启动时系统将 `content/builtin/providers/` 的出厂预设物化到 `<dataDir>/providers/`（用户层），用户层修改优先于内置层。

## 架构

```
content/builtin/providers/        ← 只读出厂预设（materializeProviderCatalog() 复制到用户层）
  <id>/
    provider.json
    icon.svg
    pricing.json          ← 可选，内置层也提供出厂价目表

<dataDir>/providers/              ← 用户层（实际生效）
  <id>/
    provider.json          ← 必需，服务商元数据（schemaVersion 1）
    icon.svg               ← 必需，服务商图标（目录内相对路径）
    pricing.json           ← 可选，模型定价表（无则全部免费兜底）
```

**模型来源**：模型列表由 provider plugin（源码 `web/server/src/providers/<plugin>.ts`）定义，或通过 `GET /api/providers/:id/models` 从服务商 API 实时拉取。pricing.json 中的 modelId 必须与 API 返回的 model id 精确匹配。

---

## provider.json — 服务商元数据

```json
{
  "schemaVersion": 1,                    // 必填，当前仅支持 1
  "id": "amd",                           // 必填，必须 = 目录名，小写字母/数字/连字符
  "name": "AMD Token Factory",           // 必填，展示名
  "description": "AMD Token Factory（AMD Radeon）API",
  "format": "openai",                    // 必填："openai" | "anthropic" | "gemini"
  "runtime": { "plugin": "openai" },     // 必填，plugin 必须存在于 provider registry
  "baseUrl": "https://developer.amd.com.cn/radeon/api/v1",  // 必填，合法 URL
  "env": ["AMD_API_KEY"],               // 可选，API Key 环境变量名（仅展示用，不返回实际值）
  "icon": "icon.svg",                    // 必填，目录内相对路径，禁止绝对路径与 ../逃逸
  "website": "https://developer.amd.com.cn/",
  "docsUrl": "https://developer.amd.com.cn/",
  "popular": false,                      // 可选，true 时 UI 排序优先
  "sortOrder": 55,                       // 可选，升序
  "enabled": true,                       // 可选，false 时不对客户端返回
  "fields": [                            // 可选，配置表单字段
    {
      "key": "apiKey",
      "type": "password",                // "text" | "password" | "select"
      "label": "API Key",
      "required": true,
      "placeholder": "rc-..."
    }
  ],
  "headers": { "x-custom": "value" },    // 可选，附加请求头
  "oauth": {                             // 可选，一键授权
    "authorizeUrl": "...", "exchangeUrl": "...",
    "keyName": "...", "appUrl": "..."
  }
}
```

### 字段速查

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| schemaVersion | literal 1 | ✅ | |
| id | string | ✅ | = 目录名 |
| name | string | ✅ | |
| format | 'openai'\|'anthropic'\|'gemini' | ✅ | 请求格式 |
| runtime.plugin | string | ✅ | 必须在 provider registry 中 |
| baseUrl | URL | ✅ | |
| icon | string | ✅ | 目录内相对路径 |
| env | string[] | | API Key 环境变量名 |
| fields | Field[] | | 配置表单 |
| headers | Record | | 附加请求头 |
| oauth | object | | 一键授权 |

---

## pricing.json — 模型定价表

> 单位约定：所有价格字段为 **分/1M tokens**（整数）：`¥1.00/1M → 100`，`$2.50/1M → 250`。

```json
{
  "schemaVersion": 1,
  "currency": "CNY",                     // "USD" | "CNY"，默认币种
  "default_pricing": { ... },            // 可选，provider 级默认（model 级未配时回退）
  "models": {
    "model-id": {
      "currency": "CNY",                 // 可选，覆盖 provider 级币种
      "is_free": true,                   // true = 实际费用 0
      "hourly_prices": [ ... ],          // 24 条，hour 0-23（UTC）
      "ref_hourly_prices": [ ... ]       // 可选，免费模型的参考价（用于计算"节省了多少"）
    }
  }
}
```

### hourly_prices 条目

```json
{
  "hour": 0,            // 0-23，UTC 小时
  "input": 150,         // 分/1M tokens，输入（缓存未命中）
  "output": 450,        // 分/1M tokens，输出
  "cache_hit": 5,       // 分/1M tokens，缓存命中
  "cache_miss": 150     // 分/1M tokens，缓存未命中（通常 = input）
}
```

**必须 24 条**（hour 0-23 连续）。hour 字段是 UTC 小时——北京时间 9:00-12:00 = UTC 1:00-4:00 = hour {1,2,3}。

### 免费模型 vs 参考价

- `is_free=true` + `hourly_prices` 全 0 → 实际费用 = 0
- `ref_hourly_prices` 填参考价（可选）→ 统计侧用它算"节省了多少"
- 示例（opencode-free 档模式）：

```json
{
  "is_free": true,
  "hourly_prices": [{"hour":0,"input":0,"output":0,"cache_hit":0,"cache_miss":0}, ...全24h],
  "ref_hourly_prices": [{"hour":0,"input":250,"output":750,"cache_hit":50,"cache_miss":250}, ...]
}
```

### 计费匹配优先级

1. 本服务商 model 级 pricing → 2. 本服务商 provider 级 default → 3. 其他服务商 model 级（按 modelId 跨查）→ 4. 免费兜底

---

## 操作

### 1. 列出现有服务商

```bash
ls <dataDir>/providers/
# 或查看具体 provider.json：
read <dataDir>/providers/<id>/provider.json
```

### 2. 查看定价

```bash
read <dataDir>/providers/<id>/pricing.json
```

### 3. 新增/修改 pricing.json

用 `write` 写入完整 JSON，或 `edit` 修改特定字段。路径：`<dataDir>/providers/<id>/pricing.json`。

**同步内置层**：同步更新 `content/builtin/providers/<id>/pricing.json`（源码仓库中的出厂预设）。

### 4. 新增服务商

1. 创建目录 `<dataDir>/providers/<id>/`
2. 写入 `provider.json`（schemaVersion 1）
3. 放入 `icon.svg`（目录内）
4. 可选：写入 `pricing.json`
5. 确认 `runtime.plugin` 在 provider registry 中存在（源码 `web/server/src/providers/index.ts`）

### 5. 禁用服务商

在 `provider.json` 中设 `"enabled": false`。重启会话生效。

### 6. 删除定价文件

删除 `<dataDir>/providers/<id>/pricing.json` 即可——该 provider 所有模型回退为免费兜底。

---

## 注意

- **绝不回显完整 API Key**：env 字段仅记录环境变量名，不暴露实际值。
- **modelId 必须精确匹配**：pricing.json 中的 model key 必须与 API 返回的 model id 一致，否则计费不命中。
- **hour 字段用 UTC**：北京时间 9:00-12:00 / 14:00-18:00 → UTC hour {1,2,3,6,7,8,9}（见项目 `opencode-pricing.ts` 约定）。
- **单位是分不是元**：¥1.00 = 100 分。搞错会差 100 倍。
- **两层复制**：内置层改动后需重启服务（`materializeProviderCatalog()` 在启动时物化到用户层）；用户层改动立即生效（pricingStore 有 5s 缓存）。
