# Provider 预设目录（Provider Catalog）

目录驱动的主流派 Provider 预设。新增普通 OpenAI / Anthropic / Gemini 兼容厂商时，只需新增一个目录：

```text
web/server/src/provider-catalog/<id>/
├── provider.json   # 预设元数据（Zod 校验）
└── icon.svg        # 官方图标（独立 SVG，不合并 sprite）
```

无需修改前端数组、中心注册表或 API 路由。服务启动 / 首次访问时由
`loader.ts` 自动扫描、校验、排序并缓存。

## 协议

`provider.json` 使用 `schemaVersion: 1`，schema 定义见
`../provider-catalog/schema.ts`。核心字段：

| 字段 | 说明 |
| --- | --- |
| `id` | 预设稳定身份，必须等于目录名 |
| `name` / `description` | 展示名称与描述 |
| `format` | 请求格式：`openai` \| `anthropic` \| `gemini` |
| `runtime.plugin` | 实际执行模型请求的运行时适配器（必须在 `../providers/index.ts` 中注册） |
| `baseUrl` | 默认 API 地址，用户添加后可修改（支持代理 / 私有网关 / 兼容端点） |
| `env` | 鉴权环境变量名列表；只用于展示可用状态，绝不返回实际值 |
| `icon` | 当前目录内的相对路径，禁止绝对路径与 `../` 逃逸 |
| `popular` / `sortOrder` | 列表排序：`popular` 优先，其次 `sortOrder` 升序，最后 `name` |
| `enabled` | `false` 的条目不对客户端返回 |
| `fields` | 配置表单字段协议；第一版只完整处理 `apiKey`，保留扩展空间 |

`id` 与 `runtime.plugin` 允许不同：一家新的 OpenAI-compatible 服务可以有自己的
`id`，同时复用 `runtime.plugin: "openai-compatible"`。

## 运行时校验

`loader.ts` 加载时校验：

- `provider.id === 目录名`
- `runtime.plugin` 存在于 provider plugin registry
- `icon` 为目录内相对路径且文件存在
- 禁止绝对路径、`../` 逃逸、空路径段
- 重复 ID、损坏 JSON、schema 校验失败均记录结构化日志并跳过该项，
  **不会阻止服务启动**

## 排序

1. `popular: true` 优先
2. `sortOrder` 升序
3. `name` 字典序

## 构建与打包

`web/server/scripts/copy-provider-catalog.js` 在 `npm run build` 时把
`src/provider-catalog/**` 复制到 `dist/provider-catalog/`，保证生产环境与
Electron 安装包中 catalog 扫描可用。

## 图标

图标来源与许可证信息见 `LICENSES.md`。Provider 名称、Logo 和商标归各厂商所有。
