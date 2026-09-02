import type { ToolModule, ToolResult, ToolContext, ToolArgs } from '../types.js'
import { z } from 'zod'
import { validate } from '../validate.js'
import { writeEntries, memoryConfig, memoryStats, MEMORY_TYPES } from '../../character/memory-store.js'
import type { MemoryType } from '../../character/memory-store.js'

/**
 * memory_write：显式写入一条记忆条目（精确 remember）。
 * 仅在记忆模式为 editable 时注入与执行。
 * 触发场景：用户在对话中陈述了一个值得跨会话保留的事实/偏好/决定。
 * 不要在寒暄、可从对话历史恢复的临时信息上浪费条目。
 */
export const tool: ToolModule = {
  name: 'memory_write',
  description:
    '写入一条新的记忆条目（显式记住）。在用户陈述了有跨会话价值的事实/偏好/决定时调用。' +
    '类型可选：fact（事实）/ preference（偏好）/ decision（决定）/ note（一般记录，默认）。' +
    '只记录值得跨会话保留的内容；不写寒暄、一次性闲聊或可从当前对话恢复的临时信息。' +
    '同内容已有条目时不会重复写入（视为已记住）。',
  parameters: {
    type: 'object',
    properties: {
      content: { type: 'string', description: '要记住的内容' },
      type: { type: 'string', enum: ['fact', 'preference', 'decision', 'note'], description: '条目类型（默认 note）' },
    },
    required: ['content'],
  },
  async execute(args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
    const characterId = ctx.characterId
    if (!characterId) return { output: '', error: 'memory_write: 缺少当前角色上下文（characterId）。' }
    const cfg = memoryConfig(characterId)
    if (cfg.mode !== 'editable') {
      return { output: '', error: `记忆模式为 ${cfg.mode}，不允许写入。仅 editable 模式可写。` }
    }

    const input = validate(
      z.object({
        content: z.string().min(1),
        type: z.enum(MEMORY_TYPES).optional(),
      }),
      args,
      'memory_write',
    )

    const [result] = writeEntries(characterId, [{ content: input.content, type: input.type as MemoryType | undefined }])
    if (!result || result.denied) {
      return { output: '', error: '记忆写入被拒绝（记忆模式不允许）。' }
    }
    const entry = result.entry!
    const createdNote = result.created ? '（新条目）' : '（内容已存在，刷新时间戳）'
    const hint = result.hint ? ` 提示：${result.hint}` : ''
    return {
      output: JSON.stringify({
        id: entry.id,
        ts: entry.ts,
        type: entry.type,
        content: entry.content,
        created: result.created,
        total: result.total,
        char_usage: result.char_usage,
        char_limit: result.char_limit,
        note: `已写入第 ${result.total} 条记忆${createdNote}。${hint}`,
      }),
    }
  },
}
