import type { ToolModule, ToolResult, ToolContext, ToolArgs } from '../types.js'
import { z } from 'zod'
import { validate } from '../validate.js'
import { writeEntries, memoryConfig, memoryStats } from '../../character/memory-store.js'
import type { MemoryType, MemorySource } from '../../character/memory-store.js'

/**
 * memory_snapshot：快照写入——把一轮对话产生的「有价值发现」批量写入记忆，是记忆系统最主要的写入口。
 * 模型应在对话末尾或重要节点主动触发（不需要用户下达指令）。
 *
 * summary 约定：每行一条记忆。行首可用 `type|` / `type:` 前缀注明类型（fact|preference|decision|note），
 * 缺省自动识别为 note。示例：
 *   "用户喜欢用 TypeScript 写前端\ndecision| 项目采用 pnpm 而不是 npm"
 *
 * Snapshot 内部完成：去重（与现有记忆比对只保留新事实）、压缩（超 charLimit 从最旧裁剪，归档优先）、
 * 格式化（[timestamp] type | content）。
 */
export const tool: ToolModule = {
  name: 'memory_snapshot',
  description:
    '快照：在对话产生有价值发现（用户表达的事实/偏好/决定/约定/结论）时主动触发，把本轮发现批量写入记忆。' +
    '这是记忆系统的首选写入口，无需用户指令。用法：把每条值得记住的内容放一行，' +
    '可用 "type| 内容" 前缀（fact/preference/decision/note）标注类型。示例：' +
    '"decision| 项目采用 pnpm"。去重与压缩在内部完成；返回本次新写入条数与用量。' +
    '只在确有跨会话保留价值的发现时使用；寒暄、可从对话恢复的临时信息不要写入。仅 editable 模式可用。',
  parameters: {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description: '本轮发现总结：每行一条记忆，可用 type| 前缀（fact|preference|decision|note）标注类型',
      },
    },
    required: [],
  },
  async execute(args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
    const characterId = ctx.characterId
    if (!characterId) return { output: '', error: 'memory_snapshot: 缺少当前角色上下文（characterId）。' }
    const cfg = memoryConfig(characterId)
    if (cfg.mode !== 'editable') {
      return { output: '', error: `记忆模式为 ${cfg.mode}，不允许快照写入。仅 editable 模式可写。` }
    }

    const input = validate(z.object({ summary: z.string().optional() }), args, 'memory_snapshot')
    const summary = (input.summary || '').trim()
    if (!summary) {
      const st = memoryStats(characterId)
      return {
        output: JSON.stringify({
          created: 0,
          total: st.active,
          char_usage: st.char_usage,
          char_limit: st.char_limit,
          note: '本轮没有提供需要快照的内容（summary 为空），未写入任何条目。',
        }),
      }
    }

    // 先按行、再按 ；/; 拆段；每段可带 `type| ` / `type: ` 前缀。
    const items: Array<{ content: string; type?: MemoryType }> = []
    const seen = new Set<string>()
    const segments = summary.split(/\r?\n/).flatMap(line => line.split(/[；;]/)).map(s => s.trim()).filter(Boolean)
    for (const seg of segments) {
      let type: MemoryType | undefined
      let text = seg
      const prefix = /^(?:fact|preference|decision|note|事实|偏好|决定|决策|记录)\s*[:|]\s*/i.exec(seg)
      if (prefix) {
        const raw = prefix[0].toLowerCase()
        const aliases: Record<string, MemoryType> = {
          '事实': 'fact', '偏好': 'preference', '决定': 'decision', '决策': 'decision', '记录': 'note',
          'fact': 'fact', 'preference': 'preference', 'decision': 'decision', 'note': 'note',
        }
        type = aliases[raw.replace(/\s*[:|]\s*$/, '')] ?? 'note'
        text = seg.slice(prefix[0].length).trim()
      }
      if (!text || seen.has(text)) continue
      items.push({ content: text, type })
      seen.add(text)
    }
    if (items.length === 0) {
      const st = memoryStats(characterId)
      return {
        output: JSON.stringify({
          created: 0,
          total: st.active,
          char_usage: st.char_usage,
          char_limit: st.char_limit,
          note: '快照内容为空或全部重复，未写入新条目。',
        }),
      }
    }

    const source: MemorySource = 'snapshot'
    const results = writeEntries(characterId, items, { source })
    const created = results.filter(r => r.created).length
    const last = results[results.length - 1]
    const hint = results.find(r => r.hint)?.hint
    return {
      output: JSON.stringify({
        created,
        total: last?.total ?? 0,
        char_usage: last?.char_usage ?? 0,
        char_limit: last?.char_limit ?? cfg.charLimit,
        hint,
        note: `快照完成：新写入 ${created} 条${results.length > created ? `，${results.length - created} 条已存在（去重）` : ''}。${hint || ''}`,
      }),
    }
  },
}
