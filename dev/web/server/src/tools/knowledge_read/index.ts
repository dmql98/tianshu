import type { ToolModule, ToolResult, ToolContext, ToolArgs } from '../types.js'
import { z } from 'zod'
import { validate } from '../validate.js'
import { decodeHandle } from '../../knowledge/search.js'
import { knowledgeStore } from '../../knowledge/store.js'

/**
 * knowledge_read：按 handle（来自 knowledge_search）读取知识文档完整内容。
 * handle 解码后必须属于当前会话挂载的知识库（作用域校验）。
 */
export const tool: ToolModule = {
  name: 'knowledge_read',
  description:
    '读取知识文档的完整 Markdown 内容。handle 来自 knowledge_search 的返回结果。',
  parameters: {
    type: 'object',
    properties: {
      handle: { type: 'string', description: 'knowledge_search 返回的文档 handle' },
    },
    required: ['handle'],
  },
  async execute(args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
    const input = validate(
      z.object({ handle: z.string().min(1) }),
      args,
      'knowledge_read',
    )
    const decoded = decodeHandle(input.handle)
    if (!decoded) return { output: '', error: 'knowledge_read: handle 无效。' }
    const kbIds = ctx.knowledgeBases
    if (!kbIds || !kbIds.includes(decoded.kbId)) {
      return { output: '', error: `knowledge_read: 文档不属于当前会话挂载的知识库（${decoded.kbId}）。` }
    }
    const kb = knowledgeStore.get(decoded.kbId)
    if (!kb) return { output: '', error: 'knowledge_read: 知识库不存在，可能已被删除。' }
    try {
      const doc = knowledgeStore.readFile(decoded.kbId, decoded.relPath)
      if (!doc) return { output: '', error: `knowledge_read: 文档不存在: ${decoded.relPath}` }
      return {
        output: JSON.stringify({
          ok: true,
          kbId: decoded.kbId,
          kbName: kb.name,
          relPath: decoded.relPath,
          content: doc.content,
        }),
      }
    } catch (err) {
      return { output: '', error: `knowledge_read: ${err instanceof Error ? err.message : String(err)}` }
    }
  },
}
