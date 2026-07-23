import { globSync } from 'glob'
import type { ToolModule } from '../types.js'
import { z } from 'zod'
import { validate } from '../validate.js'

const MAX_RESULTS = 100

export const tool: ToolModule = {
  name: 'glob',
  description: 'Find files matching a glob pattern',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Glob pattern, relative to workspace' },
      limit: { type: 'number', description: 'Max results to return. Defaults to 100.' },
    },
    required: ['pattern'],
  },
  execute: async (args, { workspace }) => {
    const input = validate(
      z.object({
        pattern: z.string().min(1, 'pattern 不能为空'),
        limit: z.string().optional(),
      }),
      args, 'glob',
    )

    const matches = globSync(input.pattern, { cwd: workspace, dot: true })
    const limit = input.limit ? parseInt(input.limit) : MAX_RESULTS
    if (matches.length === 0) return { output: 'No files matched' }
    if (matches.length > limit) {
      return { output: matches.slice(0, limit).join('\n') + `\n\n... (${matches.length - limit} more. Use a more specific pattern)` }
    }
    return { output: matches.join('\n') }
  },
}
