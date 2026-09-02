import type { ToolModule, ToolResult, ToolContext, ToolArgs } from '../types.js'
import { z } from 'zod'
import { validate } from '../validate.js'
import { archiveEntry, memoryConfig } from '../../character/memory-store.js'

/**
 * memory_archive：归档一条记忆条目。归档后条目不再出现在默认 read 视图（memory_read 不返回），
 * 在 memory.md 中仍保留 [archived] 标记，可恢复；恢复入口由前端提供。
 * Agent 没有永久删除能力——永久删除只能由用户在前端记忆浏览器手动操作。
 */
export const tool: ToolModule = {
  name: 'memory_archive',
  description:
    '归档一条记忆条目（标记 [archived]）。归档后该条目从默认记忆视图中隐藏，但不会被删除，' +
    '用户可随时在前端记忆浏览器恢复。用于处理「已过时但不想删除」或「暂时不需要出现在上下文中」的记忆。' +
    '注意：你是 Agent，没有永久删除能力；永久删除只能由用户在前端操作。' +
    '按 id（memory_read 返回）精确归档；未提供时可用 match（内容子串）回退。仅 editable 模式可用。',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: '条目 ID（精确匹配，优先）' },
      match: { type: 'string', description: '内容子串匹配（id 缺失/未命中时回退）' },
    },
    required: [],
  },
  async execute(args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
    const characterId = ctx.characterId
    if (!characterId) return { output: '', error: 'memory_archive: 缺少当前角色上下文（characterId）。' }
    const cfg = memoryConfig(characterId)
    if (cfg.mode !== 'editable') {
      return { output: '', error: `记忆模式为 ${cfg.mode}，不允许归档。仅 editable 模式可写。` }
    }

    const input = validate(
      z.object({
        id: z.string().min(1).optional(),
        match: z.string().min(1).optional(),
      }),
      args,
      'memory_archive',
    )

    if (!input.id && !input.match) {
      return { output: '', error: 'memory_archive: 需要提供 id 或 match（要归档的条目）。' }
    }

    const result = archiveEntry(characterId, { id: input.id, match: input.match })
    if (!result.archived) {
      const how = input.id ? `id=${input.id}` : `内容子串"${input.match}"`
      return { output: '', error: `memory_archive: 未找到可归档的条目（${how}）。可能已被归档或不存在。` }
    }
    return {
      output: JSON.stringify({
        archived: true,
        remaining: result.remaining,
        total: result.total,
        char_usage: result.char_usage,
        char_limit: result.char_limit,
        note: `已归档。剩余 ${result.remaining} 条活跃记忆。`,
      }),
    }
  },
}
