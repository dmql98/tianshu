import type { ToolModule, ToolResult, ToolContext, ToolArgs } from '../types.js'
import { z } from 'zod'
import { validate } from '../validate.js'
import { knowledgeStore, normalizedDir, originalsDir } from '../../knowledge/store.js'
import { converterRegistry } from '../../knowledge/converter-registry.js'
import { existsSync, readFileSync } from 'fs'
import { isAbsolute, join, resolve, basename } from 'path'

/**
 * knowledge_manage：全局知识库管理（始终注入）。
 * create/list/delete/list_files 四个动作，直接操作 <dataDir>/knowledge/bases.json 注册表。
 * P2 外部转换器：converters（列出转换器及可用性）/ install_converter（登记+探测）/
 * convert（用外部 CLI 转换文件到 normalized/）。
 * 只做登记与扫描，不读写目录内容（文件本身归用户 bash/文件工具管）。
 */
export const tool: ToolModule = {
  name: 'knowledge_manage',
  description:
    '管理知识库：create 从目录登记新库（name + 绝对路径 path，可选 description），' +
    'list 列出所有已登记知识库，delete 按 kb_id 删除登记（不删除目录文件），' +
    'list_files 按 kb_id 列出库内所有可索引文档（.md/.markdown/.txt，递归）。' +
    'P2 外部转换器：converters 列出可用转换器（paddleocr/anydoc 等），' +
    'install_converter 按 converter 登记并探测外部 CLI，' +
    'convert 按 kb_id + converter + file 用外部命令把文件转为 Markdown（产物在 normalized/）。',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['create', 'list', 'delete', 'list_files', 'converters', 'install_converter', 'convert'],
        description: '操作：create/list/delete/list_files/converters/install_converter/convert',
      },
      name: { type: 'string', description: '知识库名称（create 必填）' },
      path: { type: 'string', description: '知识库根目录绝对路径（create 必填）' },
      description: { type: 'string', description: '知识库描述（create 可选）' },
      kb_id: { type: 'string', description: '知识库 ID（delete/list_files/convert 必填）' },
      converter: { type: 'string', description: '转换器 ID（install_converter/convert 必填，如 paddleocr/anydoc）' },
      file: { type: 'string', description: '待转换文件（convert 必填）：originals/ 下的文件名，或绝对路径' },
    },
    required: ['action'],
  },
  async execute(args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
    const input = validate(
      z.object({
        action: z.enum(['create', 'list', 'delete', 'list_files', 'converters', 'install_converter', 'convert']),
        name: z.string().optional(),
        path: z.string().optional(),
        description: z.string().optional(),
        kb_id: z.string().optional(),
        converter: z.string().optional(),
        file: z.string().optional(),
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
      case 'converters': {
        const list = converterRegistry.list()
        return {
          output: JSON.stringify({
            ok: true,
            converters: list.map(c => ({
              id: c.id,
              name: c.name,
              installed: c.installed,
              available: c.available,
              detected: c.detected,
              version: c.version,
              inputExtensions: c.inputExtensions,
              installCommand: c.installCommand,
            })),
          }),
        }
      }
      case 'install_converter': {
        if (!input.converter) return { output: '', error: 'knowledge_manage: install_converter 需要 converter（paddleocr/anydoc）。' }
        try {
          const desc = converterRegistry.install(input.converter)
          if (!desc) return { output: '', error: `knowledge_manage: 转换器不存在: ${input.converter}` }
          return {
            output: JSON.stringify({
              ok: true,
              converter: {
                id: desc.id,
                name: desc.name,
                installed: desc.installed,
                available: desc.available,
                version: desc.version,
                inputExtensions: desc.inputExtensions,
              },
            }),
          }
        } catch (err) {
          return { output: '', error: `knowledge_manage: 安装转换器失败 — ${err instanceof Error ? err.message : String(err)}` }
        }
      }
      case 'convert': {
        if (!input.kb_id) return { output: '', error: 'knowledge_manage: convert 需要 kb_id。' }
        if (!input.converter) return { output: '', error: 'knowledge_manage: convert 需要 converter（paddleocr/anydoc）。' }
        if (!input.file) return { output: '', error: 'knowledge_manage: convert 需要 file。' }
        const kb = knowledgeStore.get(input.kb_id)
        if (!kb) return { output: '', error: `knowledge_manage: 知识库不存在: ${input.kb_id}` }

        // 解析源文件：originals/{kbId}/{file}，或绝对路径
        let sourcePath: string
        const origCandidate = join(originalsDir(input.kb_id), basename(input.file))
        if (existsSync(origCandidate)) {
          sourcePath = origCandidate
        } else if (isAbsolute(input.file) && existsSync(input.file)) {
          sourcePath = input.file
        } else {
          // 回退：知识库 rootPath 下相对路径
          const inRoot = resolve(kb.rootPath, input.file)
          if (existsSync(inRoot)) sourcePath = inRoot
          else return { output: '', error: `knowledge_manage: 找不到源文件（originals/ 或绝对路径均不存在）: ${input.file}` }
        }

        const fileName = basename(sourcePath)
        const outDir = normalizedDir(input.kb_id)
        knowledgeStore.upsertConverted(input.kb_id, {
          fileName,
          mdRelPath: `normalized/${fileName.replace(/\.[^.]+$/, '')}.md`,
          status: 'converting',
          converter: input.converter,
          updatedAt: Date.now(),
        })
        const result = await converterRegistry.convert(input.converter, sourcePath, outDir)
        if (!result.ok) {
          knowledgeStore.upsertConverted(input.kb_id, {
            fileName,
            mdRelPath: `normalized/${fileName.replace(/\.[^.]+$/, '')}.md`,
            status: 'error',
            error: result.error,
            converter: input.converter,
            updatedAt: Date.now(),
          })
          return { output: '', error: `knowledge_manage: 转换失败 — ${result.error}` }
        }
        const mdContent = readFileSync(result.outputPath, 'utf-8')
        const mdRel = knowledgeStore.saveNormalized(input.kb_id, fileName, mdContent)
        knowledgeStore.upsertConverted(input.kb_id, {
          fileName,
          mdRelPath: mdRel,
          status: 'indexed',
          converter: input.converter,
          updatedAt: Date.now(),
        })
        return {
          output: JSON.stringify({
            ok: true,
            kbId: input.kb_id,
            converter: input.converter,
            source: fileName,
            mdRelPath: mdRel,
            bytes: mdContent.length,
          }),
        }
      }
    }
  },
}
