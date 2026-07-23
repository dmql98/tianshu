import { z } from 'zod'

export class ValidationError extends Error {
  constructor(toolName: string, issues: z.ZodIssue[]) {
    const detail = issues.map(i => `  ${i.path.join('.')}: ${i.message}`).join('\n')
    super(`[${toolName}] 参数校验失败:\n${detail}`)
    this.name = 'ValidationError'
  }
}

// LLM 传入的 args 是 Record<string, string>，需要做类型转换
export const coerceBoolean = z.enum(['true', 'false']).transform(v => v === 'true')
export const coerceNumber = z.string().regex(/^\d+$/, '必须为数字').transform(Number)

export function validate<T>(schema: z.ZodType<T>, args: Record<string, string>, toolName: string): T {
  const parsed = schema.safeParse(args)
  if (!parsed.success) throw new ValidationError(toolName, parsed.error.issues)
  return parsed.data
}
