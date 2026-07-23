import type { ToolModule, ToolResult, ToolContext } from '../types.js'

export const tool: ToolModule = {
  name: 'get_time',
  description: 'Get the current date, time, and timezone. Call this whenever you need to know the current time.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  async execute(_args: Record<string, string>, _ctx: ToolContext): Promise<ToolResult> {
    const now = new Date()
    const offset = -now.getTimezoneOffset()
    const tz = `UTC${offset >= 0 ? '+' : ''}${Math.floor(offset / 60)}:${String(offset % 60).padStart(2, '0')}`
    const iso = now.toISOString()
    const local = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`
    return { output: `Current time: ${local} (${tz})\nISO 8601: ${iso}` }
  },
}
