import type { ToolModule, ToolResult, ToolContext, ToolArgs } from '../types.js'
import { z } from 'zod'
import { validate } from '../validate.js'
import { searchKnowledge, decodeHandle } from '../../knowledge/search.js'

/**
 * knowledge_search：会话级知识库搜索。
 * 作用域 = ctx.knowledgeBases（当前会话挂载的库 ID 列表）；未挂载时返回空结果。
 * 返回按 score 降序的命中（handle/kbName/relPath/heading/snippet/score/行号）。
 */
export const tool: ToolModule = {
  name: 'knowledge_search',
  description:
    '在当前会话挂载的知识库中搜索相关 Markdown 文档。' +
    '任务涉及知识库可能覆盖的主题时，优先调用本工具；' +
    '对命中文档用 knowledge_read 读取完整内容。返回命中片段与评分。',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '搜索关键词（完整短语或空格分隔的词条）' },
      limit: { type: 'number', description: '最多返回条数（默认 10，最大 50）' },
    },
    required: ['query'],
  },
  async execute(args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
    const input = validate(
      z.object({
        query: z.string().min(1),
        limit: z.coerce.number().int().min(1).max(50).optional(),
      }),
      args,
      'knowledge_search',
    )
    const kbIds = ctx.knowledgeBases
    if (!kbIds || kbIds.length === 0) {
      return { output: JSON.stringify({ ok: true, hits: [], note: '当前会话未挂载知识库，搜索范围为空。请先在右侧面板挂载知识库。' }) }
    }
    const hits = searchKnowledge(input.query, { kbIds, limit: input.limit ?? 10 })
    return {
      output: JSON.stringify({
        ok: true,
        query: input.query,
        count: hits.length,
        hits: hits.map(h => ({
          handle: h.handle,
          kbId: h.kbId,
          kbName: h.kbName,
          relPath: h.relPath,
          heading: h.heading,
          snippet: h.snippet,
          score: h.score,
          startLine: h.startLine,
          endLine: h.endLine,
        })),
      }),
    }
  },
}
