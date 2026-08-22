import type { ToolModule, ToolResult, ToolContext, ToolArgs } from '../types.js'

export const tool: ToolModule = {
  name: 'my-tool',
  description: 'Description of what this tool does',
  parameters: {
    type: 'object',
    properties: {
      arg1: { type: 'string', description: 'Argument description' },
    },
    required: ['arg1'],
  },
  dangerous: false,
  async execute(args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
    return { output: 'result' }
  },
}
