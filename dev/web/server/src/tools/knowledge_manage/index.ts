import type { ToolModule, ToolResult, ToolContext, ToolArgs } from '../types.js'
import { z } from 'zod'
import { validate } from '../validate.js'
import { knowledgeStore } from '../../knowledge/store.js'

/**
 * knowledge_manage：全局知识库管理（始终注入）。
 * create/list/delete/list_files 四个动作，直接操作 <dataDir>/knowledge/bases.json 注册表。
 * 只做登记与扫描，不读写目录内容（文件本身归用户 bash/文件工具管）。
 */
export const tool: ToolModule = {
  name: 'knowledge_manage',
  description:
    '管理知识库：create 从目录登记新库（name + 绝对路径 path，可选 description），' +
    'list 列出所有已登记知识库，delete 按 kb_id 删除登记（不删除目录文件），' +
    'list_files 按 kb_id 列出库内所有可索引文档（.md/.markdown/.txt，递归）。',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['create', 'list', 'delete', 'list_files'], description: '操作：create/list/delete/list_files' },
      name: { type: 'string', description: '知识库名称（create 必填）' },
      path: { type: 'string', description: '知识库根目录绝对路径（create 必填）' },
      description: { type: 'string', description: '知识库描述（create 可选）' },
      kb_id: { type: 'string', description: '知识库 ID（delete/list_files 必填）' },
    },
    required: ['action'],
  },
  async execute(args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
    const input = validate(
      z.object({
        action: z.enum(['create', 'list', 'delete', 'list_files']),
        name: z.string().optional(),
        path: z.string().optional(),
        description: z.string().optional(),
        kb_id: z.string().optional(),
      }),
      args,
      'knowledge_manage',
    )

    switch (input.action) {
      case 'create': {
        try {
          const kb = knowledgeStore.create({
            name: input.name ?? '',
            description: input.description ?? '',
            rootPath: input.path ?? '',
          })
          return { output: JSON.stringify({ ok: true, kb }) }
        } catch (err) {
          return { output: '', error: `knowledge_manage: 创建失败 — ${err instanceof Error ? err.message : String(err)}` }
        }
      }
      case 'list': {
        const bases = knowledgeStore.list()
        return { output: JSON.stringify({ ok: true, count: bases.length, bases: bases.map(b => ({ id: b.id, name: b.name, description: b.description, rootPath: b.rootPath })) }) }
      }
      case 'delete': {
        if (!input.kb_id) return { output: '', error: 'knowledge_manage: delete 需要 kb_id。' }
        if (!knowledgeStore.delete(input.kb_id)) {
          return { output: '', error: `knowledge_manage: 知识库不存在: ${input.kb_id}` }
        }
        return { output: JSON.stringify({ ok: true, deleted: input.kb_id }) }
      }
      case 'list_files': {
        if (!input.kb_id) return { output: '', error: 'knowledge_manage: list_files 需要 kb_id。' }
        const scan = knowledgeStore.listFiles(input.kb_id)
        if (!scan) return { output: '', error: `knowledge_manage: 知识库不存在: ${input.kb_id}` }
        return {
          output: JSON.stringify({
            ok: true,
            kb: { id: scan.kb.id, name: scan.kb.name, rootPath: scan.kb.rootPath },
            count: scan.files.length,
            files: scan.files.map(f => ({ relPath: f.relPath, size: f.size })),
          }),
        }
      }
    }
  },
}
