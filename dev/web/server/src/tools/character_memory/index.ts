import type { ToolModule, ToolResult, ToolContext, ToolArgs } from '../types.js'
import { z } from 'zod'
import { validate } from '../validate.js'
import { remember, forget, readMemory, memoryFilePath, memoryConfig } from '../../character/memory-store.js'

/**
 * 角色私有记忆工具：让角色在会话中读写自己的长期记忆（受 character.memory.enabled 门控）。
 *
 * - remember：追加一条记忆（结构化为条目，超 charLimit 自动从最旧压缩）。
 * - recall：  读取当前角色全部记忆条目。
 * - forget：  按内容子串匹配删除若干条记忆。
 *
 * 记忆存于 <dataDir>/characters/<charId>/memory.md，并且开/关由「启用记忆」开关控制：
 * - enabled=false 时 remember 拒绝写入（返回提示），也不应主动把事情写进记忆。
 */
export const tool: ToolModule = {
  name: 'character_memory',
  description:
    '角色私有长期记忆的读写工具。用于把值得跨会话记住的信息写入记忆（remember）、读取当前记忆（recall）、或遗忘某条记忆（forget）。' +
    '记忆按「一条一条」存为易读条目，写入会受角色的记忆开关和字数上限约束。仅在内容确有跨会话保留价值时使用，不要记录一次性寒暄。',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['remember', 'recall', 'forget'],
        description: '操作：remember=记一条；recall=读取全部记忆；forget=遗忘记忆（按内容匹配删除）。',
      },
      content: {
        type: 'string',
        description: '记忆内容。remember 写入该条；forget 用其作为匹配子串删除；recall 无需此字段。',
      },
    },
    required: ['action'],
  },
  async execute(args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
    const input = validate(
      z.object({
        action: z.enum(['remember', 'recall', 'forget']),
        content: z.string().optional(),
      }),
      args,
      'character_memory',
    )

    const characterId = ctx.characterId
    if (!characterId) {
      return { output: '', error: 'character_memory: 缺少当前角色上下文（characterId），无法定位角色私有记忆。' }
    }

    const cfg = memoryConfig(characterId)
    if (!cfg.enabled && input.action === 'remember') {
      return {
        output: '',
        error: '该角色的记忆未启用（memory.enabled=false）。remember 已拒绝写入。如需记录，请先在角色设置的「启用记忆」中打开。',
      }
    }

    switch (input.action) {
      case 'recall': {
        const entries = readMemory(characterId)
        if (entries.length === 0) {
          return { output: '当前没有记忆条目。' }
        }
        const body = entries.map((e, i) => `${i + 1}. [${e.ts}] ${e.content}`).join('\n')
        return {
          output: `当前角色记忆（${entries.length} 条，上限 ${cfg.charLimit} 字符）：\n${body}`,
        }
      }
      case 'remember': {
        const content = (input.content || '').trim()
        if (!content) return { output: '', error: 'remember 需要提供 content（要记住的内容）。' }
        const r = remember(characterId, content)
        if (r.disabledFallback) {
          return { output: '', error: '该角色的记忆未启用，已拒绝写入。' }
        }
        const hint = r.hint ? `\n提示：${r.hint}` : ''
        return {
          output: `已记住（第 ${r.count} 条）${r.dropped > 0 ? `，自动丢弃了最旧的 ${r.dropped} 条` : ''}。${hint}`,
        }
      }
      case 'forget': {
        const content = (input.content || '').trim()
        if (!content) return { output: '', error: 'forget 需要提供 content（要遗忘的记忆内容/子串）。' }
        const f = forget(characterId, content)
        if (f.removed === 0) return { output: `未找到匹配 "…${content}" 的记忆条目（当前共 ${f.remaining} 条）。` }
        return { output: `已遗忘 ${f.removed} 条记忆（剩余 ${f.remaining} 条）。` }
      }
    }
  },
}
