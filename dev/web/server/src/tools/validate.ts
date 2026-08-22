import { z } from 'zod'
import type { ToolArgs } from './types.js'

export class ValidationError extends Error {
  constructor(toolName: string, issues: z.ZodIssue[]) {
    const detail = issues.map(i => `  ${i.path.join('.')}: ${i.message}`).join('\n')
    super(`[${toolName}] 参数校验失败:\n${detail}`)
    this.name = 'ValidationError'
  }
}

// LLM 传入的 args 经 JSON.parse 后是混合标量（string | number | boolean），
// 由各工具的 zod schema 负责具体类型转换与校验。
export const coerceBoolean = z.enum(['true', 'false']).transform(v => v === 'true')
export const coerceNumber = z.string().regex(/^\d+$/, '必须为数字').transform(Number)

export function validate<T>(schema: z.ZodType<T>, args: ToolArgs, toolName: string): T {
  const parsed = schema.safeParse(args)
  if (!parsed.success) throw new ValidationError(toolName, parsed.error.issues)
  return parsed.data
}
