import type { ToolModule, ToolResult, ToolContext, ToolArgs } from '../types.js'
import { z } from 'zod'
import { validate } from '../validate.js'
import { memoryConfig, readMemory, memoryStats } from '../../character/memory-store.js'
import type { MemoryEntry } from '../../character/memory-store.js'

/**
 * memory_read：获取当前角色的完整记忆视图（全局重建视角），不绑定文件 read/write。
 * 不同于「读一条记忆」，它帮助模型重建对某话题的完整认知：
 * - 默认返回非归档条目的结构化摘要 + 条目列表；
 * - `filter`：关键词子串过滤；`topic`：主题分组（模糊匹配条目内容）；
 * - `limit`：最多返回条目数（默认全部）。
 * 仅在记忆模式为 read_only / editable 时注入；off 时不注入。
 */
export const tool: ToolModule = {
  name: 'memory_read',
  description:
    '读取当前角色的完整记忆视图，用于重建对某个话题的认知。' +
    '对话开始、或讨论复杂话题前先调用它以恢复上下文：会返回「摘要（重要发现/偏好/决定/结论）+ 条目列表（含 id/时间/类型）」。' +
    '参数：filter=关键词子串过滤；topic=按主题分组（模糊匹配内容）；limit=最多返回条数。' +
    '该工具只读，不会修改记忆。',
  parameters: {
    type: 'object',
    properties: {
      filter: { type: 'string', description: '关键词过滤（对条目内容做子串匹配）' },
      topic: { type: 'string', description: '主题关键词：把匹配该话题的条目单独分组返回' },
      limit: { type: 'number', description: '最多返回条目数（默认全部）' },
    },
    required: [],
  },
  async execute(args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
    const characterId = ctx.characterId
    if (!characterId) return { output: '', error: 'memory_read: 缺少当前角色上下文（characterId）。' }
    const cfg = memoryConfig(characterId)
    if (cfg.mode === 'off') return { output: '', error: '该角色的记忆处于关闭模式（off），不可读取。' }

    const input = validate(
      z.object({
        filter: z.string().optional(),
        topic: z.string().optional(),
        limit: z.coerce.number().int().min(1).optional(),
      }),
      args,
      'memory_read',
    )

    const all = readMemory(characterId)
    let entries: MemoryEntry[] = all.filter(e => !e.archived)
    if (input.filter) {
      const needle = input.filter
      entries = entries.filter(e => e.content.includes(needle) || e.type.includes(needle))
    }
    const topic = input.topic?.trim()
    if (topic) {
      entries = entries.filter(e => e.content.includes(topic))
    }
    const limit = input.limit ?? entries.length
    const shown = entries.slice(-limit).reverse()

    if (shown.length === 0) {
      const st = memoryStats(characterId)
      const msg = topic ? `没有与话题「${topic}」匹配的记忆条目。` : input.filter ? `没有匹配 "${input.filter}" 的记忆条目。` : '当前还没有记忆条目。'
      return {
        output: JSON.stringify({
          summary: msg + ` 可写入模式：${cfg.mode}`,
          entries: [],
          total: 0,
          char_usage: st.char_usage,
          char_limit: st.char_limit,
        }),
      }
    }

    // 结构化摘要：按类型统计 + 抽取「重要」类型条目。
    const typeCount = { fact: 0, preference: 0, decision: 0, note: 0 } as Record<string, number>
    for (const e of entries) typeCount[e.type]++
    const summaryParts: string[] = []
    summaryParts.push(`共 ${entries.length} 条匹配记忆${topic ? `（话题「${topic}」）` : ''}：fact ${typeCount.fact} · preference ${typeCount.preference} · decision ${typeCount.decision} · note ${typeCount.note}`)
    const highlights = shown
      .filter(e => e.type === 'decision' || e.type === 'preference')
      .slice(0, 5)
      .map(e => `[${e.type}] ${e.content}`)
    if (highlights.length > 0) {
      summaryParts.push('重要决定/偏好：' + highlights.join('；'))
    }

    return {
      output: JSON.stringify({
        summary: summaryParts.join('\n'),
        entries: shown.map(e => ({ id: e.id, ts: e.ts, type: e.type, content: e.content })),
        total: entries.length,
        char_usage: memoryStats(characterId).char_usage,
        char_limit: cfg.charLimit,
      }),
    }
  },
}
