import type { ToolModule, ToolResult, ToolContext, ToolArgs } from '../types.js'
import { z } from 'zod'
import { validate } from '../validate.js'
import { updateEntry, memoryConfig } from '../../character/memory-store.js'
import { MEMORY_TYPES } from '../../character/memory-store.js'
import type { MemoryType } from '../../character/memory-store.js'

/**
 * memory_update：更新一条已有记忆。优先按 id（memory_read 返回的条目 id）精确匹配；
 * 未给 id 或未命中时回退按 match（内容子串）。只作用于未归档条目。
 */
export const tool: ToolModule = {
  name: 'memory_update',
  description:
    '更新一条已有记忆条目。用 id（来自 memory_read 返回的条目）精确定位；' +
    '没有 id 时可提供 match（要修改条目的内容片段）作为回退匹配。' +
    '当发现现有记忆与当前事实/偏好矛盾或过时时调用（纠正/更新）。仅 editable 模式可用。',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: '条目 ID（精确匹配，优先）' },
      match: { type: 'string', description: '内容子串匹配（id 缺失/未命中时回退）' },
      content: { type: 'string', description: '新的记忆内容' },
      type: { type: 'string', enum: ['fact', 'preference', 'decision', 'note'], description: '新的条目类型（可选）' },
    },
    required: [],
  },
  async execute(args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
    const characterId = ctx.characterId
    if (!characterId) return { output: '', error: 'memory_update: 缺少当前角色上下文（characterId）。' }
    const cfg = memoryConfig(characterId)
    if (cfg.mode !== 'editable') {
      return { output: '', error: `记忆模式为 ${cfg.mode}，不允许更新。仅 editable 模式可写。` }
    }

    const input = validate(
      z.object({
        id: z.string().min(1).optional(),
        match: z.string().min(1).optional(),
        content: z.string().min(1),
        type: z.enum(MEMORY_TYPES).optional(),
      }),
      args,
      'memory_update',
    )

    if (!input.id && !input.match) {
      return { output: '', error: 'memory_update: 需要提供 id 或 match（要更新的条目）。' }
    }

    const result = updateEntry(characterId, { id: input.id, match: input.match }, { content: input.content, type: input.type as MemoryType | undefined })
    if (!result.updated) {
      const how = input.id ? `id=${input.id}` : `内容子串"${input.match}"`
      return { output: '', error: `memory_update: 未找到可更新的条目（${how}）。可能已被归档，或内容不匹配。` }
    }
    return {
      output: JSON.stringify({
        updated: true,
        entry: { id: result.entry!.id, ts: result.entry!.ts, type: result.entry!.type, content: result.entry!.content },
        total: result.total,
        char_usage: result.char_usage,
        char_limit: result.char_limit,
      }),
    }
  },
}
