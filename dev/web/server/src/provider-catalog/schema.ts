import { z } from 'zod'

/**
 * Provider 预设目录协议（schemaVersion 1）。
 *
 * 每家 Provider 在 provider-catalog/<id>/ 下保存 provider.json + icon.svg。
 * 新增普通 OpenAI/Anthropic/Gemini 兼容厂商时只需新增这两个文件，
 * 无需修改前端数组、中心注册表或 API 路由。
 */

export const PROVIDER_FORMATS = ['openai', 'anthropic', 'gemini'] as const
export type ProviderFormat = (typeof PROVIDER_FORMATS)[number]

export const providerFieldSchema = z.object({
  key: z.string().min(1),
  type: z.enum(['text', 'password', 'select']),
  label: z.string().min(1),
  required: z.boolean().optional(),
  placeholder: z.string().optional(),
  defaultValue: z.string().optional(),
  options: z
    .array(z.object({ label: z.string().min(1), value: z.string().min(1) }))
    .optional(),
})
export type ProviderField = z.infer<typeof providerFieldSchema>

export const providerPresetSchema = z.object({
  /** 协议版本，当前仅支持 1。 */
  schemaVersion: z.literal(1),
  /** 预设稳定身份（必须等于目录名，用于 UI / 存储关联 / 图标 URL）。 */
  id: z
    .string()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'id 只能包含小写字母、数字和连字符'),
  /** 展示名称，例如 "OpenAI"。 */
  name: z.string().min(1),
  description: z.string().optional(),
  /** 请求格式，决定消息序列化与响应解析方式。 */
  format: z.enum(PROVIDER_FORMATS),
  /** 实际执行模型请求的运行时适配器。 */
  runtime: z.object({ plugin: z.string().min(1) }),
  baseUrl: z.string().url('baseUrl 必须是合法 URL'),
  /** 鉴权环境变量名，仅用于展示可用状态，绝不返回实际值。 */
  env: z.array(z.string().min(1)).optional(),
  /** 当前目录内的相对路径，禁止绝对路径与 `../` 逃逸。 */
  icon: z.string().min(1),
  website: z.string().url().optional(),
  docsUrl: z.string().url().optional(),
  popular: z.boolean().optional(),
  /** 升序；缺省按 name 排序。 */
  sortOrder: z.number().int().optional(),
  /** false 的条目不对客户端返回。 */
  enabled: z.boolean().optional(),
  /** 配置表单字段；第一版只完整处理 apiKey，但保留扩展协议。 */
  fields: z.array(providerFieldSchema).optional(),
})

export type ProviderPreset = z.infer<typeof providerPresetSchema>
